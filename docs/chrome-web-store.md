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
`在 YouTube、YouTube Music、Spotify Web 播放時於側欄顯示 LRCLIB 同步歌詞與空耳；無歌詞影片可在本機辨識建立字幕。`

### 詳細說明（Long Description，繁體中文）
```markdown
【Lyrics Everywhere 耳邊字幕】

在瀏覽器側欄（Side Panel）隨開隨唱！支援 YouTube、YouTube Music 與 Spotify Web，自動取得同步滾動歌詞與發音轉寫；無歌詞的冷門歌曲或翻唱混音，更可透過本機 WebGPU 辨識模型自動產生字幕。

主要特色：
• 側邊欄隨行播放：直接整合 Chrome / Edge 側邊欄，不遮擋主要網頁，工作或娛樂時隨時跟唱。
• 多平台同步歌詞：支援 YouTube / YouTube Music / Spotify Web，自動向開放歌詞庫 LRCLIB 查詢動態時間軸歌詞。
• 日韓多語言讀音標註：
  - 日語：離線整合 Kuromoji IPADIC 辭典，自動為漢字標註平假名與羅馬拼音。
  - 韓語：整合諺文發音規則轉寫系統。
• 手動時間軸校時：遇到開頭有 MV 劇情或空白的影片，隨時微調時間偏移量（秒數），校時設定本機自動記錄。
• 本機 AI 語音辨識（WebGPU）：
  - 無現成歌詞的混音、翻唱或現場收音影片，可透過瀏覽器內建 WebGPU 於本機執行 Whisper 模型產生時間戳記字幕。
  - 音訊完全在本機處理，不錄音、不上傳雲端伺服器，嚴格保護隱私。
• 隱私優先、無追蹤：不含廣告、無追蹤分析代碼、不蒐集個人資料。

使用方式：
1. 開啟 YouTube、YouTube Music 或 Spotify Web 播放歌曲或影片。
2. 點擊瀏覽器工具列上的「Lyrics Everywhere」圖示開啟側欄。
3. 側欄即自動顯示同步歌詞與讀音；如需校時可於下方輸入微調秒數。
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
| `https://lrclib.net/*` | 依據當前播放歌曲的曲名與歌手，查詢開源 LRCLIB 資料庫中的同步動態歌詞。<br>*(Queries open-source LRCLIB API for synchronized time-coded lyrics matching current track title and artist.)* |
| `https://www.youtube.com/*`<br>`https://music.youtube.com/*`<br>`https://open.spotify.com/*` | 於支援的播放頁面注入 content script 讀取播放器時間、曲名與播放狀態，以及在使用者切換分頁時進行分頁清單查詢。<br>*(Executes content scripts on supported media pages to detect playback time, track title, and media state for lyrics synchronization.)* |

---

## 4. 資料隱私與使用宣告表單（Data Usage & Privacy）

在 Chrome Web Store 的「隱私權實務」（Privacy practices）分頁填寫：

- **單一用途：** 是（Yes）
- **遠端程式碼（Remote Code）：** 否（No，所有程式碼均隨擴充功能打包；模型權重為資料檔，由本機已打包之 ONNX Runtime WASM 執行）。
- **資料蒐集聲明：**
  - **網站內容（Website Content）：** 本機處理（由 content script 讀取播放進度與曲名，僅於本機記憶體與 LRCLIB 查詢使用，不蒐集或外傳個人身分）。
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
  - 請填入 Cloudflare Pages 部署之首頁網址（例如 `https://<your-project>.pages.dev/`）。

---

## 5. 商店素材規格（Store Assets Checklist）

上架時需由開發者準備之視覺素材：

1. **圖示（已隨套件打包）：**
   - 16×16、32×32、48×48、128×128 PNG（位於 `browser-extension/icons/`）。
2. **螢幕截圖（Screenshots）：**
   - 尺寸：1280×800 或 640×400 PNG。
   - 建議內容：
     1. YouTube 播放時側欄顯示同步歌詞與空耳標註。
     2. 側欄手動校時介面操作。
     3. 側欄手動搜尋 / 貼上 LRCLIB 連結介面。
     4. 本機語音辨識字幕結果。
3. **小型宣傳橫幅（Small Promo Tile，選填但強烈建議）：**
   - 尺寸：440×280 PNG。
