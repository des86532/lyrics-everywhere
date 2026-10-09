use std::time::Duration;

use axum::{extract::State, http::StatusCode, response::IntoResponse, response::Response, Json};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use tokio::time;

use crate::server::{
    now_ms, source_name, AppState, LyricLine, LyricSheet, Snapshot, StoredHeartbeat, StoredReport,
    Track, TrackSource, STALE_AFTER_MS,
};

#[derive(Clone)]
struct Candidate {
    name: &'static str,
    snapshot: Snapshot,
    report_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LrclibRecord {
    id: u64,
    #[serde(default)]
    track_name: String,
    #[serde(default)]
    artist_name: String,
    #[serde(default)]
    album_name: String,
    duration: f64,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
}

fn browser_diagnostic(
    heartbeat: Option<&StoredHeartbeat>,
    reports_fresh: bool,
    error: Option<&str>,
    now: u64,
) -> serde_json::Value {
    let (state, message, available) = if let Some(error) = error {
        ("error", error, false)
    } else if reports_fresh {
        ("connected", "Chrome media is connected.", true)
    } else if let Some(heartbeat) =
        heartbeat.filter(|h| now.saturating_sub(h.received_at_ms) <= STALE_AFTER_MS)
    {
        let (state, message) = match heartbeat.media_state.as_deref() {
            Some("missing-metadata") => (
                "missing-metadata",
                "A supported tab is open, but its media title or artist is unavailable.",
            ),
            Some("no-video") => (
                "no-media",
                "A supported tab is open, but no video is currently available.",
            ),
            _ => (
                "waiting",
                "A supported tab is active; waiting for media information.",
            ),
        };
        (state, message, false)
    } else if heartbeat.is_some() {
        (
            "stale",
            "The latest supported-tab signal is stale; reopen or resume the supported tab.",
            false,
        )
    } else {
        ("no-supported-tab", "No recent supported-tab signal. Install or open the extension and play supported YouTube media.", false)
    };
    json!({"id":"browser","state":state,"message":message,"available":available})
}

pub async fn poll(state: AppState) {
    let mut interval = time::interval(Duration::from_secs(1));
    loop {
        interval.tick().await;
        let (browser, system) = tokio::join!(browser_snapshot(&state), system_snapshot());
        let system_for_diagnostics = system.first().map(|candidate| candidate.snapshot.clone());
        let demo = std::env::args().any(|arg| arg == "--demo");
        let candidates = if demo {
            vec![demo_snapshot()]
        } else {
            system.into_iter().chain(browser).collect()
        };
        let (snapshot, active_source, active_browser_key) = {
            let session = state.session.lock().await;
            choose(
                candidates,
                session.active_source.as_deref(),
                &session.profile.source_preference,
            )
        };
        let (track_changed, track, source_changed) = {
            let mut session = state.session.lock().await;
            let previous_key = session
                .snapshot
                .track
                .as_ref()
                .map(|track| track.track_key.clone());
            let next_key = snapshot.track.as_ref().map(|track| track.track_key.clone());
            session.snapshot = snapshot;
            let source_changed = session.active_source != active_source;
            session.active_source = active_source;
            if session.active_source.as_deref() == Some("browser") {
                session.active_browser_key = active_browser_key;
            }
            if previous_key != next_key {
                session.manual_lyrics = false;
                session.lyric_candidate_track_key = None;
                session.lyric_candidate_ids.clear();
                session.revision += 1;
                session.sheet = session.snapshot.track.as_ref().map(|track| LyricSheet {
                    track_key: track.track_key.clone(),
                    lyrics_id: String::new(),
                    revision: session.revision,
                    status: "loading".into(),
                    allowed_systems: session.profile.allowed_systems.clone(),
                    lines: Vec::new(),
                });
                (true, session.snapshot.track.clone(), source_changed)
            } else {
                (false, None, source_changed)
            }
        };
        if track_changed {
            let current = state.session.lock().await.clone();
            if let (Some(track), Some(sheet)) = (current.snapshot.track.clone(), current.sheet) {
                state.emit("lyrics-sheet", json!({"track": track, "sheet": sheet}));
            }
            if let Some(track) = track {
                let background = state.clone();
                tokio::spawn(async move {
                    resolve_track_lyrics(background, track).await;
                });
            }
        }
        let heartbeat = state.heartbeat.lock().await.clone();
        let reports_fresh = !state.reports.lock().await.is_empty();
        let now = now_ms();
        let browser_error = state.browser_error.lock().await.clone();
        let browser_status = browser_diagnostic(
            heartbeat.as_ref(),
            reports_fresh,
            browser_error.as_deref(),
            now,
        );
        let mut diagnostics = vec![browser_status];
        #[cfg(target_os = "macos")]
        let system_id = "spotify-macos";
        #[cfg(target_os = "windows")]
        let system_id = "windows-smtc";
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let system_id = "system";
        diagnostics.push(if let Some(snapshot)=system_for_diagnostics {json!({"id":system_id,"state":if snapshot.state=="paused" {"paused"} else {"available"},"message":if snapshot.state=="paused" {"System media session is paused."} else {"System media session is available."},"available":true})} else {json!({"id":system_id,"state":"no-session","message":"No system media session with readable track information is available.","available":false})});
        let (diagnostics_event, playback_event) = {
            let mut session = state.session.lock().await;
            let diagnostics_changed = session.diagnostics != diagnostics;
            session.diagnostics = diagnostics;
            let diagnostics_event = (source_changed || diagnostics_changed).then(|| {
                json!({
                    "activeSource": session.active_source,
                    "sourceName": session.active_source.as_deref().map(source_name),
                    "diagnostics": session.diagnostics
                })
            });
            (diagnostics_event, cursor_event(&session))
        };
        if let Some(event) = diagnostics_event {
            state.emit("source-diagnostics", event);
        }
        state.emit("playback-update", playback_event);
    }
}

fn choose(
    mut candidates: Vec<Candidate>,
    active: Option<&str>,
    preference: &str,
) -> (Snapshot, Option<String>, Option<String>) {
    candidates.retain(|candidate| {
        candidate.snapshot.state != "unavailable" && candidate.snapshot.track.is_some()
    });
    if preference != "auto" {
        if let Some(selected) = candidates
            .into_iter()
            .find(|candidate| candidate.name == preference)
        {
            return (
                selected.snapshot,
                Some(selected.name.into()),
                selected.report_key,
            );
        }
        return (crate::server::empty_snapshot(), None, None);
    }
    if candidates.is_empty() {
        return (crate::server::empty_snapshot(), None, None);
    }
    let windows = cfg!(target_os = "windows");
    let priority: &[&str] = if windows {
        &["browser", "windows-smtc"]
    } else if cfg!(target_os = "macos") {
        &["spotify-macos", "browser"]
    } else {
        &["browser"]
    };
    let rank = |name: &str| {
        if preference != "auto" {
            return if name == preference { 0 } else { 1 };
        }
        priority
            .iter()
            .position(|item| *item == name)
            .unwrap_or(priority.len())
    };
    if let Some(name) = active {
        if let Some(current) = candidates
            .iter()
            .find(|candidate| candidate.name == name && candidate.snapshot.state == "playing")
        {
            return (
                current.snapshot.clone(),
                Some(current.name.into()),
                current.report_key.clone(),
            );
        }
    }
    let mut playing: Vec<_> = candidates
        .iter()
        .filter(|candidate| candidate.snapshot.state == "playing")
        .collect();
    if !playing.is_empty() {
        playing.sort_by_key(|candidate| rank(candidate.name));
        let selected = playing[0];
        return (
            selected.snapshot.clone(),
            Some(selected.name.into()),
            selected.report_key.clone(),
        );
    }
    if let Some(current) = candidates
        .iter()
        .find(|candidate| Some(candidate.name) == active)
    {
        return (
            current.snapshot.clone(),
            Some(current.name.into()),
            current.report_key.clone(),
        );
    }
    candidates.sort_by_key(|candidate| rank(candidate.name));
    let selected = candidates.remove(0);
    (
        selected.snapshot,
        Some(selected.name.into()),
        selected.report_key,
    )
}

async fn browser_snapshot(state: &AppState) -> Vec<Candidate> {
    let now = now_ms();
    let mut reports = state.reports.lock().await;
    reports.retain(|_, stored| now.saturating_sub(stored.received_at_ms) <= STALE_AFTER_MS);
    if reports.is_empty() {
        return Vec::new();
    }
    let (active_source, active_key) = {
        let session = state.session.lock().await;
        (
            session.active_source.clone(),
            session.active_browser_key.clone(),
        )
    };
    let selected = select_report(&reports, active_source.as_deref(), active_key.as_deref());
    selected
        .map(|(key, stored)| {
            vec![Candidate {
                name: "browser",
                snapshot: report_snapshot(&stored.report),
                report_key: Some(key.clone()),
            }]
        })
        .unwrap_or_default()
}

fn select_report<'a>(
    reports: &'a std::collections::HashMap<String, StoredReport>,
    active_source: Option<&str>,
    active_key: Option<&str>,
) -> Option<(&'a String, &'a StoredReport)> {
    let active = if active_source == Some("browser") {
        active_key.and_then(|key| reports.get_key_value(key))
    } else {
        None
    };
    if active.is_some_and(|(_, stored)| stored.report.state == "playing") {
        return active;
    }
    reports
        .iter()
        .filter(|(_, stored)| stored.report.state == "playing")
        .max_by_key(|(_, stored)| stored.received_at_ms)
        .or(active)
        .or_else(|| {
            reports
                .iter()
                .max_by_key(|(_, stored)| stored.received_at_ms)
        })
}

