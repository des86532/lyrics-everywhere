# Universal Sing-Along Companion (`lyrics-everywhere`)

> 無論音樂從哪裡播放，都能快速取得歌曲、同步目前段落，並把外語歌詞轉成台灣使用者熟悉、可直接跟唱的極簡流暢空耳（1 音節 = 1 乾淨漢字，字數極簡、跟得上節奏），並支援全曲歌詞預載與動態高亮。

---

## 核心設計理念與架構 (Recognize → Sync → Sing)

本產品定位為 **Universal Sing-Along Companion**，非音樂播放器，亦不綁定單一平台：

1. **Recognize (辨識)**：
   - 透過 OS Media Session / Spotify Desktop 本地 Connector 取得目前播放歌曲之 Title、Artist、Album、Duration 與 Position。
   - 不依賴私有未受保護 API，macOS 優先採用穩定的 Apple Events / Scripting Dictionary。
2. **Sync (同步 & 全曲預載)**：
   - **全篇歌譜預先載入 (`FullLyricsSheet`)**：換歌時立即透過 SSE 一次性交付全曲所有行（原文 ＋ 極簡空耳），讓使用者在歌曲開唱前即可縱覽全篇歌詞。
   - **輕量游標推播 (`PlaybackCursor`)**：播放進行中每秒僅推送輕量游標，動態高亮目前段落，並平滑自動滾動置中。
   - **手動瀏覽防干擾保護 (4 秒保護)**：使用者向上或向下滾動瀏覽全曲時，自動暫停置中 4 秒（右下角提供「📍 回到目前段落」快捷鍵），避免強制拉回影響閱讀。
3. **Sing (跟唱 - 簡潔空耳與原文保留)**：
   - 韓文與日文歌詞由本機確定性轉寫器產生簡潔空耳；目前沒有接入 AI 文字生成 API。
   - 韓文收音不再有「簡潔／精準」模式切換，簡潔輸出為唯一模式；Bopomofo、Latin、漢字顯示工具仍可選。
   - 日文假名會轉寫；日文漢字不會被當成假名轉寫。
   - 可選擇主要原文語言（預設繁體中文），並額外勾選要保留原文的語言。這只控制顯示時保留哪些原文，不會翻譯歌詞。
   - 例如預設中文原文、勾選保留英文時，韓文會轉成空耳，英文片段（如 `ABC`）維持原樣。

---

## 顯示與語言偏好

Companion 歌詞頁提供唯一的簡潔空耳輸出。主要原文語言預設為繁體中文；可改選英文、日文或韓文，或額外勾選英、日、韓、中文以保留對應原文。這些設定不是歌詞翻譯，也不會呼叫 AI 服務。

拼音工具可選中文漢字、台灣注音與英文字母；取消模式切換後，工具選擇仍會套用到轉寫結果。

---

## 模組劃分

- `src/domain/types.ts`：不可變資料合約 (`TrackMetadata`, `FullLyricsSheet`, `PlaybackCursor`, `PronunciationProfile`, `LineAnnotation`)。
- `src/connectors/`：播放來源抽象介面 (`MediaConnector`)、macOS Spotify 本地串接 (`SpotifyMacConnector`)、測試模擬器 (`MockConnector`)。
- `src/lyrics/`：LRC 時間戳解析器 (`parseLrc`)、LRCLIB API 客戶端與候選評分器 (`LrclibClient`)。
- `src/pronunciation/`：
  - `korean-homophone-data.ts`：擴充開音節矩陣、濁化調諧與對齊式語法助詞庫。
  - `blended-homophone.ts`：單音節收音融合與簡潔空耳合成核心。
  - `korean-engine.ts` & `korean-transcriber.ts`：整行音韻序列 G2P 引擎與簡潔空耳轉寫。
  - `japanese-transcriber.ts`：日語五十音假名與常用片語轉寫。
  - `transcriber-registry.ts`：多語言動態分流、原文語言保留與註冊中心。
- `src/session/`：播放工作階段協調器 (`PlaybackSession`)，管理全曲歌譜生命週期與游標推播。
- `src/ui/`：全曲歌詞滾動視圖與 Companion 伺服端 (`CompanionServer`)，提供 SSE 全曲/游標分流、語言偏好與手動滾動防干擾機制。

---

## 快速開始

### 1. 安裝相依套件

```bash
pnpm install
```

### 2. 執行單元測試

```bash
pnpm test
```

### 3. 建置專案

```bash
pnpm run build
```

### 4. 啟動展示模式 (Demo Mode)

在未開啟 Spotify 或任何作業系統環境下，均可啟動示範模擬：

```bash
node dist/cli.js --demo
```

- **全篇歌詞一次預載**：開唱前即完整展示全曲原文與簡潔空耳。
- **即時段落動態高亮**：當前行金色放大高亮，並平滑自動滾動置中。
- **手動滾動防拉回**：手動上下滑動時暫停自動滾動 4 秒，提供「📍 回到目前段落」按鈕。
- **原文語言偏好**：預設保留繁體中文原文；可指定保留其他語言及英文混合片段。

### 5. macOS Spotify 串接模式

在 macOS 上開啟並播放 Spotify 歌曲，直接執行：

```bash
node dist/cli.js
```
## YouTube / YouTube Music 支援

macOS 正常模式可同時接收 Spotify 與 Chrome YouTube 來源。YouTube 偵測透過本機 Chrome MV3 extension，不使用 YouTube API key。

### 啟動

1. 建置並啟動 companion：bash: pnpm install; pnpm run build; node dist/cli.js --source auto
2. 在 Chrome 開啟 chrome://extensions，啟用「開發人員模式」，選擇本專案的 browser-extension/ 目錄載入 unpacked extension。
3. 開啟 https://www.youtube.com/watch?v=... 或 https://music.youtube.com/ 播放歌曲，再開啟 http://localhost:3838。

可用來源模式：
- --source auto：macOS 優先保留目前播放中的來源；同時開始時 Spotify 優先，YouTube 可透過 browser report 接入。
- --source youtube：只接收 Chrome YouTube extension。
- --source spotify：只接收 macOS Spotify；非 macOS 會回報錯誤。
- --demo：使用內建模擬曲目，不偵測外部媒體。

### 支援範圍與限制

目前支援目標為 macOS + Chrome Stable，涵蓋一般 YouTube watch 與 YouTube Music 的 title、artist、play/pause、position、duration、playback rate 與 SPA 換片；實際 Chrome 端到端驗收需依下列步驟載入 extension 後執行。Chrome extension 只把必要的播放 metadata 傳送到本機 127.0.0.1:3838；歌詞查詢仍會送至既有 LRCLIB client。

一般 YouTube 的 channel 可能不是實際歌手，因此 artist 與 LRCLIB 命中是 best effort。Safari、未實測的 Chromium 衍生瀏覽器、Shorts、直播、投放到其他裝置與 DRM 不在支援承諾內。廣告不會被當成新 track；extension 或 companion 失聯超過 freshness TTL 後，來源會變成 unavailable。
