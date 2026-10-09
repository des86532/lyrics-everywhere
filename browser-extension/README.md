# Chrome 安裝（未上架 Chrome Web Store）

此擴充功能只支援 Chrome 中的 YouTube 與 YouTube Music，讀取網頁公開的播放資訊並送到同一台電腦的 `127.0.0.1:3838`。播放資訊不會送到 Cloudflare；擴充功能不使用遠端分析服務，也不做音訊指紋辨識或翻譯。

1. 先啟動 Lyrics Everywhere 桌面程式。
2. 在 Chrome 開啟 `chrome://extensions`，開啟「開發人員模式」。
3. 選擇「載入未封裝項目」，指定解壓縮後的 `browser-extension` 資料夾。
4. 在 Chrome 的 YouTube 或 YouTube Music 播放影片／歌曲。

擴充功能會定期通知本機 Companion 有支援的 YouTube 分頁，以及分頁目前是否有影片或可用的公開媒體資訊。這項狀態通知不含曲名、歌手或播放進度；有效曲目資訊仍只會在頁面提供標題、歌手與影片識別碼時，依既有播放回報格式送往本機。

若畫面顯示沒有來源，請先確認桌面程式正在執行、擴充功能已載入，並開啟支援的 YouTube 分頁。若顯示已暫停，請在播放器繼續播放。缺少公開標題或歌手資訊時不會猜測曲目。macOS Spotify 由桌面程式直接讀取，無須此擴充功能。
