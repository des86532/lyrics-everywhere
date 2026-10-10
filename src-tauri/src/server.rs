use std::{
    collections::HashMap,
    convert::Infallible,
    net::TcpListener,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    body::Body,
    extract::{rejection::JsonRejection, DefaultBodyLimit, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        Html, IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{
    net::TcpListener as TokioTcpListener,
    sync::{broadcast, Mutex},
};
use tower_http::services::ServeDir;
use url::Url;

pub const PORT: u16 = 3838;
pub const STALE_AFTER_MS: u64 = 5_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub track_key: String,
    pub source: TrackSource,
    pub title: String,
    pub artists: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSource {
    pub connector: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_track_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricLine {
    pub line_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_ms: Option<u64>,
    pub original_text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phonetic: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LyricSheet {
    pub track_key: String,
    pub lyrics_id: String,
    pub revision: u64,
    pub status: String,
    pub allowed_systems: Vec<String>,
    pub lines: Vec<LyricLine>,
    pub lyrics_source: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub track: Option<Track>,
    pub state: String,
    pub position_ms: Option<u64>,
    pub sampled_at_ms: u64,
    pub playback_rate: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub target_locale: String,
    pub passthrough_languages: Vec<String>,
    pub allowed_systems: Vec<String>,
    pub source_preference: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserReport {
    pub version: u8,
    pub tab_id: String,
    pub session_id: String,
    pub app_id: String,
    pub page_url: String,
    pub video_id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub album: Option<String>,
    pub state: String,
    pub position_ms: f64,
    pub duration_ms: f64,
    pub playback_rate: f64,
    pub captured_at_ms: f64,
    pub is_ad: Option<bool>,
}

#[derive(Clone)]
pub struct StoredReport {
    pub report: BrowserReport,
    pub received_at_ms: u64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserHeartbeat {
    pub app_id: String,
    pub page_url: String,
    pub tab_id: Value,
    pub media_state: Option<String>,
}
#[derive(Clone)]
pub struct StoredHeartbeat {
    pub media_state: Option<String>,
    pub received_at_ms: u64,
}
#[derive(Clone)]
pub struct WireEvent {
    pub name: String,
    pub data: Value,
}
#[derive(Clone, Default)]
pub struct SyncState {
    pub reference_duration_ms: Option<u64>,
    pub anchored: bool,
}

#[derive(Clone)]
pub struct SessionState {
    pub snapshot: Snapshot,
    pub sheet: Option<LyricSheet>,
    pub active_source: Option<String>,
    pub active_browser_key: Option<String>,
    pub revision: u64,
    pub diagnostics: Vec<Value>,
    pub manual_lyrics: bool,
    pub lyric_candidate_track_key: Option<String>,
    pub lyric_candidate_ids: Vec<u64>,
    pub profile: Profile,
    pub sync: SyncState,
    pub user_offsets: HashMap<String, i64>,
}
#[derive(Clone)]
pub struct AppState {
    pub session: Arc<Mutex<SessionState>>,
    pub reports: Arc<Mutex<HashMap<String, StoredReport>>>,
    pub events: broadcast::Sender<WireEvent>,
    pub profile_path: Arc<PathBuf>,
    pub konger_dir: Arc<PathBuf>,
    pub offsets_path: Arc<PathBuf>,
    pub heartbeat: Arc<Mutex<Option<StoredHeartbeat>>>,
    pub browser_error: Arc<Mutex<Option<String>>>,
}

impl AppState {
    pub fn new(config_dir: PathBuf) -> Self {
        let (events, _) = broadcast::channel(64);
        let profile_path = Arc::new(config_dir.join("profile.json"));
        let konger_dir = Arc::new(config_dir.join("konger"));
        let offsets_path = Arc::new(config_dir.join("offsets.json"));
        let user_offsets = crate::sync_offset::load_offsets(&offsets_path);
        let profile = load_profile(&profile_path);
        Self {
            session: Arc::new(Mutex::new(SessionState {
                snapshot: Snapshot {
                    track: None,
                    state: "unavailable".into(),
                    position_ms: None,
                    sampled_at_ms: now_ms(),
                    playback_rate: 0.0,
                },
                sheet: None,
                active_source: None,
                active_browser_key: None,
                revision: 0,
                diagnostics: Vec::new(),
                manual_lyrics: false,
                lyric_candidate_track_key: None,
                lyric_candidate_ids: Vec::new(),
                profile,
                sync: SyncState::default(),
                user_offsets,
            })),
            reports: Arc::new(Mutex::new(HashMap::new())),
            events,
            profile_path,
            konger_dir,
            offsets_path,
            heartbeat: Arc::new(Mutex::new(None)),
            browser_error: Arc::new(Mutex::new(None)),
        }
    }
    pub fn emit(&self, name: &str, data: Value) {
        let _ = self.events.send(WireEvent {
            name: name.into(),
            data,
        });
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

/// 曲目相關 API 的 trackKey 長度上限（字元數）。
pub(crate) const MAX_TRACK_KEY_CHARS: usize = 512;

pub(crate) fn json_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({"error": message}))).into_response()
}

pub async fn serve(
    listener: TcpListener,
    state: AppState,
    assets: PathBuf,
) -> Result<(), std::io::Error> {
    let listener = TokioTcpListener::from_std(listener)?;
    let router = Router::new()
        .route("/", get(index))
        .route("/events", get(events))
        .route(
            "/api/media/browser",
            post(browser_report).options(browser_options),
        )
        .route("/api/profile", get(get_profile).post(update_profile))
        .route(
            "/api/media/browser/heartbeat",
            post(browser_heartbeat).options(browser_options),
        )
        .route("/api/lyrics/retry", post(crate::runtime::retry_lyrics))
        .route("/api/lyrics/search", post(crate::runtime::search_lyrics))
        .route("/api/lyrics/select", post(crate::runtime::select_lyrics))
        .route(
            "/api/lyrics/offset",
            post(crate::sync_offset::update_offset),
        )
        .route(
            "/api/konger/format",
            post(crate::konger::format_konger)
                .layer(DefaultBodyLimit::max(crate::konger::BODY_LIMIT)),
        )
        .route(
            "/api/konger/import",
            post(crate::konger::import_konger)
                .layer(DefaultBodyLimit::max(crate::konger::BODY_LIMIT)),
        )
        .route("/api/konger/remove", post(crate::konger::remove_konger))
        .route("/api/konger/export", post(crate::konger::export_konger))
        .nest_service("/assets", ServeDir::new(assets))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(state);
    axum::serve(listener, router).await
}

async fn index() -> Html<&'static str> {
    Html(include_str!("../../desktop-ui/index.html"))
}

async fn events(
    State(state): State<AppState>,
) -> Sse<impl futures_util::Stream<Item = Result<Event, Infallible>>> {
    let mut receiver = state.events.subscribe();
    let stream = async_stream::stream! {
        let initial = state.session.lock().await.clone();
        if let (Some(track), Some(sheet)) = (initial.snapshot.track, initial.sheet) {
            yield Ok(Event::default().event("lyrics-sheet").data(json!({"track": track, "sheet": sheet}).to_string()));
        }
        let initial = state.session.lock().await.clone();
        yield Ok(Event::default().event("playback-update").data(cursor_data(&initial).to_string()));
        loop { match receiver.recv().await {
            Ok(event) => yield Ok(Event::default().event(event.name).data(event.data.to_string())),
            Err(broadcast::error::RecvError::Lagged(_)) => continue,
            Err(broadcast::error::RecvError::Closed) => break,
        }}
    };
    Sse::new(stream).keep_alive(KeepAlive::default())
}

pub(crate) fn source_name(source: &str) -> &str {
    match source {
        "browser" => "Chrome / YouTube",
        "spotify-macos" => "Spotify (macOS)",
        "windows-smtc" => "Windows media session",
        "mock" => "Demo",
        _ => source,
    }
}

pub(crate) fn cursor_json(session: &SessionState) -> Value {
    let duration = session
        .snapshot
        .track
        .as_ref()
        .and_then(|track| track.duration_ms);
    let position = session.snapshot.position_ms.unwrap_or(0);
    let (offset, origin) = crate::sync_offset::effective_offset(session);
    let lyric_pos = position as i64 - offset;
    let current_line_index = session.sheet.as_ref().and_then(|sheet| {
        sheet
            .lines
            .iter()
            .enumerate()
            .filter(|(_, line)| line.start_ms.is_some_and(|start| start as i64 <= lyric_pos))
            .map(|(index, _)| index)
            .last()
    });
    let active_line_id = current_line_index.and_then(|index| {
        session
            .sheet
            .as_ref()?
            .lines
            .get(index)
            .map(|line| line.line_id.clone())
    });
    let progress = duration
        .filter(|duration| *duration > 0)
        .map_or(0, |duration| {
            ((position as f64 / duration as f64) * 100.0)
                .round()
                .clamp(0.0, 100.0) as u8
        });
    json!({
        "trackKey": session.snapshot.track.as_ref().map(|track| track.track_key.clone()),
        "currentLineIndex": current_line_index,
        "activeLineId": active_line_id,
        "positionMs": position,
        "durationMs": duration,
        "progressPercent": progress,
        "isPlaying": session.snapshot.state == "playing",
        "lyricsOffsetMs": offset,
        "offsetOrigin": origin,
    })
}

fn cursor_data(session: &SessionState) -> Value {
    json!({
        "track": session.snapshot.track,
        "state": session.snapshot.state,
        "activeSource": session.active_source,
        "sourceName": session.active_source.as_deref().map(source_name),
        "diagnostics": session.diagnostics,
        "cursor": cursor_json(session)
    })
}

async fn browser_options(headers: HeaderMap) -> Response {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !valid_extension_origin(origin) {
        return StatusCode::FORBIDDEN.into_response();
    }
    cors_response(StatusCode::NO_CONTENT, origin, Body::empty())
}

async fn browser_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(report): Json<BrowserReport>,
) -> Response {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !valid_extension_origin(origin) {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"browser reports require a Chrome extension origin"})),
        )
            .into_response();
    }
    if let Err(reason) = validate_report(&report) {
        *state.browser_error.lock().await = Some("Chrome could not provide supported media information. Reload the supported tab and extension.".into());
        return cors_response(
            StatusCode::BAD_REQUEST,
            origin,
            Body::from(json!({"error":reason}).to_string()),
        );
    }
    *state.browser_error.lock().await = None;
    let key = format!("{}:{}", report.tab_id, report.session_id);
    state.reports.lock().await.insert(
        key,
        StoredReport {
            report,
            received_at_ms: now_ms(),
        },
    );
    cors_response(StatusCode::NO_CONTENT, origin, Body::empty())
}