fn report_snapshot(report: &crate::server::BrowserReport) -> Snapshot {
    Snapshot {
        track: Some(Track {
            track_key: format!("youtube:{}", report.video_id),
            source: TrackSource {
                connector: "browser".into(),
                app_id: Some(report.app_id.clone()),
                source_track_id: Some(report.video_id.clone()),
            },
            title: report.title.clone(),
            artists: report.artists.clone(),
            album: report.album.clone(),
            duration_ms: (report.duration_ms > 0.0).then_some(report.duration_ms.round() as u64),
        }),
        state: report.state.clone(),
        position_ms: Some(report.position_ms.round() as u64),
        sampled_at_ms: report.captured_at_ms.round() as u64,
        playback_rate: report.playback_rate,
    }
}

async fn system_snapshot() -> Vec<Candidate> {
    #[cfg(target_os = "windows")]
    {
        return tokio::task::spawn_blocking(windows_smtc_snapshot)
            .await
            .ok()
            .flatten()
            .into_iter()
            .map(|snapshot| Candidate {
                name: "windows-smtc",
                snapshot,
                report_key: None,
            })
            .collect();
    }
    #[cfg(target_os = "macos")]
    {
        return spotify_snapshot()
            .await
            .into_iter()
            .map(|snapshot| Candidate {
                name: "spotify-macos",
                snapshot,
                report_key: None,
            })
            .collect();
    }
    #[allow(unreachable_code)]
    Vec::new()
}

