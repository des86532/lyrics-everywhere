# Universal Sing-Along Companion (`lyrics-everywhere`)

> 無論音樂從哪裡播放，都能快速取得歌曲、同步目前段落，並把外語歌詞轉成台灣使用者熟悉、可直接跟唱的中文字諧音（空耳）與注音發音標記。

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
3. **Sing (跟唱 - 中文字空耳與多語言擴充架構)**：
   - **中文字諧音（空耳跟唱）**：針對快速跟唱場景，以直覺常用漢字（如「撒浪嘿」、「歐巴」、「阿里嘎多」）呈現，大幅縮短眼睛掃視與大腦拼讀時間。
   - **漢字空耳選字三規範**：常用字優先（無生僻字）、中性/正面意象（排除不雅負面字）、開口度自然近似。
   - **三層轉寫流程 (Three-tier Hybrid Pipeline)**：
     - Tier 1: 常用片語/慣用詞典（Longest-match 最長匹配優先，如「撒浪嘿」、「康桑哈米達」、「阿里嘎多」）。
     - Tier 2: 規律音節/Mora 對照表（韓語音變表面音節對照、日語五十音對照）。
     - Tier 3: 拼音/注音優雅退避（無法自然以單一漢字表達之音節退避至注音或羅馬字，不造怪字）。
   - **通用多語言轉寫架構 (`TranscriberRegistry`)**：插拔式語言轉寫介面，支援韓語、日語自動識別分流，並可平滑擴充泰語、西語等其他語系。

---

## 支援的顯示模式

在置頂跟唱懸浮窗中，可隨時自由切換：
- 🀄 **中文空耳**：以常用中文字諧音跟唱（例：`사랑해` → `撒浪嘿`；`ありがとう` → `阿里嘎多`）。
- ㄅ **純注音**：標準台灣華語注音符號輔助發音。
- 🀄+ㄅ **雙排對照 (Hybrid)**：第一排為直覺中文字空耳，第二排為精確注音符號。
- 🔤 **純原文**：原汁原味歌詞。

---

## 模組劃分

- `src/domain/`：不可變資料合約 (`TrackMetadata`, `PlaybackSnapshot`, `SyncedLyrics`, `PronunciationProfile`, `LineAnnotation`)。
- `src/connectors/`：播放來源抽象介面 (`MediaConnector`)、macOS Spotify 本地串接 (`SpotifyMacConnector`)、測試模擬器 (`MockConnector`)。
- `src/lyrics/`：LRC 時間戳解析器 (`parseLrc`)、LRCLIB API 客戶端與候選評分器 (`LrclibClient`)。
- `src/pronunciation/`：
  - `language-transcriber.ts`：抽象語言轉寫介面。
  - `transcriber-registry.ts`：多語言動態分流與註冊中心。
  - `korean-engine.ts` & `korean-transcriber.ts`：韓語音韻音變 G2P 引擎與中文字空耳/注音轉寫。
  - `japanese-transcriber.ts`：日語五十音假名與常用片語中文字空耳轉寫。
- `src/session/`：播放工作階段協調器 (`PlaybackSession`)，負責防抖動、外推與即時活躍行運算。
- `src/ui/`：輕量置頂跟唱 Companion 服務端 (`CompanionServer`)，提供即時推播、五種模式動態切換與毛玻璃視圖。

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

開啟瀏覽器前往 `http://localhost:3838`，即可看見隨時間同步跳動的原文歌詞與動態中文字諧音（空耳）發音輔助，並可在上方隨時切換模式！

### 5. macOS Spotify 串接模式

在 macOS 上開啟並播放 Spotify 歌曲，直接執行：

```bash
node dist/cli.js
```