async fn browser_heartbeat(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(heartbeat): Json<BrowserHeartbeat>,
) -> Response {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !valid_extension_origin(origin) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let valid_tab = match &heartbeat.tab_id {
        Value::String(value) => !value.is_empty() && value.chars().count() <= 128,
        Value::Number(value) => value.as_u64().is_some(),
        _ => false,
    };
    if !matches!(heartbeat.app_id.as_str(), "youtube" | "youtube-music") || !valid_tab {
        return cors_response(
            StatusCode::BAD_REQUEST,
            origin,
            Body::from("invalid browser heartbeat"),
        );
    }
    let page = match Url::parse(&heartbeat.page_url) {
        Ok(page) => page,
        Err(_) => {
            return cors_response(
                StatusCode::BAD_REQUEST,
                origin,
                Body::from("invalid page url"),
            )
        }
    };
    if page.scheme() != "https"
        || !matches!(
            page.host_str(),
            Some("www.youtube.com" | "music.youtube.com")
        )
        || (heartbeat.app_id == "youtube" && page.host_str() != Some("www.youtube.com"))
        || (heartbeat.app_id == "youtube-music" && page.host_str() != Some("music.youtube.com"))
    {
        return cors_response(
            StatusCode::BAD_REQUEST,
            origin,
            Body::from("unsupported page"),
        );
    }
    if heartbeat
        .media_state
        .as_deref()
        .is_some_and(|v| !["no-video", "ready", "missing-metadata"].contains(&v))
    {
        return cors_response(
            StatusCode::BAD_REQUEST,
            origin,
            Body::from("invalid media state"),
        );
    }
    *state.heartbeat.lock().await = Some(StoredHeartbeat {
        media_state: heartbeat.media_state,
        received_at_ms: now_ms(),
    });
    cors_response(StatusCode::NO_CONTENT, origin, Body::empty())
}