#[cfg(target_os = "macos")]
async fn spotify_snapshot() -> Option<Snapshot> {
    let script = r#"
      tell application "System Events" to set isRunning to (count (every process whose name is "Spotify")) > 0
      if not isRunning then return "stopped"
      tell application "Spotify"
        return (player state as string) & "|||" & (name of current track) & "|||" & (artist of current track) & "|||" & (album of current track) & "|||" & (duration of current track as string) & "|||" & (player position as string) & "|||" & (id of current track)
      end tell
    "#;
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::process::Command::new("osascript")
            .args(["-e", script])
            .output(),
    )
    .await
    .ok()?
    .ok()?;
    if !result.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&result.stdout).trim().to_owned();
    if raw == "stopped" || raw.is_empty() {
        return None;
    }
    let mut parts = raw.split("|||");
    let state = parts.next()?.to_lowercase();
    let title = parts.next()?.trim().to_owned();
    let artist = parts.next()?.trim().to_owned();
    let album = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let duration_ms = parts.next()?.parse::<u64>().ok().filter(|value| *value > 0);
    let position_ms = parts
        .next()?
        .parse::<f64>()
        .ok()
        .map(|value| (value * 1000.0).max(0.0) as u64);
    let source_track_id = parts
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    if title.is_empty()
        || artist.is_empty()
        || !matches!(state.as_str(), "playing" | "paused" | "stopped")
    {
        return None;
    }
    let key = source_track_id
        .as_deref()
        .map(|id| id.replace("spotify:track:", ""))
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| format!("{artist}-{title}"));
    Some(Snapshot {
        track: Some(Track {
            track_key: format!("spotify:{key}"),
            source: TrackSource {
                connector: "spotify-macos".into(),
                app_id: Some("Spotify".into()),
                source_track_id,
            },
            title,
            artists: vec![artist],
            album,
            duration_ms,
        }),
        state: state.clone(),
        position_ms,
        sampled_at_ms: now_ms(),
        playback_rate: if state == "playing" { 1.0 } else { 0.0 },
    })
}

#[cfg(target_os = "windows")]
struct WinRtApartment;

#[cfg(target_os = "windows")]
impl WinRtApartment {
    fn new() -> Option<Self> {
        use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
        unsafe {
            RoInitialize(RO_INIT_MULTITHREADED).ok()?;
        }
        Some(Self)
    }
}

