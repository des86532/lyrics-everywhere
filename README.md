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
   - 韓文收音不再有「簡潔／精準」模式切換，簡潔輸出為唯一模式；可選擇漢字、Bopomofo 或 Latin 顯示方式。
   - 日文假名會轉寫；日文漢字不會被當成假名轉寫。
   - 原文保留語言合併為一組多選設定（預設繁體中文，且至少保留一種）。這只控制顯示時保留哪些原文，不會翻譯歌詞。
   - 例如預設中文原文、勾選保留英文時，韓文會轉成空耳，英文片段（如 `ABC`）維持原樣。

---

## 顯示與語言偏好

Companion 歌詞頁提供唯一的簡潔空耳輸出。原文保留語言以同一組多選控制，預設繁體中文且至少保留一種；選取語言維持原文，未選取語言照常轉寫。這些設定不是歌詞翻譯，也不會呼叫 AI 服務。

拼音工具一次選擇一種顯示方式：中文漢字、台灣注音或英文字母；所選方式套用到轉寫結果。
桌面版會將語言、空耳顯示方式與播放來源偏好保存於本機設定檔，重啟後沿用；偏好面板可重設為預設值。設定不會同步至雲端。

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
- `src-tauri/src/server.rs`：Rust 本機 loopback server、Chrome extension ingest、SSE 與既有 profile API。
- `src-tauri/src/runtime.rs`：平台媒體來源、LRCLIB 查詢、LRC 解析及來源優先序。
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
- **原文語言偏好**：預設保留繁體中文原文；可在同一組設定中多選其他要保留原文的語言.

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
- --source auto：CLI 在 macOS 啟用 Spotify 與 Chrome YouTube；其他平台只啟用 Chrome YouTube。Windows 桌面版由 Tauri Rust runtime 同時啟用 SMTC 與 Chrome，兩者同時播放時 Chrome 優先。
- --source youtube：只接收 Chrome YouTube extension。
- --source spotify：只接收 macOS Spotify；Windows 會提示改用 `--source auto`，因 Windows 不使用 macOS AppleScript connector。
- --demo：使用內建模擬曲目，不偵測外部媒體。

### 支援範圍與限制

macOS + Chrome Stable connector 涵蓋一般 YouTube watch 與 YouTube Music 的 title、artist、play/pause、position、duration、playback rate 與 SPA 換片；實際 Chrome 端到端驗收需依下列步驟載入 extension 後執行。Chrome extension 只把必要的播放 metadata 傳送到本機 127.0.0.1:3838；歌詞查詢仍會送至既有 LRCLIB client。

Windows SMTC 僅能讀取公開媒體工作階段；Windows 10／11 互動桌面與各播放器實機驗收尚未完成，未完成前不發布 Windows 安裝檔。一般 YouTube 的 channel 可能不是實際歌手，因此 artist 與 LRCLIB 命中是 best effort。Safari、未實測的 Chromium 衍生瀏覽器、Shorts、直播、投放到其他裝置與 DRM 不在支援承諾內。廣告不會被當成新 track；extension 或 companion 失聯超過 freshness TTL 後，來源會變成 unavailable。
桌面介面提供首次使用步驟、目前來源狀態與 connector 診斷；Chrome connector 只有在支援的 YouTube 分頁回報時才可確認連線狀態，沒有 heartbeat 不代表擴充功能一定未安裝。歌詞找不到時可重試 LRCLIB、手動搜尋並選擇候選結果。


## 桌面版與 Windows 支援

Windows 桌面版使用 Windows System Media Transport Controls (SMTC) 讀取播放中的公開媒體工作階段；不分析原始音訊。僅提供公開工作階段資訊的播放器可被偵測，標題或歌手缺失時不會假造曲目。Chrome YouTube／YouTube Music 仍由本機擴充功能傳送播放資訊。macOS Spotify AppleScript connector 保留。

Tauri 桌面程式使用 Rust 建立本機 Companion、Windows SMTC、macOS Spotify connector 與歌詞服務，沿用既有 HTML/CSS 頁面及 TypeScript 轉寫器。桌面程式綁定 `127.0.0.1:3838`，不依賴 Electron、Node 或 .NET 執行期；Cloudflare Pages 只發布 `site/` 下載頁，沒有遠端 Companion 或共用播放 session。Chrome YouTube／YouTube Music 仍透過本機 extension 接入。
桌面介面會提供開始使用指引與目前來源狀態；偏好與播放 metadata 保持本機，歌詞查詢、重試及候選選擇使用 LRCLIB。本產品不做原始音訊指紋辨識，也不翻譯歌詞。

### Rust 開發與桌面建置

- 安裝 Node.js 22、pnpm 10、Rust stable 與 Tauri 所需平台 SDK。
- 執行 `pnpm run desktop:dev` 啟動 Tauri 桌面版；執行 `pnpm run desktop:build` 建立目前平台安裝檔。
- GitHub Actions CI 在 Windows 與 macOS 執行 TypeScript／Rust 驗證；正式安裝檔僅由手動 release workflow 建置。
### 桌面安裝與驗收

- GitHub Actions `.github/workflows/release.yml` 僅可手動執行。Windows 10／11 互動桌面實機驗收完成前，`windows_hardware_verified` 不得設為 true；未設時 workflow 只建置，不建立公開 Release。
- Windows 首版目標為 x64 NSIS 安裝檔，macOS 產生 Apple silicon 與 Intel DMG。macOS 產物目前未配置 Developer ID 簽章或 notarization。
- Chrome 擴充功能未上架 Chrome Web Store；請依 `browser-extension/README.md` 使用 unpacked extension。
- 在 Windows 10／11 互動使用者桌面播放 Spotify 與 Chrome YouTube，驗證標題、進度、暫停、切歌及無媒體狀態後，才可發布 Windows 安裝檔。未執行實機驗收不得宣稱 Windows 播放器支援已驗收。

### Cloudflare Pages

`site/` 是獨立靜態頁，已部署於 https://lyrics-everywhere.pages.dev/。登入有 Pages 權限的 Cloudflare 帳號後，可用下列命令更新：

```sh
pnpm dlx wrangler whoami
pnpm dlx wrangler pages project create lyrics-everywhere --production-branch main
pnpm dlx wrangler pages deploy site --project-name lyrics-everywhere --branch main
```

若 Pages 專案已存在，略過 create。頁面從 GitHub Releases API 讀取最新版本，只有實際存在的資產會顯示下載連結。Cloudflare 不接收播放 metadata。
