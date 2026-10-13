import fs from "fs";
import path from "path";

const iconB64 = fs.readFileSync("browser-extension/icons/128x128.png").toString("base64");
const iconDataUri = `data:image/png;base64,${iconB64}`;

// Common styling for extension sidepanel based on extension-ui/src/style.css
const baseSidepanelCss = `
  --room: #1d1730;
  --room-deep: #16112a;
  --panel: #282042;
  --panel-raised: #322850;
  --line: #3e3460;
  --ink: #f4eee6;
  --ink-soft: #d8cfe6;
  --muted: #a99fc0;
  --faint: #7c7299;
  --coral: #ff7e8f;
  --coral-ink: #2b1020;
  --coral-wash: rgb(255 126 143 / 0.36);
  --mint: #7fd4c1;
  --amber: #f2c46d;
  --error-ink: #ffb8c1;
  --error-wash: #3a1d35;
  --lyric-font: "PingFang TC", "Noto Sans TC", "Apple SD Gothic Neo", "Noto Sans CJK TC", "Hiragino Sans", system-ui, sans-serif;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Segoe UI", sans-serif;
`;

export function generateScreenshot1Html() {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1280px;
    height: 800px;
    background: #0f0f13;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Segoe UI", Roboto, sans-serif;
    color: #f1f1f1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  
  /* Browser Chrome Top */
  .browser-header {
    height: 72px;
    background: #1f1f23;
    border-bottom: 1px solid #2d2d34;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 0 12px 6px;
  }
  .window-controls {
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
    align-items: center;
  }
  .win-dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot-red { background: #ff5f56; }
  .dot-yellow { background: #ffbd2e; }
  .dot-green { background: #27c93f; }
  .browser-tab-bar {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .browser-tab {
    background: #0f0f13;
    border-radius: 8px 8px 0 0;
    padding: 6px 16px;
    font-size: 12px;
    color: #e0e0e0;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 240px;
  }
  .yt-icon {
    width: 16px; height: 16px; background: #f00; border-radius: 4px; display: inline-flex;
    align-items: center; justify-content: center; font-size: 9px; font-weight: 900; color: #fff;
  }
  .browser-nav-bar {
    height: 38px;
    background: #18181c;
    border-bottom: 1px solid #26262b;
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 12px;
  }
  .url-bar {
    flex: 1;
    height: 28px;
    background: #25252b;
    border-radius: 14px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    font-size: 12px;
    color: #9e9ea7;
    gap: 8px;
  }
  .url-bar span.secure { color: #5bc27d; }
  .url-bar span.text { color: #e4e4e9; }
  .nav-actions {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .ext-icon-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    background: #2a223f;
    border: 1px solid #ff7e8f;
    border-radius: 6px;
  }
  .ext-icon-badge img { width: 16px; height: 16px; border-radius: 3px; }
  .ext-icon-badge span { font-size: 11px; color: #ff7e8f; font-weight: 600; }

  /* Main Workspace */
  .browser-body {
    flex: 1;
    display: flex;
    height: calc(800px - 110px);
    overflow: hidden;
  }

  /* Left: YouTube Web Page */
  .yt-container {
    flex: 1;
    background: #0f0f0f;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    overflow: hidden;
  }
  .yt-video-player {
    width: 100%;
    height: 440px;
    background: linear-gradient(135deg, #181226 0%, #2e1d3b 40%, #15102a 100%);
    border-radius: 12px;
    position: relative;
    overflow: hidden;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .yt-video-cover {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at center, rgba(255,126,143,0.18) 0%, rgba(15,15,20,0.85) 75%);
  }
  .yt-video-cover .music-visual {
    font-size: 72px;
    margin-bottom: 12px;
    filter: drop-shadow(0 4px 16px rgba(255,126,143,0.4));
  }
  .yt-video-cover .track-info-overlay {
    text-align: center;
  }
  .yt-video-cover .track-info-overlay h2 {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: #fff;
    margin-bottom: 6px;
  }
  .yt-video-cover .track-info-overlay p {
    font-size: 16px;
    color: #ff9cb0;
    font-weight: 500;
  }
  .yt-progress-container {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 48px;
    background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 12px;
  }
  .yt-time { font-size: 12px; color: #ddd; font-family: monospace; }
  .yt-bar { flex: 1; height: 4px; background: rgba(255,255,255,0.25); border-radius: 2px; position: relative; }
  .yt-bar-fill { position: absolute; left: 0; top: 0; bottom: 0; width: 42%; background: #ff7e8f; border-radius: 2px; }
  .yt-bar-dot { position: absolute; left: 42%; top: -4px; width: 12px; height: 12px; background: #fff; border-radius: 50%; box-shadow: 0 0 6px rgba(0,0,0,0.5); }
  
  .yt-details {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .yt-title { font-size: 19px; font-weight: 700; color: #fff; line-height: 1.3; }
  .yt-channel-row { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
  .yt-channel-avatar { width: 36px; height: 36px; border-radius: 50%; background: #ff7e8f; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #2b1020; }
  .yt-channel-name { font-size: 14px; font-weight: 600; color: #eee; }
  .yt-sub-count { font-size: 12px; color: #aaa; }
  
  /* Feature Banner on Left */
  .feature-pill-banner {
    margin-top: 8px;
    background: linear-gradient(90deg, rgba(40,32,66,0.85) 0%, rgba(29,23,48,0.7) 100%);
    border: 1px solid #3e3460;
    border-radius: 10px;
    padding: 12px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .feature-pill-banner .pill-icon {
    font-size: 24px;
    color: #ff7e8f;
  }
  .feature-pill-banner .pill-text h4 {
    font-size: 14px;
    font-weight: 700;
    color: #f4eee6;
    margin-bottom: 2px;
  }
  .feature-pill-banner .pill-text p {
    font-size: 12px;
    color: #a99fc0;
  }

  /* Right: Lyrics Everywhere Side Panel */
  .sidepanel-container {
    width: 390px;
    height: 100%;
    background: #1d1730;
    border-left: 1px solid #3e3460;
    display: flex;
    flex-direction: column;
    padding: 14px;
    gap: 10px;
    ${baseSidepanelCss}
  }

  /* Masthead */
  .masthead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 32px;
  }
  .wordmark {
    font-size: 18px;
    font-weight: 900;
    letter-spacing: -0.04em;
    color: #f4eee6;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .wordmark span { color: #ff7e8f; }
  .wordmark img { width: 20px; height: 20px; }
  .masthead-actions {
    display: flex;
    gap: 6px;
  }
  .btn-quiet {
    padding: 4px 10px;
    border: 1px solid #3e3460;
    border-radius: 999px;
    background: #322850;
    color: #d8cfe6;
    font-size: 11px;
    font-weight: 650;
  }

  /* Status */
  .status-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #d8cfe6;
  }
  .status-light {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #7fd4c1;
    box-shadow: 0 0 0 3px rgba(127, 212, 193, 0.25);
  }

  /* Stage (Lyrics card) */
  .stage {
    flex: 1;
    background: #282042;
    border: 1px solid #3e3460;
    border-radius: 14px;
    display: flex;
    flex-direction: column;
    padding: 14px 16px;
    overflow: hidden;
  }
  .stage-heading {
    padding-bottom: 10px;
    border-bottom: 1px solid #3e3460;
    margin-bottom: 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .mode-badge {
    align-self: flex-start;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(255, 126, 143, 0.16);
    color: #ff7e8f;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .track-title {
    font-size: 15px;
    font-weight: 700;
    color: #f4eee6;
  }

  /* Synced Lyrics Body */
  .selected-lyrics {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
    justify-content: center;
  }
  .selected-line {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .selected-line.is-past {
    opacity: 0.45;
  }
  .selected-line.is-past .orig { font-size: 12px; color: #a99fc0; }
  .selected-line.is-past .phonetic { font-size: 16px; color: #a99fc0; font-weight: 600; }

  .selected-line.is-active {
    opacity: 1;
    transform: scale(1.02);
    transform-origin: left center;
  }
  .selected-line.is-active .orig {
    font-size: 13px;
    color: #7fd4c1;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .selected-line.is-active .phonetic {
    font-size: 24px;
    font-weight: 850;
    color: #2b1020;
    line-height: 1.35;
    background: #ff7e8f;
    border-radius: 6px;
    padding: 2px 10px;
    display: inline-block;
    align-self: flex-start;
    box-shadow: 0 4px 12px rgba(255, 126, 143, 0.35);
  }

  .selected-line.is-future {
    opacity: 0.6;
  }
  .selected-line.is-future .orig { font-size: 12px; color: #7c7299; }
  .selected-line.is-future .phonetic { font-size: 16px; color: #d8cfe6; font-weight: 600; }

  /* Bottom Controls / Status */
  .bottom-info {
    border-top: 1px solid #3e3460;
    padding-top: 10px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: #a99fc0;
  }
  .source-tag {
    background: #322850;
    padding: 2px 8px;
    border-radius: 4px;
    color: #7fd4c1;
    font-weight: 600;
  }
</style>
</head>
<body>

  <!-- Chrome Header -->
  <header class="browser-header">
    <div class="window-controls">
      <span class="win-dot dot-red"></span>
      <span class="win-dot dot-yellow"></span>
      <span class="win-dot dot-green"></span>
    </div>
    <div class="browser-tab-bar">
      <div class="browser-tab">
        <span class="yt-icon">▶</span>
        <span>YOASOBI「アイドル」 Official Music Video</span>
      </div>
    </div>
  </header>
  
  <div class="browser-nav-bar">
    <div class="url-bar">
      <span class="secure">🔒</span>
      <span class="text">https://www.youtube.com/watch?v=ZRtdQ81jPUQ</span>
    </div>
    <div class="nav-actions">
      <div class="ext-icon-badge">
        <img src="${iconDataUri}" alt="icon" />
        <span>耳邊字幕 (Side Panel)</span>
      </div>
    </div>
  </div>

  <!-- Browser Workspace -->
  <div class="browser-body">
    <!-- Left: YouTube Player -->
    <main class="yt-container">
      <div class="yt-video-player">
        <div class="yt-video-cover">
          <div class="music-visual">✨ 🎤 ✨</div>
          <div class="track-info-overlay">
            <h2>YOASOBI - アイドル (Idol)</h2>
            <p>【推しの子】OP 主題歌 · 播放中</p>
          </div>
        </div>
        <div class="yt-progress-container">
          <span class="yt-time">01:24</span>
          <div class="yt-bar">
            <div class="yt-bar-fill"></div>
            <div class="yt-bar-dot"></div>
          </div>
          <span class="yt-time">03:33</span>
        </div>
      </div>

      <div class="yt-details">
        <h1 class="yt-title">YOASOBI「アイドル」 Official Music Video</h1>
        <div class="yt-channel-row">
          <div class="yt-channel-avatar">Y</div>
          <div>
            <div class="yt-channel-name">Ayase / YOASOBI</div>
            <div class="yt-sub-count">612 萬位訂閱者</div>
          </div>
        </div>
      </div>

      <div class="feature-pill-banner">
        <div class="pill-icon">🎵</div>
        <div class="pill-text">
          <h4>瀏覽器側邊欄隨行同步 · 不遮擋影片畫面</h4>
          <p>支援 YouTube、YouTube Music 與 Spotify Web，自動取得 LRCLIB 動態歌詞與日韓讀音對照</p>
        </div>
      </div>
    </main>

    <!-- Right: Lyrics Everywhere Sidebar -->
    <aside class="sidepanel-container">
      <header class="masthead">
        <div class="wordmark">
          <img src="${iconDataUri}" alt="logo" />
          耳邊<span>字幕</span>
        </div>
        <div class="masthead-actions">
          <button class="btn-quiet">重新偵測</button>
          <button class="btn-quiet">設定</button>
        </div>
      </header>

      <div class="status-row">
        <span class="status-light"></span>
        <p>正在同步 YouTube 播放時間 (01:24)</p>
      </div>

      <section class="stage">
        <div class="stage-heading">
          <span class="mode-badge">動態同步</span>
          <h2 class="track-title">YOASOBI — アイドル</h2>
        </div>

        <div class="selected-lyrics">
          <!-- Past line -->
          <div class="selected-line is-past">
            <p class="orig">抜けてるとこさえ彼女のエリア</p>
            <p class="phonetic">ぬけてるとこさえ かのじょのエリア</p>
          </div>

          <!-- Active singing line with signature highlighter -->
          <div class="selected-line is-active">
            <p class="orig">誰も奪えない その笑顔で</p>
            <p class="phonetic">だれもうばえない そのえがおで</p>
          </div>

          <!-- Future line 1 -->
          <div class="selected-line is-future">
            <p class="orig">誰も彼も虜にしていく</p>
            <p class="phonetic">だれもかれも とりこにしていく</p>
          </div>

          <!-- Future line 2 -->
          <div class="selected-line is-future">
            <p class="orig">その瞳が その言葉が 嘘でも</p>
            <p class="phonetic">そのひとみが そのことばが うそでも</p>
          </div>
        </div>
      </section>

      <footer class="bottom-info">
        <span>來源：<span class="source-tag">LRCLIB (動態時間軸)</span></span>
        <span>讀音：Kuromoji 離線字典</span>
      </footer>
    </aside>
  </div>

</body>
</html>`;
}

export function generateScreenshot2Html() {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1280px;
    height: 800px;
    background: #0f0f13;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Segoe UI", Roboto, sans-serif;
    color: #f1f1f1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  
  .browser-header {
    height: 72px;
    background: #1f1f23;
    border-bottom: 1px solid #2d2d34;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 0 12px 6px;
  }
  .window-controls { display: flex; gap: 8px; margin-bottom: 8px; }
  .win-dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot-red { background: #ff5f56; }
  .dot-yellow { background: #ffbd2e; }
  .dot-green { background: #27c93f; }
  .browser-tab {
    background: #0f0f13; border-radius: 8px 8px 0 0; padding: 6px 16px; font-size: 12px;
    display: flex; align-items: center; gap: 8px; width: 220px;
  }
  .yt-icon { width: 16px; height: 16px; background: #f00; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 900; }
  
  .browser-nav-bar {
    height: 38px; background: #18181c; border-bottom: 1px solid #26262b; display: flex;
    align-items: center; padding: 0 16px; gap: 12px;
  }
  .url-bar { flex: 1; height: 28px; background: #25252b; border-radius: 14px; display: flex; align-items: center; padding: 0 14px; font-size: 12px; color: #9e9ea7; }
  .url-bar span.text { color: #e4e4e9; }
  .ext-icon-badge { display: flex; align-items: center; gap: 6px; padding: 3px 8px; background: #2a223f; border: 1px solid #ff7e8f; border-radius: 6px; }
  .ext-icon-badge img { width: 16px; height: 16px; border-radius: 3px; }
  .ext-icon-badge span { font-size: 11px; color: #ff7e8f; font-weight: 600; }

  .browser-body { flex: 1; display: flex; height: calc(800px - 110px); }

  /* Left Side: YouTube dimmed */
  .yt-container {
    flex: 1; background: #0f0f0f; padding: 20px 24px; display: flex; flex-direction: column; gap: 14px;
    filter: brightness(0.65);
  }
  .yt-video-player {
    width: 100%; height: 440px; background: #1a162b; border-radius: 12px; display: flex; align-items: center; justify-content: center;
  }

  /* Right Side: Side Panel with Settings Modal open */
  .sidepanel-container {
    width: 420px;
    height: 100%;
    background: #1d1730;
    border-left: 1px solid #3e3460;
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 14px;
    ${baseSidepanelCss}
  }

  /* Modal Dialog representation */
  .settings-modal-card {
    background: #282042;
    border: 1px solid #ff7e8f;
    border-radius: 16px;
    box-shadow: 0 16px 40px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,126,143,0.3);
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .settings-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid #3e3460;
    background: #322850;
  }
  .settings-modal-title {
    font-size: 16px;
    font-weight: 750;
    color: #f4eee6;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .settings-modal-close {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 1px solid #3e3460;
    background: transparent;
    color: #a99fc0;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .settings-modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
  }

  /* Setting Card 1: Time Offset */
  .setting-box {
    background: #1d1730;
    border: 1px solid #3e3460;
    border-radius: 12px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .setting-box.highlight {
    border-color: #ff7e8f;
    background: #221b3a;
  }
  .setting-box-title {
    font-size: 14px;
    font-weight: 700;
    color: #ff7e8f;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .fine-print {
    font-size: 12px;
    line-height: 1.45;
    color: #a99fc0;
  }
  .input-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .input-field {
    flex: 1;
    background: #16112a;
    border: 1px solid #7fd4c1;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 14px;
    color: #f4eee6;
    font-family: monospace;
    font-weight: bold;
  }
  .btn-action {
    padding: 8px 14px;
    background: #ff7e8f;
    color: #2b1020;
    font-weight: 700;
    font-size: 12px;
    border: none;
    border-radius: 8px;
  }
  .feedback-badge {
    font-size: 11px;
    color: #7fd4c1;
    display: flex;
    align-items: center;
    gap: 4px;
    font-weight: 600;
  }

  /* Setting Card 2: Display & Phonetics */
  .field-label {
    font-size: 13px;
    font-weight: 650;
    color: #d8cfe6;
    margin-bottom: 4px;
  }
  .select-box {
    width: 100%;
    background: #16112a;
    border: 1px solid #3e3460;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    color: #f4eee6;
  }
  .checkbox-group {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 6px;
  }
  .checkbox-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #d8cfe6;
  }
  .checkbox-item input {
    accent-color: #ff7e8f;
    width: 15px;
    height: 15px;
  }

  /* Left Callout Badge */
  .feature-callout-overlay {
    position: absolute;
    left: 40px;
    bottom: 50px;
    background: rgba(30, 24, 50, 0.95);
    border: 1px solid #ff7e8f;
    box-shadow: 0 12px 32px rgba(0,0,0,0.7);
    border-radius: 12px;
    padding: 16px 20px;
    max-width: 480px;
    display: flex;
    gap: 16px;
    align-items: center;
  }
  .feature-callout-overlay .icon { font-size: 32px; }
  .feature-callout-overlay h3 { font-size: 16px; font-weight: 700; color: #fff; margin-bottom: 4px; }
  .feature-callout-overlay p { font-size: 13px; color: #d8cfe6; line-height: 1.4; }
</style>
</head>
<body>

  <header class="browser-header">
    <div class="window-controls">
      <span class="win-dot dot-red"></span>
      <span class="win-dot dot-yellow"></span>
      <span class="win-dot dot-green"></span>
    </div>
    <div class="browser-tab">
      <span class="yt-icon">▶</span>
      <span>Official MV - 播放中</span>
    </div>
  </header>
  
  <div class="browser-nav-bar">
    <div class="url-bar"><span class="text">https://www.youtube.com/watch?v=...</span></div>
    <div class="ext-icon-badge">
      <img src="${iconDataUri}" alt="icon" />
      <span>耳邊字幕 (設定面板)</span>
    </div>
  </div>

  <div class="browser-body">
    <!-- Dimmed background -->
    <main class="yt-container">
      <div class="yt-video-player"></div>
    </main>

    <!-- Callout on left -->
    <div class="feature-callout-overlay">
      <div class="icon">⏱️</div>
      <div>
        <h3>歌詞時間精準微調 · 專屬記憶</h3>
        <p>解決 MV 前奏空白或開頭劇情時間差，輸入秒數立即套用偏移；支援中文空耳近音字或羅馬拼音自訂切換。</p>
      </div>
    </div>

    <!-- Right Side Panel Settings -->
    <aside class="sidepanel-container">
      <div class="settings-modal-card">
        <header class="settings-modal-header">
          <div class="settings-modal-title">
            <span>⚙️</span> 設定與工具
          </div>
          <button class="settings-modal-close">✕</button>
        </header>

        <div class="settings-modal-body">
          <!-- Timing Offset Setting -->
          <div class="setting-box highlight">
            <div class="setting-box-title">
              <span>⏱️</span> 校正歌詞時間
            </div>
            <p class="fine-print">輸入要加到所有歌詞時間上的偏移秒數（例如 2.5 或 -1.2），負值讓歌詞提前。系統將自動記住本支影片專屬設定。</p>
            <div class="input-row">
              <input class="input-field" type="text" value="+2.4" />
              <button class="btn-action">套用偏移</button>
            </div>
            <div class="feedback-badge">
              <span>✓</span> 已儲存此影片校正時間 (+2.4 秒)
            </div>
          </div>

          <!-- Preferences Setting -->
          <div class="setting-box">
            <div class="setting-box-title" style="color: #7fd4c1;">
              <span>🔤</span> 顯示與讀音設定
            </div>
            
            <div>
              <div class="field-label">空耳顯示方式</div>
              <select class="select-box">
                <option selected>中文近音字（空耳跟唱）</option>
                <option>羅馬拼音（Romaji / Latin）</option>
              </select>
            </div>

            <div style="margin-top: 8px;">
              <div class="field-label">保留原文語言</div>
              <div class="checkbox-group">
                <label class="checkbox-item"><input type="checkbox" checked /> 中文</label>
                <label class="checkbox-item"><input type="checkbox" checked /> 英文</label>
                <label class="checkbox-item"><input type="checkbox" checked /> 日文</label>
                <label class="checkbox-item"><input type="checkbox" checked /> 韓文</label>
              </div>
            </div>

            <div style="margin-top: 10px;">
              <label class="checkbox-item"><input type="checkbox" checked /> 同時顯示辨識原文與發音標註</label>
            </div>
          </div>
        </div>
      </div>
    </aside>
  </div>

</body>
</html>`;
}

export function generateScreenshot3Html() {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1280px;
    height: 800px;
    background: #0f0f13;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Segoe UI", Roboto, sans-serif;
    color: #f1f1f1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  
  .browser-header {
    height: 72px;
    background: #1f1f23;
    border-bottom: 1px solid #2d2d34;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 0 12px 6px;
  }
  .window-controls { display: flex; gap: 8px; margin-bottom: 8px; }
  .win-dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot-red { background: #ff5f56; }
  .dot-yellow { background: #ffbd2e; }
  .dot-green { background: #27c93f; }
  .browser-tab {
    background: #0f0f13; border-radius: 8px 8px 0 0; padding: 6px 16px; font-size: 12px;
    display: flex; align-items: center; gap: 8px; width: 240px;
  }
  .yt-icon { width: 16px; height: 16px; background: #1db954; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; }
  
  .browser-nav-bar {
    height: 38px; background: #18181c; border-bottom: 1px solid #26262b; display: flex;
    align-items: center; padding: 0 16px; gap: 12px;
  }
  .url-bar { flex: 1; height: 28px; background: #25252b; border-radius: 14px; display: flex; align-items: center; padding: 0 14px; font-size: 12px; color: #9e9ea7; }
  .url-bar span.text { color: #e4e4e9; }
  .ext-icon-badge { display: flex; align-items: center; gap: 6px; padding: 3px 8px; background: #2a223f; border: 1px solid #ff7e8f; border-radius: 6px; }
  .ext-icon-badge img { width: 16px; height: 16px; border-radius: 3px; }
  .ext-icon-badge span { font-size: 11px; color: #ff7e8f; font-weight: 600; }

  .browser-body { flex: 1; display: flex; height: calc(800px - 110px); }

  /* Left Side: Spotify Web Player Mockup */
  .yt-container {
    flex: 1; background: #121212; padding: 24px; display: flex; flex-direction: column; gap: 16px;
  }
  .spotify-hero {
    height: 320px;
    background: linear-gradient(180deg, #382458 0%, #181224 100%);
    border-radius: 12px;
    padding: 32px;
    display: flex;
    align-items: flex-end;
    gap: 24px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }
  .album-art {
    width: 180px; height: 180px; background: #282042; border-radius: 8px;
    display: flex; align-items: center; justify-content: center; font-size: 54px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.6);
  }
  .track-meta h1 { font-size: 38px; font-weight: 850; letter-spacing: -0.03em; margin-bottom: 8px; }
  .track-meta p { font-size: 15px; color: #b3b3b3; }

  .feature-pill-banner {
    background: #181818; border: 1px solid #282828; border-radius: 10px; padding: 14px 20px;
    display: flex; align-items: center; gap: 16px;
  }
  .feature-pill-banner .icon { font-size: 26px; color: #1db954; }
  .feature-pill-banner h4 { font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 2px; }
  .feature-pill-banner p { font-size: 13px; color: #a0a0a0; }

  /* Right Side: Manual Lyrics Selection */
  .sidepanel-container {
    width: 420px; height: 100%; background: #1d1730; border-left: 1px solid #3e3460;
    display: flex; flex-direction: column; padding: 14px; gap: 10px;
    ${baseSidepanelCss}
  }

  .panel-card {
    background: #282042; border: 1px solid #3e3460; border-radius: 14px;
    display: flex; flex-direction: column; height: 100%; padding: 14px; gap: 12px;
  }
  .panel-card-title {
    font-size: 15px; font-weight: 750; color: #f4eee6; display: flex; align-items: center; justify-content: space-between;
  }
  .search-box {
    display: flex; gap: 8px;
  }
  .search-input {
    flex: 1; background: #16112a; border: 1px solid #3e3460; border-radius: 8px;
    padding: 8px 12px; font-size: 13px; color: #f4eee6;
  }
  .search-btn {
    padding: 8px 14px; background: #ff7e8f; color: #2b1020; font-weight: 700; font-size: 12px;
    border: none; border-radius: 8px; cursor: pointer;
  }

  .lyrics-list {
    flex: 1; display: flex; flex-direction: column; gap: 8px; overflow-y: auto;
  }
  .lyrics-item {
    background: #1d1730; border: 1px solid #3e3460; border-radius: 10px; padding: 12px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .lyrics-item.active {
    border-color: #ff7e8f; background: #322850; box-shadow: 0 2px 8px rgba(255,126,143,0.2);
  }
  .lyrics-item-header {
    display: flex; justify-content: space-between; align-items: center;
  }
  .item-title { font-size: 13px; font-weight: 700; color: #f4eee6; }
  .item-badge {
    font-size: 10px; padding: 2px 6px; border-radius: 4px; background: rgba(127,212,193,0.18);
    color: #7fd4c1; font-weight: 600;
  }
  .item-artist { font-size: 12px; color: #a99fc0; }
  .item-snippet { font-size: 11px; color: #7c7299; font-style: italic; margin-top: 2px; }
</style>
</head>
<body>

  <header class="browser-header">
    <div class="window-controls">
      <span class="win-dot dot-red"></span>
      <span class="win-dot dot-yellow"></span>
      <span class="win-dot dot-green"></span>
    </div>
    <div class="browser-tab">
      <span class="yt-icon">🟢</span>
      <span>Spotify Web Player</span>
    </div>
  </header>
  
  <div class="browser-nav-bar">
    <div class="url-bar"><span class="text">https://open.spotify.com/track/456...</span></div>
    <div class="ext-icon-badge">
      <img src="${iconDataUri}" alt="icon" />
      <span>耳邊字幕 (手動選取)</span>
    </div>
  </div>

  <div class="browser-body">
    <!-- Left: Spotify Player -->
    <main class="yt-container">
      <div class="spotify-hero">
        <div class="album-art">🎧</div>
        <div class="track-meta">
          <h1>Ditto</h1>
          <p>NewJeans · 250, Ylva Dimberg · 03:05</p>
        </div>
      </div>

      <div class="feature-pill-banner">
        <div class="icon">🔍</div>
        <div>
          <h4>開放歌詞庫 LRCLIB 完整搜尋</h4>
          <p>自動比對未命中或翻唱版本？直接搜尋曲名或貼上 LRCLIB ID，立即切換動態歌詞</p>
        </div>
      </div>
    </main>

    <!-- Right: Manual Lyrics Panel -->
    <aside class="sidepanel-container">
      <div class="panel-card">
        <div class="panel-card-title">
          <span>手動指定歌詞</span>
          <span style="font-size: 11px; color: #7fd4c1;">模式：手動指定</span>
        </div>

        <div class="search-box">
          <input class="search-input" type="text" value="NewJeans Ditto" />
          <button class="search-btn">搜尋</button>
        </div>

        <div class="lyrics-list">
          <!-- Item 1: Active -->
          <div class="lyrics-item active">
            <div class="lyrics-item-header">
              <span class="item-title">Ditto (Synced)</span>
              <span class="item-badge">● 當前使用中</span>
            </div>
            <div class="item-artist">NewJeans · 片長 03:05</div>
            <div class="item-snippet">"Stay in the middle, Like you a little..."</div>
          </div>

          <!-- Item 2 -->
          <div class="lyrics-item">
            <div class="lyrics-item-header">
              <span class="item-title">Ditto (Acoustic Cover)</span>
              <span class="item-badge" style="color: #a99fc0; background: #3e3460;">純文字</span>
            </div>
            <div class="item-artist">Various Artists · 片長 03:12</div>
            <div class="item-snippet">"Hul hul hul naradanyeo..."</div>
          </div>

          <!-- Item 3 -->
          <div class="lyrics-item">
            <div class="lyrics-item-header">
              <span class="item-title">Ditto - 250 Remix</span>
              <span class="item-badge" style="color: #7fd4c1;">同步時間軸</span>
            </div>
            <div class="item-artist">NewJeans · 片長 03:20</div>
            <div class="item-snippet">"Do you want somebody like I want somebody..."</div>
          </div>
        </div>
      </div>
    </aside>
  </div>

</body>
</html>`;
}

export function generateScreenshot4Html() {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1280px;
    height: 800px;
    background: #0f0f13;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Segoe UI", Roboto, sans-serif;
    color: #f1f1f1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  
  .browser-header {
    height: 72px;
    background: #1f1f23;
    border-bottom: 1px solid #2d2d34;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 0 12px 6px;
  }
  .window-controls { display: flex; gap: 8px; margin-bottom: 8px; }
  .win-dot { width: 12px; height: 12px; border-radius: 50%; }
  .dot-red { background: #ff5f56; }
  .dot-yellow { background: #ffbd2e; }
  .dot-green { background: #27c93f; }
  .browser-tab {
    background: #0f0f13; border-radius: 8px 8px 0 0; padding: 6px 16px; font-size: 12px;
    display: flex; align-items: center; gap: 8px; width: 260px;
  }
  .yt-icon { width: 16px; height: 16px; background: #f00; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 900; }
  
  .browser-nav-bar {
    height: 38px; background: #18181c; border-bottom: 1px solid #26262b; display: flex;
    align-items: center; padding: 0 16px; gap: 12px;
  }
  .url-bar { flex: 1; height: 28px; background: #25252b; border-radius: 14px; display: flex; align-items: center; padding: 0 14px; font-size: 12px; color: #9e9ea7; }
  .url-bar span.text { color: #e4e4e9; }
  .ext-icon-badge { display: flex; align-items: center; gap: 6px; padding: 3px 8px; background: #2a223f; border: 1px solid #7fd4c1; border-radius: 6px; }
  .ext-icon-badge img { width: 16px; height: 16px; border-radius: 3px; }
  .ext-icon-badge span { font-size: 11px; color: #7fd4c1; font-weight: 600; }

  .browser-body { flex: 1; display: flex; height: calc(800px - 110px); }

  /* Left Side: YouTube Live / Cover video */
  .yt-container {
    flex: 1; background: #0f0f0f; padding: 20px 24px; display: flex; flex-direction: column; gap: 14px;
  }
  .yt-video-player {
    width: 100%; height: 440px; background: linear-gradient(135deg, #1b1a20 0%, #29243a 50%, #151322 100%);
    border-radius: 12px; position: relative; display: flex; align-items: center; justify-content: center;
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  }
  .live-badge {
    position: absolute; top: 16px; left: 16px; background: #e02424; color: #fff;
    padding: 3px 10px; border-radius: 4px; font-size: 11px; font-weight: 800; letter-spacing: 0.05em;
  }
  .center-visual { text-align: center; }
  .center-visual .icon { font-size: 64px; margin-bottom: 12px; }
  .center-visual h2 { font-size: 26px; font-weight: 800; color: #fff; }
  .center-visual p { font-size: 14px; color: #9e9ea7; margin-top: 4px; }

  .feature-pill-banner {
    background: linear-gradient(90deg, #1f272a 0%, #182025 100%);
    border: 1px solid #2d4546; border-radius: 10px; padding: 12px 18px;
    display: flex; align-items: center; gap: 14px;
  }
  .feature-pill-banner .icon { font-size: 24px; color: #7fd4c1; }
  .feature-pill-banner h4 { font-size: 14px; font-weight: 700; color: #e6f7f4; margin-bottom: 2px; }
  .feature-pill-banner p { font-size: 12px; color: #8cb8b0; }

  /* Right: WebGPU Speech to Text Side Panel */
  .sidepanel-container {
    width: 400px; height: 100%; background: #1d1730; border-left: 1px solid #3e3460;
    display: flex; flex-direction: column; padding: 14px; gap: 10px;
    ${baseSidepanelCss}
  }

  .stage {
    flex: 1; background: #282042; border: 1px solid #3e3460; border-radius: 14px;
    display: flex; flex-direction: column; padding: 14px 16px; overflow: hidden;
  }
  .stage-heading {
    padding-bottom: 10px; border-bottom: 1px solid #3e3460; margin-bottom: 12px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .mode-badge-ai {
    align-self: flex-start; padding: 2px 8px; border-radius: 999px;
    background: rgba(127,212,193,0.18); color: #7fd4c1; font-size: 10px; font-weight: 700;
  }
  
  .transcript-lines {
    flex: 1; display: flex; flex-direction: column; gap: 14px; justify-content: center;
  }
  .ts-line {
    display: flex; flex-direction: column; gap: 2px;
  }
  .ts-time { font-size: 11px; font-family: monospace; color: #7fd4c1; }
  .ts-text { font-size: 15px; color: #d8cfe6; line-height: 1.4; }
  .ts-line.current {
    background: rgba(127,212,193,0.12); border-left: 3px solid #7fd4c1; padding-left: 10px;
    border-radius: 0 8px 8px 0;
  }
  .ts-line.current .ts-text { color: #f4eee6; font-size: 18px; font-weight: 750; }

  .ai-footer-card {
    background: #181427; border: 1px solid #3e3460; border-radius: 10px; padding: 10px 12px;
    display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: #a99fc0;
  }
  .ai-footer-row { display: flex; justify-content: space-between; align-items: center; }
  .status-pill { color: #7fd4c1; font-weight: 700; }
</style>
</head>
<body>

  <header class="browser-header">
    <div class="window-controls">
      <span class="win-dot dot-red"></span>
      <span class="win-dot dot-yellow"></span>
      <span class="win-dot dot-green"></span>
    </div>
    <div class="browser-tab">
      <span class="yt-icon">▶</span>
      <span>Acoustic Live Session (無官方歌詞)</span>
    </div>
  </header>
  
  <div class="browser-nav-bar">
    <div class="url-bar"><span class="text">https://www.youtube.com/watch?v=live-cover...</span></div>
    <div class="ext-icon-badge">
      <img src="${iconDataUri}" alt="icon" />
      <span>WebGPU 本機辨識中</span>
    </div>
  </div>

  <div class="browser-body">
    <!-- Left: YouTube Player -->
    <main class="yt-container">
      <div class="yt-video-player">
        <span class="live-badge">ACOUSTIC LIVE</span>
        <div class="center-visual">
          <div class="icon">🎸</div>
          <h2>現場吉他翻唱 Live · 無現成歌詞</h2>
          <p>YouTube 分頁音訊即時擷取中</p>
        </div>
      </div>

      <div class="feature-pill-banner">
        <div class="icon">🔒</div>
        <div>
          <h4>本機 WebGPU 語音辨識（Whisper）· 嚴格隱私保護</h4>
          <p>音訊完全在使用者電腦透過 GPU 本機運算，不錄音、不上傳任何遠端伺服器</p>
        </div>
      </div>
    </main>

    <!-- Right: AI Transcription Side Panel -->
    <aside class="sidepanel-container">
      <header class="masthead" style="display:flex; justify-content:space-between; align-items:center;">
        <div style="font-size:17px; font-weight:900; color:#f4eee6; display:flex; align-items:center; gap:6px;">
          <img src="${iconDataUri}" style="width:20px;height:20px;" alt="logo" />
          耳邊<span>字幕</span>
        </div>
        <button style="padding:4px 12px; border:1px solid #5a3550; border-radius:999px; background:transparent; color:#ffb8c1; font-size:11px; font-weight:700;">停止辨識</button>
      </header>

      <section class="stage">
        <div class="stage-heading">
          <span class="mode-badge-ai">本機 AI 即時字幕</span>
          <h2 style="font-size:15px; font-weight:700; color:#f4eee6;">現場音訊即時辨識</h2>
        </div>

        <div class="transcript-lines">
          <div class="ts-line">
            <span class="ts-time">[00:42]</span>
            <p class="ts-text">Cause you are the only one for me tonight</p>
          </div>
          <div class="ts-line current">
            <span class="ts-time">[00:48] ▶ 正在收音</span>
            <p class="ts-text">And all the stars are shining in the sky</p>
          </div>
          <div class="ts-line">
            <span class="ts-time">[00:54] 預測</span>
            <p class="ts-text" style="color:#7c7299;">I feel your warmth beside me...</p>
          </div>
        </div>
      </section>

      <div class="ai-footer-card">
        <div class="ai-footer-row">
          <span>模型架構：</span>
          <span class="status-pill">Whisper ONNX (WebGPU 加速)</span>
        </div>
        <div class="ai-footer-row">
          <span>隱私等級：</span>
          <span style="color:#7fd4c1;">100% 離線本機處理</span>
        </div>
      </div>
    </aside>
  </div>

</body>
</html>`;
}

export function generateSmallPromoTileHtml() {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 440px;
    height: 280px;
    background: radial-gradient(circle at 85% 15%, #3a2254 0%, #1d1730 45%, #130f22 100%);
    font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Segoe UI", sans-serif;
    color: #f4eee6;
    overflow: hidden;
    position: relative;
    padding: 24px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  /* Decorative Glow */
  .glow-ring {
    position: absolute;
    right: -30px;
    top: -30px;
    width: 180px;
    height: 180px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255,126,143,0.25) 0%, transparent 70%);
    pointer-events: none;
  }

  .header-brand {
    display: flex;
    align-items: center;
    gap: 14px;
    z-index: 1;
  }
  .app-icon {
    width: 56px;
    height: 56px;
    border-radius: 14px;
    box-shadow: 0 8px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,126,143,0.3);
  }
  .brand-text h1 {
    font-size: 20px;
    font-weight: 900;
    letter-spacing: -0.03em;
    color: #f4eee6;
    line-height: 1.2;
  }
  .brand-text h1 span { color: #ff7e8f; }
  .brand-text p {
    font-size: 12px;
    color: #ff9cb0;
    font-weight: 600;
    margin-top: 2px;
  }

  /* Center Lyric Card Mock */
  .mini-lyric-card {
    background: rgba(40, 32, 66, 0.85);
    backdrop-filter: blur(8px);
    border: 1px solid #3e3460;
    border-radius: 12px;
    padding: 10px 14px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    display: flex;
    flex-direction: column;
    gap: 4px;
    z-index: 1;
  }
  .mini-lyric-orig {
    font-size: 11px;
    color: #a99fc0;
  }
  .mini-lyric-active {
    font-size: 15px;
    font-weight: 850;
    color: #2b1020;
    background: #ff7e8f;
    border-radius: 4px;
    padding: 1px 8px;
    display: inline-block;
    align-self: flex-start;
  }

  /* Feature Badges Footer */
  .feature-tags {
    display: flex;
    gap: 6px;
    z-index: 1;
  }
  .tag {
    font-size: 10px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 999px;
    background: #322850;
    color: #d8cfe6;
    border: 1px solid #3e3460;
  }
  .tag.highlight {
    background: rgba(127,212,193,0.18);
    color: #7fd4c1;
    border-color: rgba(127,212,193,0.3);
  }
</style>
</head>
<body>
  <div class="glow-ring"></div>

  <div class="header-brand">
    <img class="app-icon" src="${iconDataUri}" alt="icon" />
    <div class="brand-text">
      <h1>Lyrics Everywhere <span>耳邊字幕</span></h1>
      <p>側欄同步動態歌詞 · 空耳跟唱 · 本機 AI 字幕</p>
    </div>
  </div>

  <div class="mini-lyric-card">
    <div class="mini-lyric-orig">誰も奪えない その笑顔で</div>
    <div class="mini-lyric-active">だれもうばえない そのえがおで</div>
  </div>

  <div class="feature-tags">
    <span class="tag">YouTube & Spotify 支援</span>
    <span class="tag">日韓讀音字典</span>
    <span class="tag highlight">WebGPU 離線辨識</span>
  </div>
</body>
</html>`;
}


export function generateMarqueePromoTileHtml() {
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 1400px;
    height: 560px;
    background: radial-gradient(circle at 75% 30%, #341f4d 0%, #1d1730 50%, #110d1e 100%);
    font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Noto Sans TC", "Segoe UI", sans-serif;
    color: #f4eee6;
    overflow: hidden;
    display: flex;
    padding: 60px 80px;
    align-items: center;
    justify-content: space-between;
    position: relative;
  }
  .bg-glow {
    position: absolute; right: 10%; top: -20%; width: 500px; height: 500px;
    border-radius: 50%; background: radial-gradient(circle, rgba(255,126,143,0.2) 0%, transparent 70%);
    pointer-events: none;
  }
  .left-content {
    max-width: 620px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    z-index: 2;
  }
  .brand-row {
    display: flex;
    align-items: center;
    gap: 18px;
  }
  .app-icon {
    width: 72px;
    height: 72px;
    border-radius: 18px;
    box-shadow: 0 12px 28px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,126,143,0.3);
  }
  .title-group h1 {
    font-size: 38px;
    font-weight: 900;
    letter-spacing: -0.03em;
    line-height: 1.15;
  }
  .title-group h1 span { color: #ff7e8f; }
  .subtitle {
    font-size: 20px;
    color: #ff9cb0;
    font-weight: 600;
  }
  .desc {
    font-size: 16px;
    color: #d8cfe6;
    line-height: 1.6;
  }
  .badge-row {
    display: flex;
    gap: 10px;
    margin-top: 6px;
  }
  .badge {
    background: #322850;
    border: 1px solid #3e3460;
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 700;
    color: #f4eee6;
  }
  .badge.mint {
    background: rgba(127,212,193,0.18);
    color: #7fd4c1;
    border-color: rgba(127,212,193,0.35);
  }

  .right-preview {
    width: 480px;
    background: #282042;
    border: 1px solid #3e3460;
    border-radius: 18px;
    padding: 24px;
    box-shadow: 0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,126,143,0.25);
    display: flex;
    flex-direction: column;
    gap: 16px;
    z-index: 2;
  }
  .card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid #3e3460;
    padding-bottom: 12px;
  }
  .card-top .track { font-size: 16px; font-weight: 750; color: #f4eee6; }
  .card-top .badge-sync { font-size: 11px; background: rgba(255,126,143,0.18); color: #ff7e8f; padding: 2px 8px; border-radius: 999px; font-weight: 700; }
  .preview-lyrics {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .preview-line-past { font-size: 13px; color: #7c7299; }
  .preview-line-active-orig { font-size: 13px; color: #7fd4c1; font-weight: 600; }
  .preview-line-active {
    font-size: 22px;
    font-weight: 850;
    color: #2b1020;
    background: #ff7e8f;
    padding: 2px 10px;
    border-radius: 6px;
    display: inline-block;
    align-self: flex-start;
  }
  .preview-line-future { font-size: 14px; color: #d8cfe6; font-weight: 600; }
</style>
</head>
<body>
  <div class="bg-glow"></div>

  <div class="left-content">
    <div class="brand-row">
      <img class="app-icon" src="${iconDataUri}" alt="icon" />
      <div class="title-group">
        <h1>Lyrics Everywhere <span>耳邊字幕</span></h1>
        <div class="subtitle">瀏覽器側邊欄同步歌詞 · 空耳跟唱</div>
      </div>
    </div>
    <p class="desc">
      支援 YouTube、YouTube Music 與 Spotify Web！自動匹配 LRCLIB 開放歌詞庫，日韓歌詞離線自動轉寫平假名、羅馬拼音與中文空耳。現場收音與翻唱更支援本機 WebGPU 離線語音辨識字幕。
    </p>
    <div class="badge-row">
      <span class="badge">YouTube & Spotify</span>
      <span class="badge">Kuromoji 讀音字典</span>
      <span class="badge">時間軸微調校時</span>
      <span class="badge mint">WebGPU 離線 AI</span>
    </div>
  </div>

  <div class="right-preview">
    <div class="card-top">
      <span class="track">YOASOBI — アイドル</span>
      <span class="badge-sync">動態時間軸同步</span>
    </div>
    <div class="preview-lyrics">
      <div class="preview-line-past">抜けてるとこさえ彼女のエリア</div>
      <div>
        <div class="preview-line-active-orig">誰も奪えない その笑顔で</div>
        <div class="preview-line-active">だれもうばえない そのえがおで</div>
      </div>
      <div class="preview-line-future">誰も彼も虜にしていく</div>
    </div>
  </div>
</body>
</html>`;
}