#[cfg(target_os = "windows")]
impl Drop for WinRtApartment {
    fn drop(&mut self) {
        unsafe {
            windows::Win32::System::WinRT::RoUninitialize();
        }
    }
}

#[cfg(target_os = "windows")]
fn windows_smtc_snapshot() -> Option<Snapshot> {
    let _apartment = WinRtApartment::new()?;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };
    let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .ok()?
        .get()
        .ok()?;
    let session = manager.GetCurrentSession().ok()?;
    let properties = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let title = properties.Title().ok()?.to_string();
    let artist = properties.Artist().ok()?.to_string();
    if title.trim().is_empty() || artist.trim().is_empty() {
        return None;
    }
    let playback = session.GetPlaybackInfo().ok()?;
    let state = match playback.PlaybackStatus().ok()? {
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing => "playing",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused => "paused",
        GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped => "stopped",
        _ => return None,
    };
    let timeline = session.GetTimelineProperties().ok()?;
    let position = timeline.Position().ok()?.Duration;
    let end = timeline.EndTime().ok()?.Duration;
    let start = timeline.StartTime().ok()?.Duration;
    let duration_ms = (end > start).then_some(((end - start) / 10_000) as u64);
    let app_id = session.SourceAppUserModelId().ok()?.to_string();
    if app_id.is_empty() {
        return None;
    }
    let album = properties.AlbumTitle().ok()?.to_string();
    let album = (!album.trim().is_empty()).then_some(album);
    let track_key = format!(
        "windows-smtc:{}",
        serde_json::to_string(&[
            app_id.as_str(),
            title.trim(),
            artist.trim(),
            album.as_deref().unwrap_or("")
        ])
        .ok()?
    );
    Some(Snapshot {
        track: Some(Track {
            track_key,
            source: TrackSource {
                connector: "windows-smtc".into(),
                app_id: Some(app_id),
                source_track_id: None,
            },
            title: title.trim().into(),
            artists: vec![artist.trim().into()],
            album,
            duration_ms,
        }),
        state: state.into(),
        position_ms: (position >= 0).then_some((position / 10_000) as u64),
        sampled_at_ms: now_ms(),
        playback_rate: playback
            .PlaybackRate()
            .ok()
            .and_then(|rate| rate.Value().ok())
            .filter(|rate| rate.is_finite())
            .unwrap_or(if state == "playing" { 1.0 } else { 0.0 }),
    })
}

fn demo_snapshot() -> Candidate {
    let seconds = now_ms() / 1000 % 274;
    Candidate {
        name: "mock",
        report_key: None,
        snapshot: Snapshot {
            track: Some(Track {
                track_key: "demo:bts-spring-day".into(),
                source: TrackSource {
                    connector: "mock".into(),
                    app_id: None,
                    source_track_id: None,
                },
                title: "봄날 (Spring Day)".into(),
                artists: vec!["BTS (방탄소년단)".into()],
                album: Some("YOU NEVER WALK ALONE".into()),
                duration_ms: Some(274_000),
            }),
            state: "playing".into(),
            position_ms: Some((seconds * 1000) % 274_000),
            sampled_at_ms: now_ms(),
            playback_rate: 1.0,
        },
    }
}

