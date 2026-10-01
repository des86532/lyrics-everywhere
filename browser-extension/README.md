# Chrome 安裝（未上架 Chrome Web Store）

此擴充功能只讀取 YouTube／YouTube Music 分頁的公開播放資訊，並傳送到同一台電腦的 `127.0.0.1:3838` Companion。資訊不會送到 Cloudflare。

1. 從 Lyrics Everywhere GitHub Release 下載 `lyrics-everywhere-chrome-extension.zip` 並解壓縮。
2. 在 Chrome 開啟 `chrome://extensions`，開啟「開發人員模式」。
3. 選擇「載入未封裝項目」，指定解壓縮後的 `browser-extension` 資料夾。
4. 啟動 Lyrics Everywhere 桌面程式，再於 YouTube 或 YouTube Music 播放歌曲。

擴充功能只支援 Chrome 中的 YouTube 與 YouTube Music。歌曲資訊需由網頁公開的 Media Session 提供；缺少標題或歌手時不會送出有效歌曲資料。
