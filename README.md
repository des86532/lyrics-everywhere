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
3. **Sing (跟唱 - 極簡流暢空耳，重塑速度與節奏)**：
   - **流暢跟唱 > 死板音標**：聽眾對熟悉歌曲早有旋律與聲音記憶。空耳的本質是**「每一拍的視覺節奏提示點 (Cues)」**。
   - **徹底解決字數過長、速度跟不上的痛點**：
     - 先前版本在每個收音音節強制掛載英文字母（如 `奴n`, `伊p`, `索ngil`），導致字串臃腫混雜，1x 速度下眼球無法迅速掃視。
     - **全新極簡流暢模式 (`streamlined`，預設推薦)**：
       - 嚴格落實 **1 韓文音節 = 1 乾淨常用繁中字**，徹底拔除 `-p`, `-l`, `-k`, `-n` 等英文字母後綴！
       - 微弱塞音收音 (`p, t, k`) 自然吸收，由歌者閉唇頓音帶出（如 `입 → 依`, `작 → 加`, `꽃 → 口`）。
       - 流音 (`l`) 與鼻音 (`n, ng, m`) 完整融合成單一漢字（如 `너의 눈, 코, 입` -> `挪耶 潤 摳 依`，5 音節對 5 漢字；`날 만지던 네 손길` -> `乃 滿基東 內 送ㄍㄧ`）。
       - 視覺寬度直接減半，閱讀速度提升 2~3 倍，完美跟上原曲節拍！
     - **精準標註模式 (`precise`，進階選項)**：保留給想深入對照收音字母的使用者。

---

## 支援的顯示模式

在置頂跟唱視圖頂部，提供清爽的二段模式切換：
- 🎤 **極簡流暢跟唱（預設推薦）**：1 音節 = 1 乾淨漢字，字數極簡、絕不拖長，速度輕鬆跟上！
- ⚙️ **精準標註模式**：展開拼音工具勾選框，支援中文漢字、台灣注音、英文字母混合標註。

---

## 模組劃分

- `src/domain/types.ts`：不可變資料合約 (`TrackMetadata`, `FullLyricsSheet`, `PlaybackCursor`, `PronunciationProfile`, `PronunciationMode`, `LineAnnotation`)。
- `src/connectors/`：播放來源抽象介面 (`MediaConnector`)、macOS Spotify 本地串接 (`SpotifyMacConnector`)、測試模擬器 (`MockConnector`)。
- `src/lyrics/`：LRC 時間戳解析器 (`parseLrc`)、LRCLIB API 客戶端與候選評分器 (`LrclibClient`)。
- `src/pronunciation/`：
  - `korean-homophone-data.ts`：擴充開音節矩陣、濁化調諧與對齊式語法助詞庫。
  - `blended-homophone.ts`：單音節收音融合與混成空耳合成核心（保證一音節一拍）。
  - `korean-engine.ts` & `korean-transcriber.ts`：整行音韻序列 G2P 引擎與極簡流暢空耳轉寫。
  - `japanese-transcriber.ts`：日語五十音假名與常用片語轉寫。
  - `transcriber-registry.ts`：多語言動態分流與註冊中心。
- `src/session/`：播放工作階段協調器 (`PlaybackSession`)，管理全曲歌譜生命週期與游標推播。
- `src/ui/`：全曲歌詞滾動視圖與 Companion 伺服端 (`CompanionServer`)，提供 SSE 全曲/游標分流、二段模式切換與手動滾動防干擾機制。

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

開啟瀏覽器前往 `http://localhost:3838`，即可看見：
- **全篇歌詞一次預載**：開唱前即完整展示全曲原文與極簡空耳。
- **即時段落動態高亮**：當前行金色放大高亮，並平滑自動滾動置中。
- **手動滾動防拉回**：手動上下滑動時暫停自動滾動 4 秒，提供「📍 回到目前段落」按鈕。
- **流暢跟唱體驗**：純淨 1:1 漢字提示，字數精簡、跟唱速度無延遲！

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

目前以 macOS + Chrome Stable 驗證一般 YouTube watch 與 YouTube Music 的 title、artist、play/pause、position、duration、playback rate 與 SPA 換片。Chrome extension 只把必要的播放 metadata 傳送到本機 127.0.0.1:3838；歌詞查詢仍會送至既有 LRCLIB client。

一般 YouTube 的 channel 可能不是實際歌手，因此 artist 與 LRCLIB 命中是 best effort。Safari、未實測的 Chromium 衍生瀏覽器、Shorts、直播、投放到其他裝置與 DRM 不在支援承諾內。廣告不會被當成新 track；extension 或 companion 失聯超過 freshness TTL 後，來源會變成 unavailable。