fn cursor_event(session: &crate::server::SessionState) -> serde_json::Value {
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
    json!({
        "cursor": {
            "trackKey": session.snapshot.track.as_ref().map(|track| track.track_key.clone()),
            "currentLineIndex": current_line_index,
            "activeLineId": active_line_id,
            "positionMs": position,
            "durationMs": duration,
            "progressPercent": progress,
            "isPlaying": session.snapshot.state == "playing"
        }
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetryRequest {
    track_key: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SearchRequest {
    track_key: String,
    title: String,
    artist: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SelectRequest {
    track_key: String,
    record_id: u64,
}

fn matches_current(track: Option<&Track>, key: &str) -> bool {
    track.is_some_and(|track| track.track_key == key)
}
fn record_has_lyrics(record: &LrclibRecord) -> bool {
    record
        .synced_lyrics
        .as_ref()
        .is_some_and(|s| !s.trim().is_empty())
        || record
            .plain_lyrics
            .as_ref()
            .is_some_and(|s| !s.trim().is_empty())
}
fn candidate_json(record: &LrclibRecord) -> serde_json::Value {
    json!({"id":record.id,"trackName":record.track_name,"artistName":record.artist_name,"albumName":record.album_name,"duration":record.duration,"synced":record.synced_lyrics.as_ref().is_some_and(|s| !s.trim().is_empty())})
}
const LRCLIB_AGENT: &str = "LyricsEverywhere/0.1.0 (https://github.com/des86532/lyrics-everywhere)";
async fn search_records(title: &str, artist: &str) -> Result<Vec<LrclibRecord>, ()> {
    Client::new()
        .get("https://lrclib.net/api/search")
        .query(&[("track_name", title), ("artist_name", artist)])
        .header("User-Agent", LRCLIB_AGENT)
        .send()
        .await
        .map_err(|_| ())?
        .error_for_status()
        .map_err(|_| ())?
        .json()
        .await
        .map_err(|_| ())
}
async fn get_record(id: u64) -> Result<LrclibRecord, ()> {
    Client::new()
        .get(format!("https://lrclib.net/api/get/{id}"))
        .header("User-Agent", LRCLIB_AGENT)
        .send()
        .await
        .map_err(|_| ())?
        .error_for_status()
        .map_err(|_| ())?
        .json()
        .await
        .map_err(|_| ())
}
fn may_apply_record(track_is_current: bool, manual_override: bool, is_manual: bool) -> bool {
    track_is_current && (is_manual || !manual_override)
}
async fn apply_record(state: AppState, track_key: &str, record: LrclibRecord, manual: bool) {
    if !record_has_lyrics(&record) {
        set_lyrics_status(&state, track_key, "not-found").await;
        return;
    }
    let lyrics = record
        .synced_lyrics
        .as_deref()
        .or(record.plain_lyrics.as_deref())
        .map(parse_lrc);
    if let Some((lyrics_id, lines)) = lyrics {
        let mut session = state.session.lock().await;
        if !may_apply_record(
            matches_current(session.snapshot.track.as_ref(), track_key),
            session.manual_lyrics,
            manual,
        ) {
            return;
        }
        if manual {
            session.manual_lyrics = true;
        }
        session.revision += 1;
        let sheet = LyricSheet {
            track_key: track_key.into(),
            lyrics_id,
            revision: session.revision,
            status: "ready".into(),
            allowed_systems: session.profile.allowed_systems.clone(),
            lines,
        };
        session.sheet = Some(sheet.clone());
        let track = session.snapshot.track.clone();
        drop(session);
        state.emit("lyrics-sheet", json!({"track":track,"sheet":sheet}));
    }
}
async fn set_lyrics_status(state: &AppState, track_key: &str, status: &str) {
    let mut session = state.session.lock().await;
    if !matches_current(session.snapshot.track.as_ref(), track_key) || session.manual_lyrics {
        return;
    }
    session.revision += 1;
    let sheet = LyricSheet {
        track_key: track_key.into(),
        lyrics_id: String::new(),
        revision: session.revision,
        status: status.into(),
        allowed_systems: session.profile.allowed_systems.clone(),
        lines: Vec::new(),
    };
    session.sheet = Some(sheet.clone());
    let track = session.snapshot.track.clone();
    drop(session);
    state.emit("lyrics-sheet", json!({"track": track, "sheet": sheet}));
}
async fn automatic_lookup(track: &Track) -> Result<Option<LrclibRecord>, ()> {
    let client = Client::new();
    let mut request = client
        .get("https://lrclib.net/api/get")
        .query(&[
            ("track_name", track.title.as_str()),
            (
                "artist_name",
                track.artists.first().map(String::as_str).unwrap_or(""),
            ),
        ])
        .header("User-Agent", LRCLIB_AGENT);
    if let Some(album) = track.album.as_deref() {
        request = request.query(&[("album_name", album)])
    }
    if let Some(duration) = track.duration_ms {
        request = request.query(&[("duration", ((duration + 500) / 1000).to_string())])
    }
    match request.send().await {
        Ok(response) if response.status().is_success() => {
            match response.json::<LrclibRecord>().await {
                Ok(record) if record_has_lyrics(&record) => return Ok(Some(record)),
                Ok(_) => {}
                Err(_) => return Err(()),
            }
        }
        Ok(response) if response.status().as_u16() != 404 => return Err(()),
        Err(_) => return Err(()),
        _ => {}
    }
    let mut records = search_records(
        &track.title,
        track.artists.first().map(String::as_str).unwrap_or(""),
    )
    .await?;
    records.retain(record_has_lyrics);
    let duration = track.duration_ms.map(|v| v as f64 / 1000.);
    records.sort_by(|a, b| {
        let score = |r: &LrclibRecord| {
            (if r
                .synced_lyrics
                .as_ref()
                .is_some_and(|x| !x.trim().is_empty())
            {
                50.
            } else {
                0.
            }) + duration.map_or(0., |d| (40. - (r.duration - d).abs() * 5.).max(-100.))
        };
        score(b).total_cmp(&score(a))
    });
    Ok(records.into_iter().next())
}
async fn resolve_track_lyrics(state: AppState, track: Track) {
    set_lyrics_status(&state, &track.track_key, "loading").await;
    match automatic_lookup(&track).await {
        Ok(Some(record)) => apply_record(state, &track.track_key, record, false).await,
        Ok(None) => set_lyrics_status(&state, &track.track_key, "not-found").await,
        Err(()) => set_lyrics_status(&state, &track.track_key, "error").await,
    }
}
pub async fn retry_lyrics(
    State(state): State<AppState>,
    Json(request): Json<RetryRequest>,
) -> Response {
    let mut session = state.session.lock().await;
    let track = session.snapshot.track.clone();
    if !matches_current(track.as_ref(), &request.track_key) {
        return (
            StatusCode::CONFLICT,
            Json(json!({"error": "track is no longer current"})),
        )
            .into_response();
    }
    session.manual_lyrics = false;
    drop(session);
    let background = state.clone();
    tokio::spawn(async move {
        resolve_track_lyrics(background, track.unwrap()).await;
    });
    (StatusCode::ACCEPTED, Json(json!({"success": true}))).into_response()
}
pub async fn search_lyrics(
    State(state): State<AppState>,
    Json(request): Json<SearchRequest>,
) -> Response {
    if request.title.trim().is_empty()
        || request.artist.trim().is_empty()
        || request.title.chars().count() > 200
        || request.artist.chars().count() > 200
    {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"title and artist must be non-empty and at most 200 characters"})),
        )
            .into_response();
    }
    let track = state.session.lock().await.snapshot.track.clone();
    if !matches_current(track.as_ref(), &request.track_key) {
        return (
            StatusCode::CONFLICT,
            Json(json!({"error":"track is no longer current"})),
        )
            .into_response();
    }
    match search_records(request.title.trim(),request.artist.trim()).await {Ok(records)=>{let eligible:Vec<_>=records.into_iter().filter(record_has_lyrics).take(30).collect(); let candidates:Vec<_>=eligible.iter().map(candidate_json).collect(); let mut session=state.session.lock().await;if !matches_current(session.snapshot.track.as_ref(),&request.track_key){return (StatusCode::CONFLICT,Json(json!({"error":"track is no longer current"}))).into_response()}session.lyric_candidate_track_key=Some(request.track_key.clone());session.lyric_candidate_ids=eligible.iter().map(|r|r.id).collect(); drop(session);(StatusCode::OK,Json(json!({"candidates":candidates}))).into_response()},Err(())=>(StatusCode::BAD_GATEWAY,Json(json!({"error":"LRCLIB could not be reached. Check the internet connection and try again."}))).into_response()}
}
pub async fn select_lyrics(
    State(state): State<AppState>,
    Json(request): Json<SelectRequest>,
) -> Response {
    if request.record_id == 0 {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"invalid record id"})),
        )
            .into_response();
    }
    if !matches_current(
        state.session.lock().await.snapshot.track.as_ref(),
        &request.track_key,
    ) {
        return (
            StatusCode::CONFLICT,
            Json(json!({"error":"track is no longer current"})),
        )
            .into_response();
    }
    {
        let session = state.session.lock().await;
        if session.lyric_candidate_track_key.as_deref() != Some(&request.track_key)
            || !session.lyric_candidate_ids.contains(&request.record_id)
        {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({"error":"record is not a current search candidate"})),
            )
                .into_response();
        }
    }
    match get_record(request.record_id).await {
        Ok(record) => {
            let session = state.session.lock().await;
            if !matches_current(session.snapshot.track.as_ref(), &request.track_key) {
                return (StatusCode::CONFLICT, Json(json!({"error": "track is no longer current"}))).into_response();
            }
            drop(session);
            if !record_has_lyrics(&record) {
                return (StatusCode::NOT_FOUND, Json(json!({"error": "selected LRCLIB record has no lyrics"}))).into_response();
            }
            apply_record(state, &request.track_key, record, true).await;
            (StatusCode::OK, Json(json!({"success": true}))).into_response()
        }
        Err(()) => (StatusCode::BAD_GATEWAY, Json(json!({"error": "LRCLIB record could not be loaded. Check the internet connection and try again."}))).into_response(),
    }
}

