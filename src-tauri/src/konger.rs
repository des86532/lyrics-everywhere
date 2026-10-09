//! LE-LRC v1 空耳檔：解析、序列化與品質檢查為純函式（不做 IO）；
//! 儲存、套用與 HTTP handler 會讀寫檔案或更新應用程式狀態。

use std::io;
use std::path::{Path, PathBuf};

use axum::{
    extract::{rejection::JsonRejection, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::runtime::{matches_current, parse_time, remove_enhanced_timestamps, sha256_hex};
use crate::server::{
    json_error, AppState, LyricLine, LyricSheet, SyncState, Track, MAX_TRACK_KEY_CHARS,
};

const MAX_BYTES: usize = 60_000;
const MAX_LINES: usize = 2_000;
const MAX_LINE_CHARS: usize = 500;
const LOW_COVERAGE: f64 = 0.8;
const SYLLABLE_RATE_LIMIT: f64 = 0.3;
const SYLLABLE_RATE_MIN_LINES: usize = 4;
const KONGER_MAX_CHARS: usize = 80;
const DURATION_GRACE_MS: u64 = 2_000;
const SMALL_KANA: &str = "ぁぃぅぇぉゃゅょゎァィゥェォャュョヮっッー・";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Anchor {
    Song,
    Youtube(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum KongerLang {
    Ko,
    Ja,
    Other,
}

impl KongerLang {
    fn as_str(self) -> &'static str {
        match self {
            Self::Ko => "ko",
            Self::Ja => "ja",
            Self::Other => "other",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Grade {
    Pass,
    Warn,
    Reject,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub severity: Severity,
    pub code: &'static str,
    pub line: Option<usize>,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KongerLine {
    pub start_ms: u64,
    pub original: String,
    pub konger: Option<String>,
    /// 原文所在的檔案行號（1 起算）；由格式整理產生的草稿為 0。
    pub line_no: usize,
    /// 空耳所在的檔案行號；沒有空耳時為 None。
    pub konger_line_no: Option<usize>,
}

#[derive(Clone, Debug)]
pub struct KongerDoc {
    pub title: Option<String>,
    pub artists: Option<String>,
    pub length_ms: Option<u64>,
    /// 只記錄標頭明確宣告的語言；未宣告時由 `validate` 自動判斷。
    pub lang: Option<KongerLang>,
    pub anchor: Anchor,
    pub lines: Vec<KongerLine>,
    /// 解析時產生的警告（目前只有 W_TIMESTAMP_ORDER），由 `validate` 併入報告。
    pub warnings: Vec<Issue>,
}

#[derive(Clone, Debug, Default)]
pub struct ValidateContext {
    pub current_video_id: Option<String>,
    pub duration_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub lang: KongerLang,
    pub lines: usize,
    pub source_lines: usize,
    pub konger_lines: usize,
    pub coverage: f64,
    pub syllable_checked: usize,
    pub syllable_mismatch: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub grade: Grade,
    pub issues: Vec<Issue>,
    pub stats: Stats,
}

fn error(code: &'static str, line: Option<usize>, message: String) -> Issue {
    Issue {
        severity: Severity::Error,
        code,
        line,
        message,
    }
}

fn warning(code: &'static str, line: Option<usize>, message: String) -> Issue {
    Issue {
        severity: Severity::Warning,
        code,
        line,
        message,
    }
}

struct Row {
    line_no: usize,
    start_ms: u64,
    text: String,
}

pub fn parse_le_lrc(raw: &str) -> Result<KongerDoc, Vec<Issue>> {
    let source: Vec<&str> = raw.lines().collect();
    if raw.len() > MAX_BYTES
        || source.len() > MAX_LINES
        || source
            .iter()
            .any(|line| line.chars().count() > MAX_LINE_CHARS)
    {
        return Err(vec![error(
            "E_TOO_LARGE",
            None,
            "檔案超過大小限制：最多 60,000 bytes、2,000 行，每行 500 字元".into(),
        )]);
    }

    let mut issues = Vec::new();
    let mut rows: Vec<Row> = Vec::new();
    let mut has_version = false;
    let mut title = None;
    let mut artists = None;
    let mut length_ms = None;
    let mut lang = None;
    let mut anchor = Anchor::Song;
    let mut offset = 0_i64;

    for (index, raw_line) in source.into_iter().enumerate() {
        let line_no = index + 1;
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        let (starts, remainder) = split_timestamps(line);
        if !starts.is_empty() {
            let text = remove_enhanced_timestamps(remainder.trim());
            rows.extend(starts.into_iter().map(|start_ms| Row {
                line_no,
                start_ms,
                text: text.clone(),
            }));
        } else if let Some(value) = header_value(line, "[le:version:") {
            has_version = true;
            if value.trim() != "1" {
                issues.push(error(
                    "E_BAD_HEADER",
                    Some(line_no),
                    format!("不支援的格式版本「{}」，目前只支援 1", value.trim()),
                ));
            }
        } else if let Some(value) = header_value(line, "[le:lang:") {
            match value.trim().to_ascii_lowercase().as_str() {
                "ko" => lang = Some(KongerLang::Ko),
                "ja" => lang = Some(KongerLang::Ja),
                "other" => lang = Some(KongerLang::Other),
                _ => issues.push(error(
                    "E_BAD_HEADER",
                    Some(line_no),
                    "語言標頭只能是 ko、ja 或 other".into(),
                )),
            }
        } else if let Some(value) = header_value(line, "[le:anchor:") {
            match parse_anchor(value.trim()) {
                Some(parsed) => anchor = parsed,
                None => issues.push(error(
                    "E_BAD_HEADER",
                    Some(line_no),
                    "時間軸標頭只能是 song 或 youtube:<11 字元影片 ID>".into(),
                )),
            }
        } else if let Some(value) = header_value(line, "[ti:") {
            title = non_empty(value);
        } else if let Some(value) = header_value(line, "[ar:") {
            artists = non_empty(value);
        } else if let Some(value) = header_value(line, "[length:") {
            match parse_time(value.trim()) {
                Some(ms) => length_ms = Some(ms),
                None => issues.push(error(
                    "E_BAD_HEADER",
                    Some(line_no),
                    "[length:] 格式應為 mm:ss.xx".into(),
                )),
            }
        } else if let Some(value) = header_value(line, "[offset:") {
            offset = value.trim().parse().unwrap_or(0);
        } else if !is_ignored_header(line) {
            issues.push(error(
                "E_UNTIMED_LINE",
                Some(line_no),
                "這一行沒有時間戳；每句歌詞都需要 [mm:ss.xx]".into(),
            ));
        }
    }

    if !has_version {
        return Err(vec![error(
            "E_NOT_LE_FORMAT",
            None,
            "缺少 [le:version:1] 標頭，這不是 LE-LRC 檔案".into(),
        )]);
    }
    if rows.is_empty() {
        issues.push(error("E_EMPTY", None, "檔案中沒有任何歌詞行".into()));
    }
    if let Some(pair) = rows
        .windows(2)
        .find(|pair| pair[1].start_ms < pair[0].start_ms)
    {
        issues.push(warning(
            "W_TIMESTAMP_ORDER",
            Some(pair[1].line_no),
            "歌詞時間不是由小到大排列，已自動排序".into(),
        ));
    }

    for row in &mut rows {
        row.start_ms =
            (i128::from(row.start_ms) + i128::from(offset)).clamp(0, i128::from(u64::MAX)) as u64;
    }
    rows.sort_by_key(|row| row.start_ms);

    let mut lines = Vec::new();
    let mut rest = rows.as_slice();
    while let Some(first) = rest.first() {
        let group_len = rest
            .iter()
            .take_while(|row| row.start_ms == first.start_ms)
            .count();
        let (group, tail) = rest.split_at(group_len);
        if let Some(extra) = group.get(2) {
            issues.push(error(
                "E_TOO_MANY_AT_TIMESTAMP",
                Some(extra.line_no),
                format!(
                    "同一時間 {} 出現超過 2 行；每個時間最多一行原文加一行空耳",
                    format_time(first.start_ms)
                ),
            ));
        }
        let konger_row = group.get(1).filter(|row| !row.text.is_empty());
        lines.push(KongerLine {
            start_ms: first.start_ms,
            original: group[0].text.clone(),
            konger: konger_row.map(|row| row.text.clone()),
            line_no: group[0].line_no,
            konger_line_no: konger_row.map(|row| row.line_no),
        });
        rest = tail;
    }

    if issues.iter().any(|issue| issue.severity == Severity::Error) {
        return Err(issues);
    }
    Ok(KongerDoc {
        title,
        artists,
        length_ms,
        lang,
        anchor,
        lines,
        warnings: issues,
    })
}

pub fn serialize_le_lrc(doc: &KongerDoc, lang: KongerLang) -> String {
    let mut out = String::new();
    if let Some(title) = &doc.title {
        out.push_str(&format!("[ti:{}]\n", title.replace(['\r', '\n'], " ")));
    }
    if let Some(artists) = &doc.artists {
        out.push_str(&format!("[ar:{}]\n", artists.replace(['\r', '\n'], " ")));
    }
    if let Some(length) = doc.length_ms {
        out.push_str(&format!("[length:{}]\n", format_time(length)));
    }
    out.push_str("[le:version:1]\n");
    out.push_str(&format!("[le:lang:{}]\n", lang.as_str()));
    match &doc.anchor {
        Anchor::Song => out.push_str("[le:anchor:song]\n"),
        Anchor::Youtube(id) => out.push_str(&format!("[le:anchor:youtube:{id}]\n")),
    }
    for line in &doc.lines {
        let time = format_time(line.start_ms);
        out.push_str(&format!("[{time}]{}\n", line.original));
        if let Some(konger) = &line.konger {
            out.push_str(&format!("[{time}]{konger}\n"));
        }
    }
    out
}

pub fn validate(doc: &KongerDoc, ctx: &ValidateContext) -> Report {
    let lang = doc.lang.unwrap_or_else(|| detect_lang(&doc.lines));
    let mut issues = doc.warnings.clone();

    if let Anchor::Youtube(id) = &doc.anchor {
        if ctx.current_video_id.as_deref() != Some(id.as_str()) {
            issues.push(error(
                "E_ANCHOR_MISMATCH",
                None,
                format!("這份空耳是給 YouTube 影片 {id} 使用的，與目前播放的影片不符"),
            ));
        }
    }

    let reference_ms = match &doc.anchor {
        Anchor::Song => doc.length_ms,
        Anchor::Youtube(_) => ctx.duration_ms,
    };
    if let (Some(reference), Some(last)) = (reference_ms, doc.lines.last()) {
        if last.start_ms > reference + DURATION_GRACE_MS {
            issues.push(error(
                "E_TIME_BEYOND_DURATION",
                None,
                format!(
                    "最後一句 {} 超過參考長度 {}",
                    format_time(last.start_ms),
                    format_time(reference)
                ),
            ));
        }
    }

    let mut needing = 0_usize;
    let mut covered = 0_usize;
    let mut konger_lines = 0_usize;
    let mut checked = 0_usize;
    let mut mismatch = 0_usize;

    for line in &doc.lines {
        if needs_konger(&line.original, lang) {
            needing += 1;
        }
        let Some(konger) = line.konger.as_deref() else {
            continue;
        };
        konger_lines += 1;
        if needs_konger(&line.original, lang) {
            covered += 1;
        }
        if matches!(lang, KongerLang::Ko | KongerLang::Ja)
            && konger.chars().any(|c| is_hangul(c) || is_kana(c))
        {
            issues.push(error(
                "E_SOURCE_IN_KONGER",
                line.konger_line_no,
                "空耳行含有韓文或假名，疑似把原文貼成空耳".into(),
            ));
        }
        let normalized = normalize_for_match(konger);
        if !normalized.is_empty() && normalized == normalize_for_match(&line.original) {
            issues.push(error(
                "E_KONGER_EQUALS_ORIGINAL",
                line.konger_line_no,
                "空耳與原文相同，沒有標注發音".into(),
            ));
        }
        if konger.chars().count() > KONGER_MAX_CHARS {
            issues.push(warning(
                "W_KONGER_TOO_LONG",
                line.konger_line_no,
                format!("空耳超過 {KONGER_MAX_CHARS} 字元，可能影響顯示"),
            ));
        }
        if let Some(check) = check_syllables(&line.original, konger, lang) {
            checked += 1;
            if !check.ok {
                mismatch += 1;
                issues.push(warning(
                    "W_SYLLABLE_MISMATCH",
                    line.konger_line_no,
                    format!(
                        "原文約 {} 音節，空耳 {} 字，差距過大",
                        check.source, check.konger
                    ),
                ));
            }
        }
    }

    if needing == 0 {
        issues.push(error(
            "E_NO_SOURCE_LINES",
            None,
            "沒有需要空耳的原文行".into(),
        ));
    } else if (covered as f64 / needing as f64) < LOW_COVERAGE {
        issues.push(error(
            "E_LOW_COVERAGE",
            None,
            format!("空耳覆蓋率 {covered}/{needing}，需至少 80%"),
        ));
    }
    if checked >= SYLLABLE_RATE_MIN_LINES && mismatch as f64 / checked as f64 > SYLLABLE_RATE_LIMIT
    {
        issues.push(error(
            "E_SYLLABLE_MISMATCH_RATE",
            None,
            format!("{checked} 句音節檢查中有 {mismatch} 句差距過大"),
        ));
    }

    let grade = if issues.iter().any(|i| i.severity == Severity::Error) {
        Grade::Reject
    } else if issues.iter().any(|i| i.severity == Severity::Warning) {
        Grade::Warn
    } else {
        Grade::Pass
    };
    let coverage = if needing == 0 {
        0.0
    } else {
        covered as f64 / needing as f64
    };
    Report {
        grade,
        issues,
        stats: Stats {
            lang,
            lines: doc.lines.len(),
            source_lines: needing,
            konger_lines,
            coverage,
            syllable_checked: checked,
            syllable_mismatch: mismatch,
        },
    }
}

fn detect_lang(lines: &[KongerLine]) -> KongerLang {
    let texts: Vec<&str> = lines.iter().map(|line| line.original.as_str()).collect();
    lang_of(&texts)
}

fn lang_of(texts: &[&str]) -> KongerLang {
    let hangul = texts
        .iter()
        .filter(|text| text.chars().any(is_hangul))
        .count();
    let kana = texts
        .iter()
        .filter(|text| text.chars().any(is_kana))
        .count();
    if hangul > 0 && hangul > kana {
        KongerLang::Ko
    } else if kana > 0 {
        KongerLang::Ja
    } else {
        KongerLang::Other
    }
}

fn needs_konger(original: &str, lang: KongerLang) -> bool {
    match lang {
        KongerLang::Ko => original.chars().any(is_hangul),
        KongerLang::Ja => original.chars().any(|c| is_kana(c) || is_ideograph(c)),
        KongerLang::Other => {
            original.chars().any(|c| c.is_ascii_alphabetic()) && !original.chars().any(is_ideograph)
        }
    }
}

struct SyllableCheck {
    source: usize,
    konger: usize,
    ok: bool,
}

/// 只檢查 ko／ja。ja 原文含漢字時無法可靠計算音節，回傳 None。
fn check_syllables(original: &str, konger: &str, lang: KongerLang) -> Option<SyllableCheck> {
    let (source, ok) = match lang {
        KongerLang::Ko => {
            let source = original.chars().filter(|c| is_hangul_syllable(*c)).count();
            if source == 0 {
                return None;
            }
            let units = konger_units(konger);
            let tolerance = source.div_ceil(4).max(1);
            return Some(SyllableCheck {
                source,
                konger: units,
                ok: units.abs_diff(source) <= tolerance,
            });
        }
        KongerLang::Ja => {
            if original.chars().any(is_ideograph) {
                return None;
            }
            let source = original.chars().filter(|c| is_kana_syllable(*c)).count();
            if source == 0 {
                return None;
            }
            let units = konger_units(konger);
            let ok = source / 2 <= units && units <= (5 * source).div_ceil(4) + 1;
            (source, ok)
        }
        KongerLang::Other => return None,
    };
    Some(SyllableCheck {
        source,
        konger: konger_units(konger),
        ok,
    })
}

/// 空耳單位數：漢字各算一個，連續 ASCII 字母與連續注音各算一個。
fn konger_units(text: &str) -> usize {
    let mut units = 0;
    let mut in_latin = false;
    let mut in_bopomofo = false;
    for c in text.chars() {
        if is_ideograph(c) {
            units += 1;
            in_latin = false;
            in_bopomofo = false;
        } else if c.is_ascii_alphabetic() {
            if !in_latin {
                units += 1;
            }
            in_latin = true;
            in_bopomofo = false;
        } else if is_bopomofo(c) {
            if !in_bopomofo {
                units += 1;
            }
            in_bopomofo = true;
            in_latin = false;
        } else {
            in_latin = false;
            in_bopomofo = false;
        }
    }
    units
}

fn normalize_for_match(text: &str) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_hangul(c: char) -> bool {
    matches!(c, '\u{1100}'..='\u{11FF}' | '\u{3130}'..='\u{318F}' | '\u{AC00}'..='\u{D7A3}')
}

fn is_hangul_syllable(c: char) -> bool {
    matches!(c, '\u{AC00}'..='\u{D7A3}')
}

fn is_kana(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{30FF}')
}

fn is_kana_syllable(c: char) -> bool {
    is_kana(c) && !SMALL_KANA.contains(c)
}

fn is_ideograph(c: char) -> bool {
    matches!(c, '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}')
}

fn is_bopomofo(c: char) -> bool {
    matches!(c, '\u{3105}'..='\u{312F}')
}

fn format_time(ms: u64) -> String {
    format!(
        "{:02}:{:02}.{:02}",
        ms / 60_000,
        ms / 1000 % 60,
        ms % 1000 / 10
    )
}

/// 切出行首的所有 `[mm:ss.xx]` 時間戳，回傳時間與剩餘文字。
fn split_timestamps(line: &str) -> (Vec<u64>, &str) {
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
    (starts, remainder)
}

/// 取出整行 `[prefix…]` 的值，保留原始大小寫。`prefix` 必須是小寫 ASCII。
fn header_value<'a>(line: &'a str, prefix: &str) -> Option<&'a str> {
    let head = line.get(..prefix.len())?;
    (line.len() > prefix.len() && head.eq_ignore_ascii_case(prefix) && line.ends_with(']'))
        .then(|| &line[prefix.len()..line.len() - 1])
}

fn is_ignored_header(line: &str) -> bool {
    ["[al:", "[by:", "[re:", "[ve:"]
        .iter()
        .any(|prefix| header_value(line, prefix).is_some())
}

fn parse_anchor(value: &str) -> Option<Anchor> {
    if value.eq_ignore_ascii_case("song") {
        return Some(Anchor::Song);
    }
    let id = value
        .get(..8)?
        .eq_ignore_ascii_case("youtube:")
        .then(|| &value[8..])?;
    (id.len() == 11
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'))
    .then(|| Anchor::Youtube(id.to_owned()))
}

fn non_empty(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

/// 格式整理器的輸入。`sheet_lines` 只應包含 status 為 ready 且有時間戳的行。
pub struct FormatContext<'a> {
    pub track: &'a Track,
    pub sheet_lines: Option<&'a [LyricLine]>,
    pub reference_duration_ms: Option<u64>,
    pub effective_offset_ms: i64,
    pub anchor_video: bool,
}

pub struct FormatOutcome {
    pub draft: Option<String>,
    pub report: Report,
}

struct Pair<'a> {
    line_no: usize,
    original: &'a str,
    konger: Option<(usize, &'a str)>,
    used: bool,
}

type Built = (String, Vec<Issue>);

/// 把使用者貼上的文字整理成 LE-LRC 草稿（模式見 docs/konger-format.md）。
/// 草稿會再經過 `parse_le_lrc` 與 `validate`，與一般匯入使用同一套規則。
pub fn format_input(raw: &str, ctx: &FormatContext) -> FormatOutcome {
    let input: Vec<(usize, &str)> = raw
        .lines()
        .enumerate()
        .map(|(index, line)| (index + 1, line.trim()))
        .filter(|(_, line)| !line.is_empty())
        .collect();
    let (draft, warnings) = match build_draft(&input, ctx) {
        Ok(built) => built,
        Err(issues) => {
            return FormatOutcome {
                draft: None,
                report: rejected(issues),
            };
        }
    };
    let mut doc = match parse_le_lrc(&draft) {
        Ok(doc) => doc,
        Err(issues) => {
            return FormatOutcome {
                draft: None,
                report: rejected(issues),
            };
        }
    };
    doc.warnings.extend(warnings);
    let report = validate(
        &doc,
        &ValidateContext {
            current_video_id: ctx.track.source.source_track_id.clone(),
            duration_ms: ctx.reference_duration_ms,
        },
    );
    FormatOutcome {
        draft: Some(draft),
        report,
    }
}

fn rejected(issues: Vec<Issue>) -> Report {
    Report {
        grade: Grade::Reject,
        issues,
        stats: Stats {
            lang: KongerLang::Other,
            lines: 0,
            source_lines: 0,
            konger_lines: 0,
            coverage: 0.0,
            syllable_checked: 0,
            syllable_mismatch: 0,
        },
    }
}

fn build_draft(input: &[(usize, &str)], ctx: &FormatContext) -> Result<Built, Vec<Issue>> {
    if input
        .iter()
        .any(|(_, line)| !split_timestamps(line).0.is_empty())
    {
        return format_timed(input, ctx).map(|draft| (draft, Vec::new()));
    }
    let sheet: Vec<(u64, &str)> = ctx
        .sheet_lines
        .unwrap_or_default()
        .iter()
        .filter_map(|line| Some((line.start_ms?, line.original_text.as_str())))
        .filter(|(_, text)| !text.trim().is_empty())
        .collect();
    if sheet.is_empty() {
        return Err(vec![error(
            "F_NEED_SYNCED_SHEET",
            None,
            "需要先載入同步歌詞，或貼上含時間標記的 LRC".to_owned(),
        )]);
    }
    let texts: Vec<&str> = sheet.iter().map(|&(_, text)| text).collect();
    let lang = lang_of(&texts);
    let needed = sheet
        .iter()
        .filter(|&&(_, text)| needs_konger(text, lang))
        .count();
    let matched = input
        .iter()
        .filter(|&&(_, line)| {
            let key = normalize_for_match(line);
            texts.iter().any(|text| normalize_for_match(text) == key)
        })
        .count();
    if matched * 2 >= needed {
        Ok(format_paired(input, &sheet, lang, ctx))
    } else {
        format_konger_only(input, &sheet, lang, needed, ctx).map(|draft| (draft, Vec::new()))
    }
}

/// 模式 A：輸入已含時間標記，只補上缺少的標頭與 anchor，時間保持原樣。
fn format_timed(input: &[(usize, &str)], ctx: &FormatContext) -> Result<String, Vec<Issue>> {
    let mut text = input
        .iter()
        .map(|&(_, line)| line)
        .collect::<Vec<_>>()
        .join("\n");
    if !input
        .iter()
        .any(|(_, line)| header_value(line, "[le:version:").is_some())
    {
        text = format!("[le:version:1]\n{text}");
    }
    let mut doc = parse_le_lrc(&text)?;
    if doc.title.is_none() {
        doc.title = non_empty(&ctx.track.title);
    }
    if doc.artists.is_none() {
        doc.artists = non_empty(&ctx.track.artists.join(", "));
    }
    if doc.length_ms.is_none() {
        doc.length_ms = ctx.reference_duration_ms;
    }
    if !input
        .iter()
        .any(|(_, line)| header_value(line, "[le:anchor:").is_some())
    {
        doc.anchor = anchor_for(youtube_id(ctx));
    }
    let lang = doc.lang.unwrap_or_else(|| detect_lang(&doc.lines));
    Ok(serialize_le_lrc(&doc, lang))
}

/// 模式 B：原文與空耳逐行交錯。原文行後面緊接的一行就是它的空耳；
/// 沒有前導原文的空耳丟棄並警告，配對後找不到對應 sheet 句子的配對同樣略過並警告。
fn format_paired(
    input: &[(usize, &str)],
    sheet: &[(u64, &str)],
    lang: KongerLang,
    ctx: &FormatContext,
) -> Built {
    let is_source = |line: &str| {
        let key = normalize_for_match(line);
        sheet
            .iter()
            .any(|(_, text)| normalize_for_match(text) == key)
    };
    let mut pairs: Vec<Pair> = Vec::new();
    let mut warnings = Vec::new();
    let mut awaiting_konger = false;
    for &(line_no, line) in input {
        if is_source(line) {
            pairs.push(Pair {
                line_no,
                original: line,
                konger: None,
                used: false,
            });
            awaiting_konger = true;
        } else if awaiting_konger {
            if let Some(pair) = pairs.last_mut() {
                pair.konger = Some((line_no, line));
            }
            awaiting_konger = false;
        } else {
            warnings.push(warning(
                "W_ORPHAN_KONGER",
                Some(line_no),
                "這行沒有前面的原文，已捨棄".to_owned(),
            ));
        }
    }

    // 依 sheet 順序找配對：先看下一組，再往後最多找 5 組；找不到的 sheet 句子不填空耳。
    let mut lines = Vec::with_capacity(sheet.len());
    let mut cursor = 0;
    for &(start_ms, text) in sheet {
        let key = normalize_for_match(text);
        let end = (cursor + 6).min(pairs.len());
        let found = (cursor..end).find(|&index| normalize_for_match(pairs[index].original) == key);
        let konger = match found {
            Some(index) => {
                cursor = index + 1;
                pairs[index].used = true;
                pairs[index].konger
            }
            None => None,
        };
        lines.push(KongerLine {
            start_ms,
            original: text.to_owned(),
            konger: konger.map(|(_, konger)| konger.to_owned()),
            line_no: 0,
            konger_line_no: None,
        });
    }
    for pair in pairs.iter().filter(|pair| !pair.used) {
        warnings.push(warning(
            "W_UNMATCHED_LINE",
            Some(pair.line_no),
            "這行原文找不到對應的歌詞時間軸，已略過".to_owned(),
        ));
    }
    (render(lines, ctx, lang), warnings)
}

/// 模式 C：只有空耳。依 sheet 順序分配輸入行；不需要空耳的句子若與下一行原文相同，視為回貼的原文而跳過。
fn format_konger_only(
    input: &[(usize, &str)],
    sheet: &[(u64, &str)],
    lang: KongerLang,
    needed: usize,
    ctx: &FormatContext,
) -> Result<String, Vec<Issue>> {
    let mut next = 0;
    let mut echoed = 0;
    let mut missing = false;
    let mut assigned = Vec::with_capacity(sheet.len());
    for &(_, text) in sheet {
        if needs_konger(text, lang) {
            match input.get(next) {
                Some(&pasted) => {
                    next += 1;
                    assigned.push(Some(pasted));
                }
                None => {
                    missing = true;
                    assigned.push(None);
                }
            }
        } else {
            let echo = input
                .get(next)
                .is_some_and(|&(_, line)| normalize_for_match(line) == normalize_for_match(text));
            if echo {
                next += 1;
                echoed += 1;
            }
            assigned.push(None);
        }
    }
    if missing || next < input.len() {
        return Err(vec![error(
            "F_COUNT_MISMATCH",
            None,
            format!(
                "這首歌有 {needed} 句需要空耳，你貼上了 {} 句；請增刪後再整理",
                input.len() - echoed
            ),
        )]);
    }
    let lines = sheet
        .iter()
        .zip(assigned)
        .map(|(&(start_ms, text), pasted)| KongerLine {
            start_ms,
            original: text.to_owned(),
            konger: pasted.map(|(_, konger)| konger.to_owned()),
            line_no: 0,
            konger_line_no: None,
        })
        .collect();
    Ok(render(lines, ctx, lang))
}

fn youtube_id(ctx: &FormatContext) -> Option<String> {
    ctx.anchor_video
        .then(|| ctx.track.source.source_track_id.clone())
        .flatten()
}

fn anchor_for(youtube: Option<String>) -> Anchor {
    youtube.map_or(Anchor::Song, Anchor::Youtube)
}

/// 模式 B／C 的輸出：anchor 為 youtube 時把歌詞時間換算成影片時間軸，並寫入使用者校正後的起點。
fn render(lines: Vec<KongerLine>, ctx: &FormatContext, lang: KongerLang) -> String {
    let youtube = youtube_id(ctx);
    let offset = if youtube.is_some() {
        ctx.effective_offset_ms
    } else {
        0
    };
    let doc = KongerDoc {
        title: non_empty(&ctx.track.title),
        artists: non_empty(&ctx.track.artists.join(", ")),
        length_ms: ctx.reference_duration_ms,
        lang: None,
        anchor: anchor_for(youtube),
        lines: lines
            .into_iter()
            .map(|line| KongerLine {
                start_ms: (line.start_ms as i64 + offset).max(0) as u64,
                ..line
            })
            .collect(),
        warnings: Vec::new(),
    };
    serialize_le_lrc(&doc, lang)
}

/// 使用者空耳檔的路徑。檔名取歌曲鍵 SHA-256 的前 32 位十六進位，避免歌曲鍵中的 `:`、`/`、`..` 影響路徑。
pub fn konger_path(dir: &Path, track_key: &str) -> PathBuf {
    dir.join(format!("{}.lrc", &sha256_hex(track_key.as_bytes())[..32]))
}

pub fn load_konger(dir: &Path, track_key: &str) -> Option<String> {
    std::fs::read_to_string(konger_path(dir, track_key)).ok()
}

/// 先寫入暫存檔再改名，避免寫到一半時留下損毀的空耳檔。
pub fn save_konger(dir: &Path, track_key: &str, text: &str) -> io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = konger_path(dir, track_key);
    let temp = path.with_extension("lrc.tmp");
    std::fs::write(&temp, text)?;
    std::fs::rename(temp, path)
}

/// 檔案不存在視為已刪除。
pub fn delete_konger(dir: &Path, track_key: &str) -> io::Result<()> {
    match std::fs::remove_file(konger_path(dir, track_key)) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// 目前曲目的驗證條件。只有瀏覽器來源的 YouTube 影片才有影片 ID 可比對 anchor。
pub(crate) fn validate_context(track: &Track) -> ValidateContext {
    let current_video_id = if track.source.connector == "browser" {
        track.source.source_track_id.clone()
    } else {
        None
    };
    ValidateContext {
        current_video_id,
        duration_ms: track.duration_ms,
    }
}

/// 若曲目有已儲存的使用者空耳檔且通過檢查，套用後回傳 true；否則回傳 false，由呼叫端改查 LRCLIB。
pub(crate) async fn apply_saved(state: &AppState, track: &Track) -> bool {
    let Some(text) = load_konger(&state.konger_dir, &track.track_key) else {
        return false;
    };
    let doc = match parse_le_lrc(&text) {
        Ok(doc) => doc,
        Err(_) => {
            eprintln!("已儲存的空耳檔無法解析，改用 LRCLIB：{}", track.track_key);
            return false;
        }
    };
    if validate(&doc, &validate_context(track)).grade == Grade::Reject {
        eprintln!("已儲存的空耳檔未通過檢查，改用 LRCLIB：{}", track.track_key);
        return false;
    }
    apply_user_sheet(state, &track.track_key, &text, doc).await
}

/// 把通過檢查的空耳檔套用到目前曲目。曲目已切換時不做任何變更並回傳 false。
/// `manual_lyrics` 會設為 true，LRCLIB 的自動結果因此不會覆蓋使用者檔。
pub(crate) async fn apply_user_sheet(
    state: &AppState,
    track_key: &str,
    text: &str,
    doc: KongerDoc,
) -> bool {
    let lines: Vec<LyricLine> = doc
        .lines
        .iter()
        .enumerate()
        .map(|(index, line)| LyricLine {
            line_id: format!("line-{}", index + 1),
            start_ms: Some(line.start_ms),
            end_ms: Some(
                doc.lines
                    .get(index + 1)
                    .map_or(line.start_ms + 4000, |next| next.start_ms),
            ),
            original_text: line.original.clone(),
            phonetic: line.konger.clone(),
        })
        .collect();
    let mut session = state.session.lock().await;
    if !matches_current(session.snapshot.track.as_ref(), track_key) {
        return false;
    }
    session.manual_lyrics = true;
    session.sync = SyncState {
        reference_duration_ms: doc.length_ms,
        anchored: matches!(doc.anchor, Anchor::Youtube(_)),
    };
    session.revision += 1;
    let sheet = LyricSheet {
        track_key: track_key.into(),
        lyrics_id: format!("user-{}", &sha256_hex(text.as_bytes())[..12]),
        revision: session.revision,
        status: "ready".into(),
        allowed_systems: session.profile.allowed_systems.clone(),
        lines,
        lyrics_source: "user".into(),
    };
    session.sheet = Some(sheet.clone());
    let track = session.snapshot.track.clone();
    drop(session);
    state.emit("lyrics-sheet", json!({"track": track, "sheet": sheet}));
    true
}

/// 空耳路由的 body 上限。JSON 跳脫時每個位元組最多佔 6 位元組（`\u00XX`），
/// 因此以 MAX_BYTES 乘 6，再加上 trackKey 與 JSON 外層的餘量。
pub const BODY_LIMIT: usize = 6 * MAX_BYTES + 4 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct FormatRequest {
    track_key: String,
    text: String,
    anchor_video: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TextRequest {
    track_key: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct KeyRequest {
    track_key: String,
}

/// 目前曲目；trackKey 不符或曲目已切換時回傳 None。
async fn current_track(state: &AppState, track_key: &str) -> Option<Track> {
    let session = state.session.lock().await;
    if matches_current(session.snapshot.track.as_ref(), track_key) {
        session.snapshot.track.clone()
    } else {
        None
    }
}

pub(crate) async fn format_konger(
    State(state): State<AppState>,
    payload: Result<Json<FormatRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = payload else {
        return json_error(StatusCode::BAD_REQUEST, "invalid konger request");
    };
    if request.track_key.chars().count() > MAX_TRACK_KEY_CHARS {
        return json_error(StatusCode::BAD_REQUEST, "trackKey is too long");
    }
    if request.text.trim().is_empty() {
        return json_error(StatusCode::BAD_REQUEST, "請先貼上空耳內容");
    }
    if request.text.len() > MAX_BYTES {
        return json_error(StatusCode::BAD_REQUEST, "空耳內容超過 60,000 位元組");
    }
    let session = state.session.lock().await;
    let track = match session.snapshot.track.as_ref() {
        Some(track) if matches_current(Some(track), &request.track_key) => track,
        _ => return json_error(StatusCode::CONFLICT, "track is no longer current"),
    };
    if request.anchor_video && track.source.connector != "browser" {
        return json_error(StatusCode::BAD_REQUEST, "只有 YouTube 影片可使用影片時間軸");
    }
    let sheet_lines = session
        .sheet
        .as_ref()
        .filter(|sheet| {
            sheet.track_key == request.track_key
                && sheet.status == "ready"
                && sheet.lines.iter().any(|line| line.start_ms.is_some())
        })
        .map(|sheet| sheet.lines.as_slice());
    let (effective_offset_ms, _, _) = crate::sync_offset::effective_offset(&session);
    let outcome = format_input(
        &request.text,
        &FormatContext {
            track,
            sheet_lines,
            reference_duration_ms: session.sync.reference_duration_ms,
            effective_offset_ms,
            anchor_video: request.anchor_video,
        },
    );
    Json(json!({"draft": outcome.draft, "report": outcome.report})).into_response()
}

pub(crate) async fn import_konger(
    State(state): State<AppState>,
    payload: Result<Json<TextRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = payload else {
        return json_error(StatusCode::BAD_REQUEST, "invalid konger request");
    };
    if request.track_key.chars().count() > MAX_TRACK_KEY_CHARS {
        return json_error(StatusCode::BAD_REQUEST, "trackKey is too long");
    }
    let Some(track) = current_track(&state, &request.track_key).await else {
        return json_error(StatusCode::CONFLICT, "track is no longer current");
    };
    let doc = match parse_le_lrc(&request.text) {
        Ok(doc) => doc,
        Err(issues) => {
            return (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(json!({"report": rejected(issues)})),
            )
                .into_response();
        }
    };
    let report = validate(&doc, &validate_context(&track));
    if report.grade == Grade::Reject {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({"report": report})),
        )
            .into_response();
    }
    if let Err(error) = save_konger(&state.konger_dir, &request.track_key, &request.text) {
        eprintln!("Unable to save konger file: {error}");
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "無法儲存空耳檔，請確認應用程式可寫入設定資料夾",
        );
    }
    if !apply_user_sheet(&state, &request.track_key, &request.text, doc).await {
        return json_error(StatusCode::CONFLICT, "track is no longer current");
    }
    Json(json!({"report": report})).into_response()
}

pub(crate) async fn remove_konger(
    State(state): State<AppState>,
    payload: Result<Json<KeyRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = payload else {
        return json_error(StatusCode::BAD_REQUEST, "invalid konger request");
    };
    if request.track_key.chars().count() > MAX_TRACK_KEY_CHARS {
        return json_error(StatusCode::BAD_REQUEST, "trackKey is too long");
    }
    let Some(track) = current_track(&state, &request.track_key).await else {
        return json_error(StatusCode::CONFLICT, "track is no longer current");
    };
    if let Err(error) = delete_konger(&state.konger_dir, &request.track_key) {
        eprintln!("Unable to delete konger file: {error}");
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "無法刪除空耳檔，請確認應用程式可寫入設定資料夾",
        );
    }
    let mut session = state.session.lock().await;
    if !matches_current(session.snapshot.track.as_ref(), &request.track_key) {
        return json_error(StatusCode::CONFLICT, "track is no longer current");
    }
    session.manual_lyrics = false;
    drop(session);
    let background = state.clone();
    tokio::spawn(async move {
        crate::runtime::resolve_track_lyrics(background, track).await;
    });
    (StatusCode::ACCEPTED, Json(json!({"success": true}))).into_response()
}

pub(crate) async fn export_konger(
    State(state): State<AppState>,
    payload: Result<Json<KeyRequest>, JsonRejection>,
) -> Response {
    let Ok(Json(request)) = payload else {
        return json_error(StatusCode::BAD_REQUEST, "invalid konger request");
    };
    if request.track_key.chars().count() > MAX_TRACK_KEY_CHARS {
        return json_error(StatusCode::BAD_REQUEST, "trackKey is too long");
    }
    if current_track(&state, &request.track_key).await.is_none() {
        return json_error(StatusCode::CONFLICT, "track is no longer current");
    }
    match load_konger(&state.konger_dir, &request.track_key) {
        Some(text) => Json(json!({"text": text})).into_response(),
        None => json_error(StatusCode::NOT_FOUND, "這首歌沒有已儲存的空耳"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::TrackSource;

    fn codes(raw: &str) -> Vec<&'static str> {
        parse_le_lrc(raw)
            .err()
            .unwrap_or_default()
            .iter()
            .map(|issue| issue.code)
            .collect()
    }

    fn check(raw: &str) -> Report {
        validate(&parse_le_lrc(raw).unwrap(), &ValidateContext::default())
    }

    fn report_codes(report: &Report) -> Vec<&'static str> {
        report.issues.iter().map(|issue| issue.code).collect()
    }

    #[test]
    fn pairs_original_and_konger_and_keeps_single_line_as_no_konger() {
        let doc = parse_le_lrc(
            "[le:version:1]\n[00:15.20]나를 사랑으로 채워줘요\n[00:15.20]那路 撒郎呃路 七我走有\n[00:19.80]사랑의 배터리가",
        )
        .unwrap();
        assert_eq!(doc.lines.len(), 2);
        assert_eq!(doc.lines[0].start_ms, 15_200);
        assert_eq!(doc.lines[0].original, "나를 사랑으로 채워줘요");
        assert_eq!(
            doc.lines[0].konger.as_deref(),
            Some("那路 撒郎呃路 七我走有")
        );
        assert_eq!(doc.lines[1].start_ms, 19_800);
        assert_eq!(doc.lines[1].konger, None);
    }

    #[test]
    fn three_lines_at_one_timestamp_are_rejected() {
        assert!(
            codes("[le:version:1]\n[00:01.00]a\n[00:01.00]b\n[00:01.00]c")
                .contains(&"E_TOO_MANY_AT_TIMESTAMP")
        );
    }

    #[test]
    fn missing_version_header_is_not_le_format() {
        assert_eq!(codes("[00:01.00]a"), vec!["E_NOT_LE_FORMAT"]);
    }

    #[test]
    fn unsupported_version_is_a_bad_header() {
        assert!(codes("[le:version:2]\n[00:01.00]a").contains(&"E_BAD_HEADER"));
    }

    #[test]
    fn untimed_line_is_reported_with_its_line_number() {
        let issues = parse_le_lrc("[le:version:1]\n[00:01.00]a\nno timestamp")
            .err()
            .unwrap();
        assert_eq!(issues[0].code, "E_UNTIMED_LINE");
        assert_eq!(issues[0].line, Some(3));
    }

    #[test]
    fn offset_header_shifts_times_and_clamps_at_zero() {
        let doc = parse_le_lrc("[le:version:1]\n[offset:-2000]\n[00:01.00]a\n[00:05.00]b").unwrap();
        let starts: Vec<u64> = doc.lines.iter().map(|line| line.start_ms).collect();
        assert_eq!(starts, vec![0, 3_000]);
    }

    #[test]
    fn multi_timestamp_lines_expand_sort_and_warn_once_on_disorder() {
        let doc = parse_le_lrc("[le:version:1]\n[00:30.00][00:10.00]x\n[00:05.00]y").unwrap();
        let starts: Vec<u64> = doc.lines.iter().map(|line| line.start_ms).collect();
        assert_eq!(starts, vec![5_000, 10_000, 30_000]);
        let order_warnings = doc
            .warnings
            .iter()
            .filter(|issue| issue.code == "W_TIMESTAMP_ORDER")
            .count();
        assert_eq!(order_warnings, 1);
    }

    #[test]
    fn length_and_youtube_anchor_headers_are_read_case_insensitively() {
        let doc = parse_le_lrc(
            "[LE:VERSION:1]\n[Length:04:34.00]\n[le:anchor:youtube:abcdefghijk]\n[00:01.00]a",
        )
        .unwrap();
        assert_eq!(doc.length_ms, Some(274_000));
        assert_eq!(doc.anchor, Anchor::Youtube("abcdefghijk".into()));
    }

    #[test]
    fn youtube_anchor_with_wrong_id_length_is_a_bad_header() {
        assert!(
            codes("[le:version:1]\n[le:anchor:youtube:short]\n[00:01.00]a")
                .contains(&"E_BAD_HEADER")
        );
    }

    #[test]
    fn empty_document_and_oversized_document_are_rejected() {
        assert_eq!(codes("[le:version:1]"), vec!["E_EMPTY"]);
        let too_many = format!("[le:version:1]\n{}", "[00:01.00]a\n".repeat(2_000));
        assert!(codes(&too_many).contains(&"E_TOO_LARGE"));
    }

    #[test]
    fn serialized_file_parses_back_to_the_same_lyrics() {
        let raw = "[ti:봄날]\n[length:04:34.00]\n[le:version:1]\n[le:lang:ko]\n[le:anchor:youtube:abcdefghijk]\n[00:15.20]나를\n[00:15.20]那路\n[00:19.80]사랑의";
        let doc = parse_le_lrc(raw).unwrap();
        let text = serialize_le_lrc(&doc, KongerLang::Ko);
        assert!(text.contains("[00:15.20]나를\n[00:15.20]那路\n"));
        let again = parse_le_lrc(&text).unwrap();
        let lyrics = |doc: &KongerDoc| -> Vec<(u64, String, Option<String>)> {
            doc.lines
                .iter()
                .map(|line| (line.start_ms, line.original.clone(), line.konger.clone()))
                .collect()
        };
        assert_eq!(lyrics(&again), lyrics(&doc));
        assert_eq!(again.anchor, doc.anchor);
        assert_eq!(again.length_ms, Some(274_000));
        assert_eq!(again.title.as_deref(), Some("봄날"));
    }

    #[test]
    fn konger_line_with_hangul_under_korean_source_is_rejected() {
        let report = check("[le:version:1]\n[le:lang:ko]\n[00:01.00]나를\n[00:01.00]나를 사랑");
        assert_eq!(report.grade, Grade::Reject);
        assert!(report_codes(&report).contains(&"E_SOURCE_IN_KONGER"));
    }

    #[test]
    fn low_konger_coverage_is_rejected() {
        let report = check(
            "[le:version:1]\n[le:lang:ko]\n[00:01.00]가\n[00:01.00]加\n[00:05.00]나\n[00:05.00]那\n[00:09.00]다\n[00:09.00]达\n[00:13.00]라\n[00:17.00]마",
        );
        assert_eq!(report.stats.source_lines, 5);
        assert!(report_codes(&report).contains(&"E_LOW_COVERAGE"));
    }

    #[test]
    fn matching_syllable_counts_pass() {
        let report = check(
            "[le:version:1]\n[le:lang:ko]\n[00:01.00]너의 눈, 코, 입\n[00:01.00]挪耶 潤, 摳, 依",
        );
        assert_eq!(report.grade, Grade::Pass);
        assert_eq!(report.stats.syllable_checked, 1);
        assert_eq!(report.stats.syllable_mismatch, 0);
    }

    #[test]
    fn large_syllable_gap_is_a_warning_not_a_rejection() {
        let report =
            check("[le:version:1]\n[le:lang:ko]\n[00:01.00]작은 손톱까지 다\n[00:01.00]加");
        assert_eq!(report.grade, Grade::Warn);
        assert!(report_codes(&report).contains(&"W_SYLLABLE_MISMATCH"));
    }

    #[test]
    fn too_many_syllable_mismatches_reject_the_file() {
        let good = "[00:01.00]나를 사랑으로 채워줘요\n[00:01.00]那路撒郎呃路七我走有";
        let raw = format!(
            "[le:version:1]\n[le:lang:ko]\n{good}\n[00:05.00]나를 사랑으로 채워줘요\n[00:05.00]那路撒郎呃路七我走有\n[00:09.00]나를 사랑으로 채워줘요\n[00:09.00]那路撒郎呃路七我走有\n[00:13.00]작은 손톱까지 다\n[00:13.00]加\n[00:17.00]작은 손톱까지 다\n[00:17.00]加"
        );
        let report = check(&raw);
        assert_eq!(report.stats.syllable_checked, 5);
        assert_eq!(report.stats.syllable_mismatch, 2);
        assert!(report_codes(&report).contains(&"E_SYLLABLE_MISMATCH_RATE"));
    }

    #[test]
    fn youtube_anchor_for_another_video_is_rejected() {
        let doc = parse_le_lrc(
            "[le:version:1]\n[le:lang:ko]\n[le:anchor:youtube:abcdefghijk]\n[00:01.00]가\n[00:01.00]加",
        )
        .unwrap();
        let ctx = ValidateContext {
            current_video_id: Some("zzzzzzzzzzz".into()),
            duration_ms: None,
        };
        assert!(report_codes(&validate(&doc, &ctx)).contains(&"E_ANCHOR_MISMATCH"));
    }

    #[test]
    fn konger_identical_to_original_ignoring_punctuation_is_rejected() {
        let report =
            check("[le:version:1]\n[le:lang:other]\n[00:01.00]Oh yeah\n[00:01.00]oh, yeah!");
        assert!(report_codes(&report).contains(&"E_KONGER_EQUALS_ORIGINAL"));
    }

    #[test]
    fn last_line_beyond_song_length_is_rejected() {
        let report = check(
            "[le:version:1]\n[length:00:10.00]\n[le:lang:ko]\n[00:01.00]가\n[00:01.00]加\n[00:30.00]나\n[00:30.00]那",
        );
        assert!(report_codes(&report).contains(&"E_TIME_BEYOND_DURATION"));
    }

    #[test]
    fn document_without_source_language_lines_is_rejected() {
        let report = check("[le:version:1]\n[le:lang:ko]\n[00:01.00]hello");
        assert!(report_codes(&report).contains(&"E_NO_SOURCE_LINES"));
    }

    fn sample_track(source_track_id: Option<&str>) -> Track {
        Track {
            track_key: "youtube:abcdefghijk".to_owned(),
            source: TrackSource {
                connector: "youtube".to_owned(),
                app_id: None,
                source_track_id: source_track_id.map(str::to_owned),
            },
            title: "봄날".to_owned(),
            artists: vec!["BTS".to_owned()],
            album: None,
            duration_ms: Some(214_000),
        }
    }

    fn synced(lines: &[(u64, &str)]) -> Vec<LyricLine> {
        lines
            .iter()
            .enumerate()
            .map(|(index, &(start_ms, text))| LyricLine {
                line_id: format!("line-{index}"),
                start_ms: Some(start_ms),
                end_ms: None,
                original_text: text.to_owned(),
                phonetic: None,
            })
            .collect()
    }

    fn format_with(
        raw: &str,
        sheet: Option<&[LyricLine]>,
        anchor_video: bool,
        offset_ms: i64,
    ) -> FormatOutcome {
        let track = sample_track(Some("abcdefghijk"));
        format_input(
            raw,
            &FormatContext {
                track: &track,
                sheet_lines: sheet,
                reference_duration_ms: Some(214_000),
                effective_offset_ms: offset_ms,
                anchor_video,
            },
        )
    }

    #[test]
    fn konger_only_input_takes_times_from_synced_sheet() {
        let sheet = synced(&[
            (15_200, "나를 사랑으로 채워줘요"),
            (19_800, "사랑의 배터리가"),
            (23_000, "oh yeah"),
        ]);
        let outcome = format_with(
            "那路 撒郎呃路 七我走有\n撒郎 배터리",
            Some(sheet.as_slice()),
            false,
            0,
        );
        let doc = parse_le_lrc(&outcome.draft.expect("draft")).unwrap();
        let lines: Vec<(u64, &str, Option<&str>)> = doc
            .lines
            .iter()
            .map(|line| {
                (
                    line.start_ms,
                    line.original.as_str(),
                    line.konger.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            lines,
            vec![
                (
                    15_200,
                    "나를 사랑으로 채워줘요",
                    Some("那路 撒郎呃路 七我走有")
                ),
                (19_800, "사랑의 배터리가", Some("撒郎 배터리")),
                (23_000, "oh yeah", None),
            ]
        );
    }

    #[test]
    fn konger_only_input_must_match_sheet_count() {
        let sheet = synced(&[
            (15_200, "나를 사랑으로 채워줘요"),
            (19_800, "사랑의 배터리가"),
        ]);
        let outcome = format_with("那路\n撒郎\n七我", Some(sheet.as_slice()), false, 0);
        assert!(outcome.draft.is_none());
        assert_eq!(report_codes(&outcome.report), vec!["F_COUNT_MISMATCH"]);
        assert_eq!(outcome.report.grade, Grade::Reject);
    }

    #[test]
    fn konger_only_input_without_synced_sheet_is_rejected() {
        let outcome = format_with("那路 撒郎呃路", None, false, 0);
        assert!(outcome.draft.is_none());
        assert_eq!(report_codes(&outcome.report), vec!["F_NEED_SYNCED_SHEET"]);
    }

    #[test]
    fn paired_input_attaches_each_konger_to_the_source_line_before_it() {
        let sheet = synced(&[
            (15_200, "나를 사랑으로 채워줘요"),
            (19_800, "사랑의 배터리가"),
        ]);
        let raw =
            "那路 撒郎呃路\n나를 사랑으로 채워줘요\n那路 撒郎呃路\n사랑의 배터리가\n撒郎 배터리";
        let outcome = format_with(raw, Some(sheet.as_slice()), false, 0);
        let doc = parse_le_lrc(&outcome.draft.expect("draft")).unwrap();
        let lines: Vec<(u64, Option<&str>)> = doc
            .lines
            .iter()
            .map(|line| (line.start_ms, line.konger.as_deref()))
            .collect();
        assert_eq!(
            lines,
            vec![
                (15_200, Some("那路 撒郎呃路")),
                (19_800, Some("撒郎 배터리"))
            ]
        );
        let orphan = outcome
            .report
            .issues
            .iter()
            .find(|issue| issue.code == "W_ORPHAN_KONGER");
        assert_eq!(orphan.and_then(|issue| issue.line), Some(1));
    }

    #[test]
    fn source_line_out_of_sheet_order_is_skipped_with_warning() {
        let sheet = synced(&[(1_000, "가가"), (2_000, "나나")]);
        let outcome = format_with("나나\n那\n가가\n嘎", Some(sheet.as_slice()), false, 0);
        let doc = parse_le_lrc(&outcome.draft.expect("draft")).unwrap();
        let lines: Vec<(u64, Option<&str>)> = doc
            .lines
            .iter()
            .map(|line| (line.start_ms, line.konger.as_deref()))
            .collect();
        assert_eq!(lines, vec![(1_000, Some("嘎")), (2_000, None)]);
        let skipped = outcome
            .report
            .issues
            .iter()
            .find(|issue| issue.code == "W_UNMATCHED_LINE");
        assert_eq!(skipped.and_then(|issue| issue.line), Some(1));
    }

    #[test]
    fn video_anchor_shifts_times_by_offset_and_names_the_video() {
        let sheet = synced(&[(15_200, "나를 사랑으로 채워줘요")]);
        let outcome = format_with("那路 撒郎呃路", Some(sheet.as_slice()), true, 12_000);
        let doc = parse_le_lrc(&outcome.draft.expect("draft")).unwrap();
        assert_eq!(doc.anchor, Anchor::Youtube("abcdefghijk".to_owned()));
        assert_eq!(doc.lines[0].start_ms, 27_200);
    }

    #[test]
    fn timed_input_gets_missing_title_length_and_song_anchor_from_track() {
        let outcome = format_with(
            "[00:15.20]나를 사랑으로 채워줘요\n[00:15.20]那路 撒郎呃路",
            None,
            false,
            0,
        );
        let doc = parse_le_lrc(&outcome.draft.expect("draft")).unwrap();
        assert_eq!(doc.title.as_deref(), Some("봄날"));
        assert_eq!(doc.length_ms, Some(214_000));
        assert_eq!(doc.anchor, Anchor::Song);
        assert_eq!(doc.lines[0].start_ms, 15_200);
    }

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("konger-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn browser_track(video_id: &str) -> Track {
        let mut track = sample_track(Some(video_id));
        track.source.connector = "browser".to_owned();
        track
    }

    const ANCHORED_TEXT: &str = "[le:version:1]\n[le:lang:ko]\n[le:anchor:youtube:abcdefghijk]\n[00:15.20]나를 사랑으로 채워줘요\n[00:15.20]那路 撒郎呃路 七我走有\n[00:19.80]사랑의 배터리가\n[00:19.80]沙朗 北特里嘎";

    #[test]
    fn saved_file_round_trips_overwrites_and_delete_is_idempotent() {
        let dir = scratch_dir("round-trip");
        save_konger(&dir, "youtube:abc", "[le:version:1]\n[00:01.00]a").unwrap();
        save_konger(&dir, "youtube:abc", "[le:version:1]\n[00:02.00]b").unwrap();
        assert_eq!(
            load_konger(&dir, "youtube:abc").as_deref(),
            Some("[le:version:1]\n[00:02.00]b")
        );
        delete_konger(&dir, "youtube:abc").unwrap();
        assert_eq!(load_konger(&dir, "youtube:abc"), None);
        delete_konger(&dir, "youtube:abc").unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn konger_path_stays_inside_store_for_any_track_key() {
        let dir = Path::new("/store");
        assert_eq!(konger_path(dir, "../../etc/passwd").parent(), Some(dir));
        assert_eq!(konger_path(dir, "youtube:a/b").parent(), Some(dir));
        assert_ne!(konger_path(dir, "youtube:a"), konger_path(dir, "youtube:b"));
    }

    #[tokio::test]
    async fn saved_sheet_applies_to_current_browser_track_and_is_marked_manual() {
        let dir = scratch_dir("apply");
        let state = AppState::new(dir.clone());
        let track = browser_track("abcdefghijk");
        state.session.lock().await.snapshot.track = Some(track.clone());
        save_konger(&state.konger_dir, &track.track_key, ANCHORED_TEXT).unwrap();

        assert!(apply_saved(&state, &track).await);

        let session = state.session.lock().await;
        let sheet = session.sheet.as_ref().expect("sheet applied");
        assert_eq!(sheet.lyrics_source, "user");
        assert_eq!(sheet.status, "ready");
        assert_eq!(sheet.lines.len(), 2);
        assert_eq!(sheet.lines[0].start_ms, Some(15_200));
        assert_eq!(sheet.lines[0].end_ms, Some(19_800));
        assert_eq!(
            sheet.lines[0].phonetic.as_deref(),
            Some("那路 撒郎呃路 七我走有")
        );
        assert!(session.manual_lyrics);
        assert!(session.sync.anchored);
        drop(session);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn youtube_anchored_sheet_is_not_applied_outside_browser_source() {
        let dir = scratch_dir("non-browser");
        let state = AppState::new(dir.clone());
        let track = sample_track(Some("abcdefghijk"));
        state.session.lock().await.snapshot.track = Some(track.clone());
        save_konger(&state.konger_dir, &track.track_key, ANCHORED_TEXT).unwrap();

        assert!(!apply_saved(&state, &track).await);
        assert!(state.session.lock().await.sheet.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn apply_user_sheet_changes_nothing_after_track_changed() {
        let dir = scratch_dir("stale");
        let state = AppState::new(dir.clone());
        state.session.lock().await.snapshot.track = Some(browser_track("abcdefghijk"));
        let doc = parse_le_lrc(ANCHORED_TEXT).unwrap();

        assert!(!apply_user_sheet(&state, "youtube:other", ANCHORED_TEXT, doc).await);

        let session = state.session.lock().await;
        assert!(session.sheet.is_none());
        assert!(!session.manual_lyrics);
        drop(session);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