fn valid_extension_origin(origin: &str) -> bool {
    Url::parse(origin).is_ok_and(|url| {
        url.scheme() == "chrome-extension"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
            && matches!(url.path(), "" | "/")
            && url.host_str().is_some_and(|host| {
                host.len() == 32 && host.bytes().all(|byte| (b'a'..=b'p').contains(&byte))
            })
    })
}

fn cors_response(status: StatusCode, origin: &str, body: Body) -> Response {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    if let Ok(value) = HeaderValue::from_str(origin) {
        response
            .headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
    }
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("POST, OPTIONS"),
    );
    response.headers_mut().insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type"),
    );
    response
}

fn validate_report(report: &BrowserReport) -> Result<(), &'static str> {
    let bounded = |text: &str, limit: usize| !text.is_empty() && text.chars().count() <= limit;
    if report.version != 1 {
        return Err("unsupported version");
    }
    if !bounded(&report.tab_id, 128) || !bounded(&report.session_id, 128) {
        return Err("invalid tab identity");
    }
    if report.app_id != "youtube" && report.app_id != "youtube-music" {
        return Err("invalid app id");
    }
    let page = Url::parse(&report.page_url).map_err(|_| "invalid page url")?;
    if page.scheme() != "https"
        || !matches!(
            page.host_str(),
            Some("www.youtube.com" | "music.youtube.com")
        )
    {
        return Err("unsupported page host");
    }
    if report.video_id.len() != 11
        || !report
            .video_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("invalid video id");
    }
    if !bounded(&report.title, 500) {
        return Err("missing title");
    }
    if report.artists.is_empty()
        || report.artists.len() > 8
        || report.artists.iter().any(|artist| !bounded(artist, 200))
    {
        return Err("missing or invalid artists");
    }
    if report
        .album
        .as_ref()
        .is_some_and(|album| !bounded(album, 500))
    {
        return Err("invalid album");
    }
    if !matches!(report.state.as_str(), "playing" | "paused" | "stopped") {
        return Err("invalid playback state");
    }
    if !report.position_ms.is_finite()
        || report.position_ms < 0.0
        || !report.duration_ms.is_finite()
        || report.duration_ms < 0.0
    {
        return Err("invalid position or duration");
    }
    if !report.playback_rate.is_finite() || !(0.0..=16.0).contains(&report.playback_rate) {
        return Err("invalid playback rate");
    }
    if !report.captured_at_ms.is_finite() || report.captured_at_ms < 0.0 {
        return Err("invalid capture time");
    }
    if report.is_ad == Some(true) {
        return Err("advertisement report");
    }
    Ok(())
}

