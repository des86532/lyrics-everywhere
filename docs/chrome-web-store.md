# Chrome Web Store & Edge Add-ons 上架資訊

本文件提供 Chrome 應用程式商店（Chrome Web Store Developer Dashboard）與 Microsoft Edge Add-ons（Partner Center）上架表單所需的文字與填寫說明。

---

## 1. 單一用途聲明（Single-Purpose Statement）

在瀏覽器側邊欄為 YouTube、YouTube Music 與 Spotify Web 提供同步滾動歌詞、讀音標註與本機音訊字幕。

---

## 2. 擴充功能名稱與說明

### 商店顯示名稱
`Lyrics Everywhere 耳邊字幕`

### 簡短說明（Short Description，≤132 字元）
`在 YouTube、YouTube Music、Spotify Web 播放時於側欄顯示 LRCLIB 同步歌詞與空耳；無同步歌詞的 YouTube 影片可在本機辨識建立字幕。`

### 詳細說明（Long Description，繁體中文）
```markdown
【Lyrics Everywhere 耳邊字幕】

在瀏覽器側欄（Side Panel）隨開隨唱！支援 YouTube、YouTube Music 與 Spotify Web，自動取得同步滾動歌詞與空耳發音；沒有現成歌詞的 YouTube 影片（如翻唱、混音、現場演出），更可透過本機 WebGPU 辨識模型自動產生字幕。

主要特色：
• 側邊欄隨行播放：直接整合 Chrome / Edge 側邊欄，不遮擋主要網頁，工作或娛樂時隨時跟唱。
• 多平台同步歌詞：支援 YouTube / YouTube Music / Spotify Web，自動向開放歌詞庫 LRCLIB 查詢動態時間軸歌詞。
• 日韓歌詞空耳：可選擇以「中文近音字」或「羅馬拼音」顯示發音，原文保留語言（中／英／日／韓）可自由勾選。
  - 日語：內建 Kuromoji IPADIC 離線辭典，自動推算假名混寫詞中的漢字讀音；純漢字段落保留原文。
  - 韓語：套用連音、鼻音化等發音規則轉寫，羅馬拼音採 Revised Romanization。
• 歌詞校時（YouTube 單曲）：遇到開頭有 MV 劇情或空白的影片，可在校時模式點選正在唱的那句歌詞自動對齊、以 0.5 秒微調，或於設定中輸入偏移秒數；校時依影片與歌詞版本記錄於本機。
• 本機 AI 語音辨識（WebGPU，YouTube 影片）：
  - 沒有可用同步歌詞的 YouTube 影片，可透過瀏覽器 WebGPU 於本機執行 Whisper 模型，產生時間戳記字幕並可重播跟唱。
  - 僅在使用者按下「建立字幕」時擷取該分頁音訊，全程於本機辨識，不保存音訊、不上傳雲端；首次使用需從 Hugging Face 下載 Whisper 模型並快取於瀏覽器。
• 隱私優先、無追蹤：不含廣告、無追蹤分析代碼、不蒐集個人資料；歌詞查詢僅傳送曲名與歌手至 LRCLIB。

使用方式：
1. 開啟 YouTube、YouTube Music 或 Spotify Web 播放歌曲或影片。
2. 點擊瀏覽器工具列上的「Lyrics Everywhere」圖示開啟側欄。
3. 側欄即自動顯示同步歌詞與空耳；如需校時可按「校時」對齊，或於設定中微調秒數。
```

---

## 3. 權限宣告原因（Permission Justifications）

商店審查時針對每個權限的簡要用途說明（英文與中文對照）：

### API 權限 (`permissions`)

