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
    extract::{DefaultBodyLimit, State},
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
#[derive(Clone)]
pub struct WireEvent {
    pub name: String,
    pub data: Value,
}
#[derive(Clone)]
pub struct SessionState {
    pub snapshot: Snapshot,
    pub sheet: Option<LyricSheet>,
    pub active_source: Option<String>,
    pub active_browser_key: Option<String>,
    pub revision: u64,
    pub profile: Profile,
}
#[derive(Clone)]
pub struct AppState {
    pub session: Arc<Mutex<SessionState>>,
    pub reports: Arc<Mutex<HashMap<String, StoredReport>>>,
    pub events: broadcast::Sender<WireEvent>,
}

impl AppState {
    pub fn new() -> Self {
        let (events, _) = broadcast::channel(64);
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
                profile: Profile {
                    target_locale: "zh-TW".into(),
                    passthrough_languages: Vec::new(),
                    allowed_systems: vec!["chinese".into()],
                },
            })),
            reports: Arc::new(Mutex::new(HashMap::new())),
            events,
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
        .route("/api/profile", post(update_profile))
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

fn cursor_data(session: &SessionState) -> Value {
    let duration = session
        .snapshot
        .track
        .as_ref()
        .and_then(|track| track.duration_ms);
    let position = session.snapshot.position_ms.unwrap_or(0);
    let current_line_index = session.sheet.as_ref().and_then(|sheet| {
        sheet
            .lines
            .iter()
            .enumerate()
            .filter(|(_, line)| line.start_ms.is_some_and(|start| start <= position))
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
    json!({"cursor": {"trackKey": session.snapshot.track.as_ref().map(|track| track.track_key.clone()), "currentLineIndex": current_line_index, "activeLineId": active_line_id, "positionMs": position, "durationMs": duration, "progressPercent": progress, "isPlaying": session.snapshot.state == "playing"}})
}

async fn browser_options(headers: HeaderMap) -> Response {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    if !origin.starts_with("chrome-extension://") {
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
    if !origin.starts_with("chrome-extension://") {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({"error":"browser reports require a Chrome extension origin"})),
        )
            .into_response();
    }
    if let Err(reason) = validate_report(&report) {
        return cors_response(
            StatusCode::BAD_REQUEST,
            origin,
            Body::from(json!({"error":reason}).to_string()),
        );
    }
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProfileUpdate {
    target_locale: Option<String>,
    passthrough_languages: Option<Vec<String>>,
    allowed_systems: Option<Vec<String>>,
}

async fn update_profile(
    State(state): State<AppState>,
    Json(update): Json<ProfileUpdate>,
) -> Json<Value> {
    let mut session = state.session.lock().await;
    if let Some(locale) = update
        .target_locale
        .filter(|value| ["zh-TW", "en", "ja", "ko"].contains(&value.as_str()))
    {
        session.profile.target_locale = locale;
    }
    if let Some(languages) = update.passthrough_languages {
        let mut unique = Vec::new();
        for language in languages
            .into_iter()
            .filter(|value| ["zh", "en", "ja", "ko"].contains(&value.as_str()))
        {
            if !unique.contains(&language) {
                unique.push(language);
            }
        }
        session.profile.passthrough_languages = unique;
    }
    if let Some(systems) = update.allowed_systems {
        let systems: Vec<_> = systems
            .into_iter()
            .filter(|value| ["chinese", "bopomofo", "latin"].contains(&value.as_str()))
            .take(3)
            .collect();
        if !systems.is_empty() {
            session.profile.allowed_systems = systems;
        }
    }
    let profile = session.profile.clone();
    let track = session.snapshot.track.clone();
    let sheet_event = session.sheet.as_mut().map(|sheet| {
        sheet.revision += 1;
        json!({"track": track, "sheet": sheet.clone()})
    });
    drop(session);
    if let Some(event) = sheet_event {
        state.emit("lyrics-sheet", event);
    }
    Json(json!({"success":true,"profile":profile}))
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
    use super::{validate_report, BrowserReport};

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
}
