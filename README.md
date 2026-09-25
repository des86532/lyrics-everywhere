# Universal Sing-Along Companion (`lyrics-everywhere`)

> 無論音樂從哪裡播放，都能快速取得歌曲、同步目前段落，並把外語歌詞轉成台灣使用者熟悉、可直接跟唱的注音發音標記。

---

## 核心設計理念與架構 (Recognize → Sync → Sing)

本產品定位為 **Universal Sing-Along Companion**，非音樂播放器，亦不綁定單一平台：

1. **Recognize (辨識)**：
   - 透過 OS Media Session / Spotify Desktop 本地 Connector 取得目前播放歌曲之 Title、Artist、Album、Duration 與 Position。
   - 不依賴私有未受保護 API，macOS 優先採用穩定的 Apple Events / Scripting Dictionary。
2. **Sync (同步)**：
   - 整合標準 LRC / Enhanced LRC 解析器。
   - 本地 Monotonic Clock 時間軸外推，降低輪詢負擔並消除閃爍。
   - 具備換歌 Stale Request Guard，快速切歌時自動捨棄舊歌延遲回應。
3. **Sing (跟唱)**：
   - **韓語音韻學 G2P 引擎 (`KoreanEngine`)**：完整實作韓語連音 (Liaison)、收音代表音中和 (Coda Neutralization)、鼻音化 (Nasalization)、流音化 (Lateralization)、送氣化 (Aspiration) 與 ㅎ 脫落等音變規則。
   - **台灣注音映射器**：將表面音韻轉換為台灣使用者習慣之注音符號，支援流行歌曲例外詞典（如 `사랑해`、`너를`、`감사합니다`）。

---

## 模組劃分

- `src/domain/`：不可變資料合約 (`TrackMetadata`, `PlaybackSnapshot`, `SyncedLyrics`, `PronunciationProfile`, `LineAnnotation`)。
- `src/connectors/`：播放來源抽象介面 (`MediaConnector`)、macOS Spotify 本地串接 (`SpotifyMacConnector`)、測試模擬器 (`MockConnector`)。
- `src/lyrics/`：LRC 時間戳解析器 (`parseLrc`)、LRCLIB API 客戶端與候選評分器 (`LrclibClient`)。
- `src/pronunciation/`：韓語音素拆解、音變規則與注音符號轉換 (`korean-engine`)。
- `src/session/`：播放工作階段協調器 (`PlaybackSession`)，負責防抖動、外推與即時活躍行運算。
- `src/ui/`：輕量置頂跟唱 Companion 服務端 (`CompanionServer`)，提供 SSE 即時推播與毛玻璃視圖。

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

開啟瀏覽器前往 `http://localhost:3838`，即可看見隨時間同步跳動的原文歌詞與動態注音發音輔助！

### 5. macOS Spotify 串接模式

在 macOS 上開啟並播放 Spotify 歌曲，直接執行：

```bash
node dist/cli.js
```