fn parse_lrc(raw: &str) -> (String, Vec<LyricLine>) {
    let mut offset = 0_i64;
    for line in raw.lines() {
        let lowered = line.trim().to_ascii_lowercase();
        if let Some(value) = lowered
            .strip_prefix("[offset:")
            .and_then(|value| value.strip_suffix(']'))
        {
            offset = value.trim().parse().unwrap_or(0);
        }
    }
    let mut rows = Vec::<(Option<u64>, String)>::new();
    let mut has_timestamps = false;
    for line in raw.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let lower = line.to_ascii_lowercase();
        if [
            "[ti:", "[ar:", "[al:", "[by:", "[length:", "[re:", "[ve:", "[offset:",
        ]
        .iter()
        .any(|prefix| lower.starts_with(prefix))
        {
            continue;
        }
        let mut remainder = line;
        let mut starts = Vec::new();
        while let Some(value) = remainder.strip_prefix('[') {
            let Some(end) = value.find(']') else { break };
            let Some(time) = parse_time(&value[..end]) else {
                break;
            };
            starts.push(time);
            remainder = &value[end + 1..];
        }
        if starts.is_empty() {
            rows.push((None, line.to_owned()));
            continue;
        }
        has_timestamps = true;
        let text = remove_enhanced_timestamps(remainder.trim());
        for start in starts {
            let adjusted =
                (i128::from(start) + i128::from(offset)).clamp(0, u64::MAX as i128) as u64;
            rows.push((Some(adjusted), text.clone()));
        }
    }
    if has_timestamps {
        rows.sort_by_key(|(start, _)| start.unwrap_or(0));
    }
    let lines = rows
        .iter()
        .enumerate()
        .map(|(index, (start, text))| LyricLine {
            line_id: format!("line-{}", index + 1),
            start_ms: *start,
            end_ms: if has_timestamps {
                start.map(|start| {
                    rows.get(index + 1)
                        .and_then(|(next, _)| *next)
                        .unwrap_or(start + 4000)
                })
            } else {
                None
            },
            original_text: text.clone(),
        })
        .collect();
    let digest = Sha256::digest(raw.as_bytes());
    let hash = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    (format!("lyrics-{}", &hash[..12]), lines)
}