| 權限 | 審查用途說明（Justification） |
|---|---|
| `sidePanel` | 用於在瀏覽器側邊欄顯示歌詞使用者介面，讓使用者在瀏覽播放頁面時不需切換視窗即可同步查看歌詞。<br>*(Used to display the synchronized lyrics and transcription UI in the browser side panel.)* |
| `tabCapture` | 僅在使用者點擊「建立字幕」時，擷取當前播放分頁的音訊串流，直接交由本機 WebGPU Web Worker 進行 Whisper 語音辨識，絕不上傳。<br>*(Captures tab audio stream only upon explicit user request ("建立字幕") to perform local on-device speech-to-text with WebGPU.)* |
| `activeTab` | 當使用者點擊擴充功能工具列圖示時，獲取當前分頁授權以啟動側欄與連接音訊擷取。<br>*(Grants temporary tab access when user clicks the extension action icon to open the panel and authorize capture.)* |
| `storage` | 於使用者本機儲存外觀設定、各影片的手動歌詞校時偏移量、手動選擇之歌詞編號與排除自動比對紀錄。<br>*(Stores user UI preferences, manual lyric timing offsets, and lyric selections locally on the user device via chrome.storage.local.)* |
| `scripting` | 在使用者開啟擴充功能且分頁尚未載入播放腳本時，動態向播放分頁注入 content script 以回報播放進度。<br>*(Injects content scripts into active playback tabs to establish playback position reporting when not already injected.)* |

### 主機權限 (`host_permissions`)

| 主機 | 審查用途說明（Justification） |
|---|---|
| `https://huggingface.co/*`<br>`https://*.huggingface.co/*`<br>`https://hf.co/*`<br>`https://*.hf.co/*` | 僅在使用者於側欄點擊「載入辨識模型」時，由瀏覽器向 Hugging Face 下載開源 Whisper ONNX 權重檔並快取於本機。<br>*(Downloads open-source Whisper ONNX model weights to the local browser cache when the user initiates local transcription.)* |
| `https://lrclib.net/*` | 依據當前播放歌曲的曲名與歌手（自動比對失敗時，改用影片標題關鍵字）查詢開源 LRCLIB 資料庫中的同步動態歌詞。<br>*(Queries open-source LRCLIB API for synchronized time-coded lyrics using the current track title and artist, or title keywords as a fallback.)* |
| `https://www.youtube.com/*`<br>`https://music.youtube.com/*`<br>`https://open.spotify.com/*` | 於支援的播放頁面注入 content script 讀取播放器時間、曲名與播放狀態，以及在使用者切換分頁時進行分頁清單查詢。<br>*(Executes content scripts on supported media pages to detect playback time, track title, and media state for lyrics synchronization.)* |

---

## 4. 資料隱私與使用宣告表單（Data Usage & Privacy）

在 Chrome Web Store 的「隱私權實務」（Privacy practices）分頁填寫：

- **遠端程式碼（Remote Code）：** 否（No，所有程式碼均隨擴充功能打包；模型權重為資料檔，由本機已打包之 ONNX Runtime WASM 執行）。
- **資料蒐集聲明：**
  - **網站內容（Website Content）：** 勾選（content script 讀取播放進度、曲名與歌手；曲名、歌手或標題關鍵字會送至 LRCLIB 查詢歌詞，不蒐集或外傳個人身分）。
  - **使用者活動（User Activity）：** 不蒐集。
  - **個人身分資訊（Personally Identifiable Information）：** 不蒐集。
  - **驗證憑證（Authentication Information）：** 不蒐集。
  - **財務與付款資訊（Financial and Payment Information）：** 不蒐集。
  - **健康資訊（Health Information）：** 不蒐集。
- **資料銷售承諾：**
  - [x] 我保證不會向第三方出售使用者資料。
  - [x] 我保證不會將使用者資料用於或轉移至與核心功能無關的目的。
  - [x] 我保證不會將使用者資料用於信用評估或貸款核准目的。
- **隱私權政策網址（Privacy Policy URL）：**
  - 填入 GitHub Pages 網址：`https://des86532.github.io/lyrics-everywhere/`（需先在 repo Settings → Pages 將 Source 設為「GitHub Actions」，並合併後等 `Deploy privacy policy site` 工作流程成功）。

---

## 5. 商店素材清單（Store Assets Checklist）

圖示與宣傳橫幅存放於專案根目錄之 `store-assets/`；宣傳橫幅可透過 `pnpm run build:store-assets` 重新產出（目前渲染腳本僅支援 macOS 的 Microsoft Edge）。螢幕截圖需自行手動截取真實畫面：

1. **商店圖示（Store Icon）：**
   - 檔案：`store-assets/store-icon-128x128.png`
   - 規格：128×128 PNG（建議圖案四周保留透明邊距）
