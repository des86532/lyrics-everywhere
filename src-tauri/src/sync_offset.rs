use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

use crate::runtime::matches_current;
use crate::server::{json_error, now_ms, AppState, SessionState, Snapshot, MAX_TRACK_KEY_CHARS};

pub fn effective_offset(session: &SessionState) -> (i64, &'static str) {
    if let Some(track) = session.snapshot.track.as_ref() {
        if let Some(&user_offset) = session.user_offsets.get(&track.track_key) {
            return (user_offset, "user");
        }
    }
    if session.sync.anchored {
        return (0, "anchored");
    }
    (0, "none")
}

pub fn current_position_ms(snapshot: &Snapshot, now: u64) -> u64 {
    let position = snapshot.position_ms.unwrap_or(0);
    if snapshot.state == "playing" {
        let elapsed = now.saturating_sub(snapshot.sampled_at_ms).min(5000) as f64;
        let rate = if snapshot.playback_rate > 0.0 {
            snapshot.playback_rate
        } else {
            1.0
        };
        position.saturating_add((elapsed * rate).round() as u64)
    } else {
        position
    }
}

#[derive(Serialize, Deserialize)]
struct OffsetsFile {
    version: u32,
    offsets: HashMap<String, i64>,
}

pub fn load_offsets(path: &Path) -> HashMap<String, i64> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<OffsetsFile>(&bytes).ok())
        .filter(|stored| stored.version == 1)
        .map(|stored| stored.offsets)
        .unwrap_or_default()
}

pub fn save_offsets(path: &Path, offsets: &HashMap<String, i64>) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes = serde_json::to_vec(&OffsetsFile {
        version: 1,
        offsets: offsets.clone(),
    })
    .map_err(io::Error::other)?;
    fs::write(path, bytes)
}

/// 手動微調的單次上限（毫秒）。
const MAX_NUDGE_MS: i64 = 10_000;
/// 使用者時間軸的絕對值上限（毫秒）；超過即視為誤操作。
const MAX_OFFSET_MS: i64 = 600_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OffsetRequest {
    track_key: String,
    action: String,
    delta_ms: Option<i64>,
    line_id: Option<String>,
}

