# Universal Sing-Along Companion (`lyrics-everywhere`)

> 無論音樂從哪裡播放，都能快速取得歌曲、同步目前段落，並把外語歌詞轉成台灣使用者熟悉、可直接跟唱的單行混成空耳（中文 + 英文/注音）發音標記，並支援全曲歌詞預載與動態高亮。

---

## 核心設計理念與架構 (Recognize → Sync → Sing)

本產品定位為 **Universal Sing-Along Companion**，非音樂播放器，亦不綁定單一平台：

1. **Recognize (辨識)**：
   - 透過 OS Media Session / Spotify Desktop 本地 Connector 取得目前播放歌曲之 Title、Artist、Album、Duration 與 Position。
   - 不依賴私有未受保護 API，macOS 優先採用穩定的 Apple Events / Scripting Dictionary。
2. **Sync (同步 & 全曲預載)**：
   - **全篇歌譜預先載入 (`FullLyricsSheet`)**：換歌時立即透過 SSE 一次性交付全曲所有行（原文 ＋ 混成空耳），讓使用者在歌曲開唱前即可縱覽全篇歌詞。
   - **輕量游標推播 (`PlaybackCursor`)**：播放進行中每秒僅推送輕量游標，動態高亮目前段落，並平滑自動滾動置中。
   - **手動瀏覽防干擾保護 (4 秒保護)**：使用者向上或向下滾動瀏覽全曲時，自動暫停置中 4 秒（右下角提供「📍 回到目前段落」快捷鍵），避免強制拉回影響閱讀。
3. **Sing (跟唱 - 汲取民間優秀空耳法則之單行混成引擎)**：
   - **深度對齊 YouTube 經典民間空耳精華**：參考 Hong Jin Young〈愛情的電池〉、TAEYANG〈眼，鼻，口〉、TAEYEON〈11:11〉等熱門空耳神曲規律，全面重構轉寫演算法。
   - **四大黃金發音法則**：
     1. **混成符號主動嵌入**：漢字無法自然表達之音節，主動選取注音（`ㄅㄧㄡ`、`ㄇㄧㄡ`、`ㄍㄧ`）或英文（`gi`、`l`、`p`），組成緊湊單一 cluster（例：`죽이고 → 朱gi勾`；`별 → ㄅㄧㄡ`；`빌며 → 逼ㄇㄧㄡ`）。
     2. **節奏 1:1 對位**：徹底消除「昂/恩/姆/爾」等冗餘贅字，表面音節數與顯示 cluster 數嚴格相等，絕不拉長拍子。
     3. **高頻語法助詞口語化**：將 `-요→有`、主格 `-가→嘎`、`-으로→呢路`、屬格 `의→欸` 等語法助詞情境感知口語化。
     4. **整行音韻序列解析 (Line-level G2P)**：確保跨音節連音聲母移位持續傳遞（例：`오늘이→偶呢李`、`생각이→生嘎ㄍㄧ`、`초라해지잖아→抽拉黑基炸拿`）。

---

## 支援的拼音工具系統

在置頂跟唱視圖頂部，可自由勾選 1～3 種拼音工具組合：
- 🀄 **中文漢字**：自然常用的一拍漢字主音（如 `撒`, `朗`, `難`, `當`）。
- 🔤 **英文字母**：精準標註閉塞音、流音與嵌入式字母（如 `gi`, `-p`, `-l`, `-k`）。
- ㄅ **台灣注音**：精確標註介音與無聲尾輔音（如 `ㄅㄧㄡ`, `ㄇㄧㄡ`, `ㄍ˙`, `ㄌ`）。

---

## 模組劃分

- `src/domain/`：不可變資料合約 (`TrackMetadata`, `FullLyricsSheet`, `PlaybackCursor`, `PronunciationProfile`, `LineAnnotation`)。
- `src/connectors/`：播放來源抽象介面 (`MediaConnector`)、macOS Spotify 本地串接 (`SpotifyMacConnector`)、測試模擬器 (`MockConnector`)。
- `src/lyrics/`：LRC 時間戳解析器 (`parseLrc`)、LRCLIB API 客戶端與候選評分器 (`LrclibClient`)。
- `src/pronunciation/`：
  - `korean-homophone-data.ts`：擴充開音節矩陣、濁化調諧與對齊式語法助詞庫。
  - `blended-homophone.ts`：單音節收音融合與混成空耳合成核心（保證一音節一拍）。
  - `korean-engine.ts` & `korean-transcriber.ts`：整行音韻序列 G2P 引擎與單行混成空耳轉寫。
  - `japanese-transcriber.ts`：日語五十音假名與常用片語轉寫。
  - `transcriber-registry.ts`：多語言動態分流與註冊中心。
- `src/session/`：播放工作階段協調器 (`PlaybackSession`)，管理全曲歌譜生命週期與游標推播。
- `src/ui/`：全曲歌詞滾動視圖與 Companion 伺服端 (`CompanionServer`)，提供 SSE 全曲/游標分流、拼音系統多選器與手動滾動防干擾機制。

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
- **全篇歌詞一次預載**：開唱前即完整展示全曲原文與混成空耳。
- **即時段落動態高亮**：當前行金色放大高亮，並平滑自動滾動置中。
- **手動滾動防拉回**：手動上下滑動時暫停自動滾動 4 秒，提供「📍 回到目前段落」按鈕。
- **拼音系統組合**：自由勾選「中文」、「英文」、「注音」，即時重新合成單行空耳！

### 5. macOS Spotify 串接模式

在 macOS 上開啟並播放 Spotify 歌曲，直接執行：

```bash
node dist/cli.js
```