fn remove_enhanced_timestamps(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut index = 0;
    while index < text.len() {
        let remaining = &text[index..];
        if remaining.starts_with('<') {
            if let Some(end) = remaining.find('>') {
                if parse_time(&remaining[1..end]).is_some() {
                    index += end + 1;
                    continue;
                }
            }
        }
        let character = remaining.chars().next().expect("non-empty remainder");
        output.push(character);
        index += character.len_utf8();
    }
    output
}

fn parse_time(value: &str) -> Option<u64> {
    let (minutes, seconds) = value.split_once(':')?;
    let (whole, fraction) = seconds.split_once('.').unwrap_or((seconds, ""));
    let minutes = minutes.parse::<u64>().ok()?;
    let seconds = whole.parse::<u64>().ok()?;
    if seconds >= 60 {
        return None;
    }
    let fraction: String = fraction.chars().take(3).collect();
    let milliseconds = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<u64>().ok()? * 100,
        2 => fraction.parse::<u64>().ok()? * 10,
        _ => fraction.parse::<u64>().ok()?,
    };
    Some(
        minutes
            .saturating_mul(60_000)
            .saturating_add(seconds * 1000)
            .saturating_add(milliseconds),
    )
}

#[cfg(test)]
mod tests {
    use super::{parse_lrc, parse_time};