const PROFILE_VERSION: u32 = 1;

fn default_profile() -> Profile {
    Profile {
        target_locale: "zh-TW".into(),
        passthrough_languages: vec![],
        allowed_systems: vec!["chinese".into()],
        source_preference: "auto".into(),
    }
}
#[derive(Serialize, Deserialize)]
struct VersionedProfile {
    version: u32,
    profile: Profile,
}
fn validate_profile(profile: &Profile) -> bool {
    ["zh-TW", "zh-CN", "en", "ja", "ko"].contains(&profile.target_locale.as_str())
        && profile.passthrough_languages.len() <= 4
        && profile
            .passthrough_languages
            .iter()
            .all(|v| ["zh", "en", "ja", "ko"].contains(&v.as_str()))
        && !profile.allowed_systems.is_empty()
        && profile.allowed_systems.len() <= 2
        && profile
            .allowed_systems
            .iter()
            .all(|v| ["chinese", "latin"].contains(&v.as_str()))
        && ["auto", "browser", "spotify-macos", "windows-smtc"]
            .contains(&profile.source_preference.as_str())
        && source_supported(&profile.source_preference)
}
fn source_supported(source: &str) -> bool {
    match source {
        "auto" | "browser" => true,
        "spotify-macos" => cfg!(target_os = "macos"),
        "windows-smtc" => cfg!(target_os = "windows"),
        _ => false,
    }
}
/// 注音顯示已移除：舊設定移除 bopomofo，若沒有其他系統則改用中文。
fn retire_bopomofo(profile: &mut Profile) {
    if profile.allowed_systems.iter().any(|v| v == "bopomofo") {
        profile.allowed_systems.retain(|v| v != "bopomofo");
        if profile.allowed_systems.is_empty() {
            profile.allowed_systems.push("chinese".into());
        }
    }
}
fn load_profile(path: &PathBuf) -> Profile {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<VersionedProfile>(&bytes).ok())
        .map(|mut stored| {
            retire_bopomofo(&mut stored.profile);
            stored
        })
        .filter(|stored| stored.version == PROFILE_VERSION && validate_profile(&stored.profile))
        .map(|stored| stored.profile)
        .unwrap_or_else(default_profile)
}
fn save_profile(path: &PathBuf, profile: &Profile) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec(&VersionedProfile {
        version: PROFILE_VERSION,
        profile: profile.clone(),
    })
    .map_err(std::io::Error::other)?;
    std::fs::write(path, bytes)
}
fn supported_sources() -> Vec<&'static str> {
    let mut v = vec!["browser"];
    if cfg!(target_os = "macos") {
        v.push("spotify-macos")
    }
    if cfg!(target_os = "windows") {
        v.push("windows-smtc")
    }
    v
}
async fn get_profile(State(state): State<AppState>) -> Json<Value> {
    let profile = state.session.lock().await.profile.clone();
    Json(json!({"profile":profile,"supportedSources":supported_sources()}))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProfileUpdate {
    target_locale: Option<String>,
    passthrough_languages: Option<Vec<String>>,
    allowed_systems: Option<Vec<String>>,
    source_preference: Option<String>,
    reset: Option<bool>,
}
async fn update_profile(
    State(state): State<AppState>,
    payload: Result<Json<ProfileUpdate>, JsonRejection>,
) -> Response {
    let Json(update) = match payload {
        Ok(value) => value,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error":"invalid profile update"})),
            )
                .into_response()
        }
    };
    let mut session = state.session.lock().await;
    let mut profile = if update.reset == Some(true) {
        default_profile()
    } else {
        session.profile.clone()
    };
    if update.reset == Some(true)
        && (update.target_locale.is_some()
            || update.passthrough_languages.is_some()
            || update.allowed_systems.is_some()
            || update.source_preference.is_some())
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"reset cannot be combined with profile updates"})),
        )
            .into_response();
    }
    if let Some(v) = update.target_locale {
        profile.target_locale = v;
    }
    if let Some(v) = update.passthrough_languages {
        profile.passthrough_languages = v;
    }
    if let Some(v) = update.allowed_systems {
        profile.allowed_systems = v;
    }
    if let Some(v) = update.source_preference {
        profile.source_preference = v;
    }
    let mut unique = Vec::new();
    for language in profile.passthrough_languages.drain(..) {
        if !unique.contains(&language) {
            unique.push(language)
        }
    }
    profile.passthrough_languages = unique;
    if !validate_profile(&profile) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"invalid profile value or unsupported source"})),
        )
            .into_response();
    }
    if let Err(error) = save_profile(&state.profile_path, &profile) {
        eprintln!("Unable to save local profile: {error}");
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({"error":"Unable to save preferences locally. Check that the application can write to its configuration folder."}))).into_response();
    }
    session.profile = profile.clone();
    let track = session.snapshot.track.clone();
    let sheet_event = session.sheet.as_mut().map(|sheet| {
        sheet.allowed_systems = profile.allowed_systems.clone();
        sheet.revision += 1;
        json!({"track":track,"sheet":sheet.clone()})
    });
    drop(session);
    if let Some(event) = sheet_event {
        state.emit("lyrics-sheet", event)
    }
    (
        StatusCode::OK,
        Json(json!({"success":true,"profile":profile,"supportedSources":supported_sources()})),
    )
        .into_response()
}

