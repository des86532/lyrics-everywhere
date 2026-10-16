import fs from "fs";
import path from "path";

const iconB64 = fs.readFileSync("browser-extension/icons/128x128.png").toString("base64");
const iconDataUri = `data:image/png;base64,${iconB64}`;

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