/// 更新目前曲目的使用者時間軸：微調、以目前位置對齊某一行，或重設。
/// 寫入檔案成功後才更新記憶體；寫入失敗時維持原值。
pub(crate) async fn update_offset(
    State(state): State<AppState>,
    payload: Result<Json<OffsetRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = payload else {
        return json_error(StatusCode::BAD_REQUEST, "invalid offset update");
    };
    if request.track_key.chars().count() > MAX_TRACK_KEY_CHARS {
        return json_error(StatusCode::BAD_REQUEST, "trackKey is too long");
    }
    let mut session = state.session.lock().await;
    if !matches_current(session.snapshot.track.as_ref(), &request.track_key) {
        return json_error(StatusCode::CONFLICT, "track is no longer current");
    }
    let (current, _) = effective_offset(&session);
    let mut offsets = session.user_offsets.clone();
    match request.action.as_str() {
        "nudge" => {
            let Some(delta) = request
                .delta_ms
                .filter(|delta| *delta != 0 && delta.abs() <= MAX_NUDGE_MS)
            else {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    "deltaMs must be non-zero and between -10000 and 10000",
                );
            };
            offsets.insert(request.track_key.clone(), current.saturating_add(delta));
        }
        "align-line" => {
            let start = session
                .sheet
                .as_ref()
                .filter(|sheet| sheet.track_key == request.track_key)
                .and_then(|sheet| {
                    sheet
                        .lines
                        .iter()
                        .find(|line| Some(line.line_id.as_str()) == request.line_id.as_deref())
                })
                .and_then(|line| line.start_ms);
            let Some(start) = start else {
                return json_error(
                    StatusCode::BAD_REQUEST,
                    "lineId must refer to a timed line in the current lyrics",
                );
            };
            let position = current_position_ms(&session.snapshot, now_ms());
            offsets.insert(request.track_key.clone(), position as i64 - start as i64);
        }
        "reset" => {
            offsets.remove(&request.track_key);
        }
        _ => return json_error(StatusCode::BAD_REQUEST, "unknown offset action"),
    }
    if offsets
        .get(&request.track_key)
        .is_some_and(|value| value.abs() > MAX_OFFSET_MS)
    {
        return json_error(StatusCode::BAD_REQUEST, "時間對齊超過 ±600 秒，請重新確認");
    }
    if let Err(error) = save_offsets(&state.offsets_path, &offsets) {
        eprintln!("Unable to save sync offsets: {error}");
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "無法儲存時間對齊設定，請確認應用程式可寫入設定資料夾",
        );
    }
    session.user_offsets = offsets;
    let (offset_ms, origin) = effective_offset(&session);
    let cursor = crate::runtime::cursor_event(&session);
    drop(session);
    state.emit("playback-update", cursor);
    Json(json!({"offsetMs": offset_ms, "origin": origin})).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::{Profile, SyncState, Track, TrackSource};

    #[test]
    fn current_position_advances_when_playing_and_caps_at_five_seconds() {
        let mut snap = Snapshot {
            track: None,
            state: "playing".into(),
            position_ms: Some(10_000),
            sampled_at_ms: 1_000,
            playback_rate: 1.0,
        };
        assert_eq!(current_position_ms(&snap, 3_000), 12_000);
        assert_eq!(current_position_ms(&snap, 10_000), 15_000);

        snap.state = "paused".into();
        assert_eq!(current_position_ms(&snap, 10_000), 10_000);

        snap.position_ms = None;
        assert_eq!(current_position_ms(&snap, 10_000), 0);
    }

    #[test]
    fn load_and_save_offsets_round_trip() {
        let temp_path = std::env::temp_dir().join(format!(
            "offsets-test-{}-{}.json",
            std::process::id(),
            crate::server::now_ms()
        ));
        let mut map = HashMap::new();
        map.insert("youtube:vid1".to_string(), 12_500);
        map.insert("youtube:vid2".to_string(), -3_000);

        save_offsets(&temp_path, &map).expect("save succeeds");
        let loaded = load_offsets(&temp_path);
        assert_eq!(loaded, map);

        fs::write(&temp_path, r#"{"version":2,"offsets":{}}"#).unwrap();
        assert_eq!(load_offsets(&temp_path), HashMap::new());

        fs::write(&temp_path, "invalid json").unwrap();
        assert_eq!(load_offsets(&temp_path), HashMap::new());

        let _ = fs::remove_file(&temp_path);
    }

    fn sample_session(connector: &str) -> SessionState {
        SessionState {
            snapshot: Snapshot {
                track: Some(Track {
                    track_key: "youtube:xyz".into(),
                    source: TrackSource {
                        connector: connector.into(),
                        app_id: None,
                        source_track_id: Some("xyz".into()),
                    },
                    title: "Test".into(),
                    artists: vec!["Artist".into()],
                    album: None,
                    duration_ms: Some(242_000),
                }),
                state: "playing".into(),
                position_ms: Some(50_000),
                sampled_at_ms: 0,
                playback_rate: 1.0,
            },
            sheet: None,
            active_source: Some(connector.into()),
            active_browser_key: None,
            revision: 0,
            diagnostics: Vec::new(),
            manual_lyrics: false,
            lyric_candidate_track_key: None,
            lyric_candidate_ids: Vec::new(),
            profile: Profile {
                target_locale: "zh-TW".into(),
                passthrough_languages: vec![],
                allowed_systems: vec![],
                source_preference: "auto".into(),
            },
            sync: SyncState::default(),
            user_offsets: HashMap::new(),
        }
    }

    #[test]
    fn effective_offset_precedence_user_over_anchored_over_none() {
        let mut session = sample_session("browser");
        assert_eq!(effective_offset(&session), (0, "none"));

        session.sync.anchored = true;
        assert_eq!(effective_offset(&session), (0, "anchored"));

        session.user_offsets.insert("youtube:xyz".into(), 15_000);
        assert_eq!(effective_offset(&session), (15_000, "user"));
    }

    fn cleanup(state: &AppState) {
        let _ = fs::remove_dir_all(state.offsets_path.parent().expect("config dir"));
    }

    async fn browser_state(name: &str) -> AppState {
        let dir = std::env::temp_dir().join(format!("sync-offset-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let state = AppState::new(dir);
        *state.session.lock().await = sample_session("browser");
        state
    }

    async fn send(
        state: &AppState,
        track_key: &str,
        action: &str,
        delta_ms: Option<i64>,
        line_id: Option<&str>,
    ) -> StatusCode {
        update_offset(
            State(state.clone()),
            Ok(Json(OffsetRequest {
                track_key: track_key.into(),
                action: action.into(),
                delta_ms,
                line_id: line_id.map(Into::into),
            })),
        )
        .await
        .status()
    }

    #[tokio::test]
    async fn nudge_adds_to_current_offset_and_survives_restart() {
        let state = browser_state("nudge").await;
        assert_eq!(
            send(&state, "youtube:xyz", "nudge", Some(2_000), None).await,
            StatusCode::OK
        );
        assert_eq!(
            state.session.lock().await.user_offsets.get("youtube:xyz"),
            Some(&2_000)
        );
        assert_eq!(
            load_offsets(&state.offsets_path).get("youtube:xyz"),
            Some(&2_000)
        );

        let restarted = AppState::new(state.offsets_path.parent().unwrap().to_path_buf());
        assert_eq!(
            restarted
                .session
                .lock()
                .await
                .user_offsets
                .get("youtube:xyz"),
            Some(&2_000)
        );
        cleanup(&state);
    }

    #[tokio::test]
    async fn invalid_nudges_and_unknown_actions_leave_offset_unchanged() {
        let state = browser_state("invalid").await;
        for delta in [Some(0), Some(10_001), Some(-10_001), None] {
            assert_eq!(
                send(&state, "youtube:xyz", "nudge", delta, None).await,
                StatusCode::BAD_REQUEST
            );
        }
        assert_eq!(
            send(&state, "youtube:xyz", "teleport", None, None).await,
            StatusCode::BAD_REQUEST
        );
        assert!(state.session.lock().await.user_offsets.is_empty());
        cleanup(&state);
    }

    #[tokio::test]
    async fn nudge_past_absolute_limit_is_rejected_and_keeps_previous_value() {
        let state = browser_state("limit").await;
        state
            .session
            .lock()
            .await
            .user_offsets
            .insert("youtube:xyz".into(), 595_000);
        assert_eq!(
            send(&state, "youtube:xyz", "nudge", Some(10_000), None).await,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            state.session.lock().await.user_offsets.get("youtube:xyz"),
            Some(&595_000)
        );
        cleanup(&state);
    }

    #[tokio::test]
    async fn align_line_uses_playback_position_and_requires_timed_line() {
        let state = browser_state("align").await;
        let text = "[le:version:1]\n[00:40.00]第一行\n[00:50.00]第二行";
        let doc = crate::konger::parse_le_lrc(text).ok().expect("valid lrc");
        assert!(crate::konger::apply_user_sheet(&state, "youtube:xyz", text, doc).await);
        let line_id = state.session.lock().await.sheet.as_ref().unwrap().lines[1]
            .line_id
            .clone();

        assert_eq!(
            send(&state, "youtube:xyz", "align-line", None, Some("missing")).await,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            send(&state, "youtube:xyz", "align-line", None, Some(&line_id)).await,
            StatusCode::OK
        );
        // Playback is 50 s sampled at t=0 and extrapolated by at most 5 s, so the
        // position is 55 s. The second line starts at 50 s, so the offset is +5 s.
        assert_eq!(
            state.session.lock().await.user_offsets.get("youtube:xyz"),
            Some(&5_000)
        );
        cleanup(&state);
    }

    #[tokio::test]
    async fn reset_removes_manual_override_and_restores_no_offset() {
        let state = browser_state("reset").await;
        assert_eq!(
            send(&state, "youtube:xyz", "nudge", Some(2_000), None).await,
            StatusCode::OK
        );
        assert_eq!(
            send(&state, "youtube:xyz", "reset", None, None).await,
            StatusCode::OK
        );
        {
            let session = state.session.lock().await;
            assert!(!session.user_offsets.contains_key("youtube:xyz"));
            assert_eq!(effective_offset(&session), (0, "none"));
        }
        assert!(!load_offsets(&state.offsets_path).contains_key("youtube:xyz"));
        cleanup(&state);
    }

    #[tokio::test]
    async fn offset_for_a_different_track_is_rejected_without_saving() {
        let state = browser_state("stale").await;
        assert_eq!(
            send(&state, "youtube:other", "nudge", Some(2_000), None).await,
            StatusCode::CONFLICT
        );
        assert!(state.session.lock().await.user_offsets.is_empty());
        assert!(!state.offsets_path.exists());
        cleanup(&state);
    }

    #[tokio::test]
    async fn failed_save_keeps_previous_offset_in_memory() {
        // A regular file as the config dir makes offsets.json unwritable.
        let blocked =
            std::env::temp_dir().join(format!("sync-offset-blocked-{}", std::process::id()));
        let _ = fs::remove_dir_all(&blocked);
        fs::write(&blocked, "not a directory").unwrap();
        let state = AppState::new(blocked.clone());
        *state.session.lock().await = sample_session("browser");

        assert_eq!(
            send(&state, "youtube:xyz", "nudge", Some(2_000), None).await,
            StatusCode::INTERNAL_SERVER_ERROR
        );
        assert!(state.session.lock().await.user_offsets.is_empty());
        let _ = fs::remove_file(&blocked);
    }
}