pub fn empty_snapshot() -> Snapshot {
    Snapshot {
        track: None,
        state: "unavailable".into(),
        position_ms: None,
        sampled_at_ms: now_ms(),
        playback_rate: 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        default_profile, load_profile, save_profile, validate_profile, validate_report,
        BrowserReport,
    };

    fn report() -> BrowserReport {
        BrowserReport {
            version: 1,
            tab_id: "tab-1".into(),
            session_id: "session-1".into(),
            app_id: "youtube".into(),
            page_url: "https://www.youtube.com/watch?v=abcdefghijk".into(),
            video_id: "abcdefghijk".into(),
            title: "Song".into(),
            artists: vec!["Artist".into()],
            album: None,
            state: "playing".into(),
            position_ms: 1000.0,
            duration_ms: 180_000.0,
            playback_rate: 1.0,
            captured_at_ms: 1000.0,
            is_ad: None,
        }
    }

    #[test]
    fn validates_public_youtube_session_metadata() {
        assert!(validate_report(&report()).is_ok());
        let mut invalid = report();
        invalid.page_url = "https://youtube.com/watch?v=abcdefghijk".into();
        assert_eq!(validate_report(&invalid), Err("unsupported page host"));
        invalid = report();
        invalid.is_ad = Some(true);
        assert_eq!(validate_report(&invalid), Err("advertisement report"));
    }

    #[test]
    fn rejects_incomplete_track_fields_instead_of_guessing() {
        let mut invalid = report();
        invalid.artists.clear();
        assert_eq!(validate_report(&invalid), Err("missing or invalid artists"));
    }

    #[test]
    fn defaults_and_validates_profile_values_and_platform_sources() {
        let profile = default_profile();
        assert_eq!(profile.target_locale, "zh-TW");
        assert_eq!(profile.allowed_systems, vec!["chinese"]);
        assert_eq!(profile.source_preference, "auto");
        assert!(validate_profile(&profile));
        let mut simplified = profile.clone();
        simplified.target_locale = "zh-CN".into();
        assert!(validate_profile(&simplified));
        let mut invalid = profile.clone();
        invalid.target_locale = "xx".into();
        assert!(!validate_profile(&invalid));
        invalid = profile.clone();
        invalid.source_preference = "not-a-source".into();
        assert!(!validate_profile(&invalid));
        invalid = profile.clone();
        invalid.allowed_systems = vec!["bopomofo".into()];
        assert!(!validate_profile(&invalid));
        if !cfg!(target_os = "windows") {
            invalid = profile;
            invalid.source_preference = "windows-smtc".into();
            assert!(!validate_profile(&invalid));
        }
    }

    #[test]
    fn persists_valid_version_and_falls_back_on_corrupt_or_unsupported_profile() {
        let path = std::env::temp_dir().join(format!(
            "lyrics-profile-{}-{}.json",
            std::process::id(),
            super::now_ms()
        ));
        let mut profile = default_profile();
        profile.target_locale = "ja".into();
        profile.passthrough_languages = vec!["en".into(), "ko".into()];
        profile.allowed_systems = vec!["latin".into()];
        profile.source_preference = "browser".into();
        save_profile(&path, &profile).unwrap();
        let loaded = load_profile(&path);
        assert_eq!(loaded.target_locale, "ja");
        assert_eq!(loaded.passthrough_languages, vec!["en", "ko"]);
        assert_eq!(loaded.allowed_systems, vec!["latin"]);
        assert_eq!(loaded.source_preference, "browser");
        std::fs::write(&path,r#"{"version":1,"profile":{"targetLocale":"ja","passthroughLanguages":[],"allowedSystems":["bopomofo"],"sourcePreference":"auto"}}"#).unwrap();
        let migrated = load_profile(&path);
        assert_eq!(migrated.allowed_systems, vec!["chinese"]);
        assert_eq!(migrated.target_locale, "ja");
        std::fs::write(&path,r#"{"version":999,"profile":{"targetLocale":"ja","passthroughLanguages":[],"allowedSystems":["chinese"],"sourcePreference":"auto"}}"#).unwrap();
        assert_eq!(load_profile(&path).target_locale, "zh-TW");
        std::fs::write(&path, "broken").unwrap();
        assert_eq!(load_profile(&path).source_preference, "auto");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn cursor_json_applies_offset_to_line_index_and_reports_offset_metadata() {
        use super::{
            cursor_json, LyricLine, LyricSheet, SessionState, Snapshot, SyncState, Track,
            TrackSource,
        };
        let sheet = LyricSheet {
            track_key: "youtube:xyz".into(),
            lyrics_id: "test".into(),
            revision: 1,
            status: "ready".into(),
            allowed_systems: vec![],
            lines: vec![
                LyricLine {
                    line_id: "line-1".into(),
                    start_ms: Some(1_000),
                    end_ms: Some(15_000),
                    original_text: "Line 1".into(),
                    phonetic: None,
                },
                LyricLine {
                    line_id: "line-2".into(),
                    start_ms: Some(15_000),
                    end_ms: Some(30_000),
                    original_text: "Line 2".into(),
                    phonetic: None,
                },
            ],
            lyrics_source: "user".into(),
        };
        let mut user_offsets = std::collections::HashMap::new();
        user_offsets.insert("youtube:xyz".into(), 10_000);
        let session = SessionState {
            snapshot: Snapshot {
                track: Some(Track {
                    track_key: "youtube:xyz".into(),
                    source: TrackSource {
                        connector: "browser".into(),
                        app_id: None,
                        source_track_id: Some("xyz".into()),
                    },
                    title: "Song".into(),
                    artists: vec!["Artist".into()],
                    album: None,
                    duration_ms: Some(180_000),
                }),
                state: "playing".into(),
                position_ms: Some(5_000),
                sampled_at_ms: 0,
                playback_rate: 1.0,
            },
            sheet: Some(sheet),
            active_source: Some("browser".into()),
            active_browser_key: None,
            revision: 1,
            diagnostics: vec![],
            manual_lyrics: true,
            lyric_candidate_track_key: None,
            lyric_candidate_ids: vec![],
            profile: default_profile(),
            sync: SyncState::default(),
            user_offsets,
        };

        let c1 = cursor_json(&session);
        assert_eq!(c1["currentLineIndex"], serde_json::Value::Null);
        assert_eq!(c1["lyricsOffsetMs"], 10_000);
        assert_eq!(c1["offsetOrigin"], "user");
        assert_eq!(c1["positionMs"], 5_000);

        let mut session2 = session.clone();
        session2.snapshot.position_ms = Some(12_000);
        let c2 = cursor_json(&session2);
        assert_eq!(c2["currentLineIndex"], 0);
        assert_eq!(c2["activeLineId"], "line-1");
        assert_eq!(c2["positionMs"], 12_000);
    }
}