2. **螢幕截圖（Screenshots，手動截取，1–5 張）：**
   - 規格：**1280×800**（或 640×400）PNG／JPEG，不含透明。
   - 建議畫面（須為真實操作畫面）：
     - 同步歌詞：YouTube 播放畫面 + 側欄五行跟唱視窗與空耳。
     - 校時：「校時」模式或設定視窗中的歌詞時間偏移。
     - 手動指定：「手動指定歌詞」區段與「版本 (N)」候選清單。
     - 本機字幕：無同步歌詞的 YouTube 影片建立字幕的進度畫面。
3. **宣傳橫幅（Promo Tiles）：**
   - **小型宣傳橫幅（Small Promo Tile，必填/建議）：**
     - 檔案：`store-assets/promo-tile-small-440x280.png`
     - 規格：440×280 PNG
   - **大型促銷橫幅（Marquee Promo Tile，選填）：**
     - 檔案：`store-assets/promo-tile-marquee-1400x560.png`
     - 規格：1400×560 PNG

---

## 6. 上架操作步驟指南（Step-by-Step Submission Guide）

### 步驟 1：開發者帳號註冊與登入
1. 開啟 [Chrome Web Store 開發者控制台 (Developer Dashboard)](https://chrome.google.com/webstore/devconsole/)。
2. 登入 Google 帳號（請確保已啟用雙重驗證 2FA）。
3. 首次註冊需支付一次性註冊費 **$5 美元** 並填寫開發者聯絡資訊。

### 步驟 2：打包並上傳擴充功能套件
1. 於終端機執行：
   ```bash
   pnpm run package:extension
   ```
2. 產出套件位於：`release/lyrics-everywhere-extension.zip`。
3. 在開發者控制台右上角點擊 **「新增項目 (New Item)」**，上傳該 zip 檔案。

### 步驟 3：填寫商品資訊（Store Listing）
1. **商品名稱**：填入 `Lyrics Everywhere 耳邊字幕`
2. **摘要（Short Description）**：填入第 2 節之簡短說明（≤132 字元）
3. **詳細說明（Detailed Description）**：複製第 2 節之詳細說明 Markdown 內容
4. **圖示**：上傳 `store-assets/store-icon-128x128.png`
5. **螢幕截圖**：上傳第 5 節說明的手動截圖（1280×800 或 640×400）
6. **小型宣傳橫幅**：上傳 `store-assets/promo-tile-small-440x280.png`
7. **類別（Category）**：選擇 **娛樂 (Lifestyle › Entertainment)**（Edge Add-ons 亦可選 Entertainment）
8. **官方網站 / 支援網址**：填入專案網址或 GitHub 儲存庫

### 步驟 4：填寫隱私權實務問卷（Privacy Practices）
1. **單一用途聲明**：複製第 1 節內容。
2. **權限原因（Permissions）**：
   - 依序複製第 3 節提供的 Justification（可填中文或英文）。
3. **資料使用情形（Data Usage）**：
   - 勾選「網站內容 (Website Content)」，說明文字填寫：「讀取播放頁面的曲名、歌手與播放進度，曲名、歌手或標題關鍵字會送至 LRCLIB 查詢同步歌詞並於本機顯示，不蒐集或外傳個人身分資料。」
   - 其餘項目皆勾選「否 (No)」。
   - 勾選三項承諾（不向第三方出售資料、不將資料用於非核心功能、不進行信用評估）。
4. **隱私權政策網址**：填入已部署的隱私權政策網頁（GitHub Pages，對應本專案 `site/index.html`，由 `pages.yml` 部署）。

### 步驟 5：分發設定（Distribution）
1. **可見度（Visibility）**：選擇「公開 (Public)」。
2. **定價（Pricing）**：選擇「免費 (Free)」。
3. **發布區域**：預設全球所有國家/地區。

### 步驟 6：提交審查（Submit for Review）
1. 確認所有必填項目皆有綠色勾號。
2. 點擊右上角 **「提交以供審查 (Submit for Review)」**。
3. 審查時間通常為 **1 至 3 個工作天**（若遇週末或重大版本更新可能延長至 5 天）。