    #[test]
    fn parses_multi_timestamp_lrc_with_offset_and_infers_line_ends() {
        let (id, lines) = parse_lrc("[offset:-100]\n[00:01.20][00:02.500]hello\n[00:03.5]world");
        assert!(id.starts_with("lyrics-"));
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[0].start_ms, Some(1100));
        assert_eq!(lines[0].end_ms, Some(2400));
        assert_eq!(lines[1].start_ms, Some(2400));
        assert_eq!(lines[2].start_ms, Some(3400));
        assert_eq!(lines[2].end_ms, Some(7400));
    }

    #[test]
    fn parses_plain_lyrics_without_fabricating_timestamps() {
        let (_, lines) = parse_lrc("first line\nsecond line");
        assert_eq!(lines.len(), 2);
        assert!(lines
            .iter()
            .all(|line| line.start_ms.is_none() && line.end_ms.is_none()));
    }

    #[test]
    fn parses_centiseconds_and_rejects_invalid_seconds() {
        assert_eq!(parse_time("02:03.45"), Some(123_450));
        assert_eq!(parse_time("00:61.00"), None);
    }

    fn candidate(name: &'static str, key: &str, state: &str) -> super::Candidate {
        super::Candidate {
            name,
            report_key: None,
            snapshot: crate::server::Snapshot {
                track: Some(crate::server::Track {
                    track_key: key.into(),
                    source: crate::server::TrackSource {
                        connector: name.into(),
                        app_id: None,
                        source_track_id: None,
                    },
                    title: key.into(),
                    artists: vec!["artist".into()],
                    album: None,
                    duration_ms: Some(180_000),
                }),
                state: state.into(),
                position_ms: Some(1_000),
                sampled_at_ms: 1,
                playback_rate: if state == "playing" { 1.0 } else { 0.0 },
            },
        }
    }

    #[test]
    fn manual_lyrics_override_blocks_late_automatic_results_only_for_current_track() {
        assert!(super::may_apply_record(true, false, false));
        assert!(!super::may_apply_record(true, true, false));
        assert!(super::may_apply_record(true, true, true));
        assert!(!super::may_apply_record(false, true, true));
    }
    #[test]
    fn keeps_a_playing_active_connector_sticky() {
        let (snapshot, source, _) = super::choose(
            vec![
                candidate("browser", "browser:one", "playing"),
                candidate("spotify-macos", "spotify:two", "playing"),
            ],
            Some("spotify-macos"),
            "auto",
        );
        assert_eq!(source.as_deref(), Some("spotify-macos"));
        assert_eq!(snapshot.track.unwrap().track_key, "spotify:two");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn chooses_chrome_before_smtc_when_both_start_playing() {
        let (snapshot, source, _) = super::choose(
            vec![
                candidate("windows-smtc", "windows:one", "playing"),
                candidate("browser", "youtube:two", "playing"),
            ],
            None,
            "auto",
        );
        assert_eq!(source.as_deref(), Some("browser"));
        assert_eq!(snapshot.track.unwrap().track_key, "youtube:two");
    }

    #[test]
    fn manual_source_preference_overrides_auto_priority_and_missing_pin_does_not_fallback() {
        let sources = vec![
            candidate("browser", "youtube:one", "playing"),
            candidate("spotify-macos", "spotify:two", "playing"),
        ];
        let (snapshot, source, _) =
            super::choose(sources.clone(), Some("spotify-macos"), "browser");
        assert_eq!(source.as_deref(), Some("browser"));
        assert_eq!(snapshot.track.unwrap().track_key, "youtube:one");
        let (_, source, _) = super::choose(sources, None, "windows-smtc");
        assert_eq!(source, None);
    }

    #[test]
    fn lyric_candidate_filtering_and_current_track_guard_require_current_metadata() {
        let mut record = super::LrclibRecord {
            id: 12,
            track_name: "Song".into(),
            artist_name: "Artist".into(),
            album_name: "Album".into(),
            duration: 180.,
            plain_lyrics: None,
            synced_lyrics: Some("[00:01]line".into()),
        };
        assert!(super::record_has_lyrics(&record));
        let candidate = super::candidate_json(&record);
        assert!(candidate.get("synced").unwrap().as_bool().unwrap());
        assert!(candidate.get("syncedLyrics").is_none());
        record.synced_lyrics = None;
        assert!(!super::record_has_lyrics(&record));
        let current = crate::server::Track {
            track_key: "key".into(),
            source: crate::server::TrackSource {
                connector: "browser".into(),
                app_id: None,
                source_track_id: None,
            },
            title: "t".into(),
            artists: vec!["a".into()],
            album: None,
            duration_ms: None,
        };
        assert!(super::matches_current(Some(&current), "key"));
        assert!(!super::matches_current(Some(&current), "other"));
        assert!(!super::matches_current(None, "key"));
    }

    #[test]
    fn classifies_browser_heartbeat_freshness_without_claiming_extension_absence() {
        let recent = crate::server::StoredHeartbeat {
            media_state: Some("missing-metadata".into()),
            received_at_ms: 100,
        };
        let missing = super::browser_diagnostic(Some(&recent), false, None, 200);
        assert_eq!(missing["state"], "missing-metadata");
        assert!(missing["message"]
            .as_str()
            .unwrap()
            .contains("title or artist"));
        let stale = super::browser_diagnostic(
            Some(&recent),
            false,
            None,
            100 + crate::server::STALE_AFTER_MS + 1,
        );
        assert_eq!(stale["state"], "stale");
        let failed = super::browser_diagnostic(None, false, Some("extension report invalid"), 200);
        assert_eq!(failed["state"], "error");
        let none = super::browser_diagnostic(None, false, None, 200);
        assert_eq!(none["state"], "no-supported-tab");
        assert!(!none["message"].as_str().unwrap().contains("not installed"));
    }
}
