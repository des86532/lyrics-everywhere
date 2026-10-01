const owner = "des86532";
const repository = "lyrics-everywhere";
const state = document.getElementById("release-state");
const list = document.getElementById("release-assets");

function addAsset(label, asset) {
  const card = document.createElement("article");
  card.className = "asset-card";
  const title = document.createElement("h3");
  title.textContent = label;
  const link = document.createElement("a");
  link.href = asset.browser_download_url;
  link.textContent = "下載檔案";
  link.rel = "noopener";
  const filename = document.createElement("span");
  filename.className = "asset-name";
  filename.textContent = asset.name;
  card.append(title, link, filename);
  list.append(card);
}

async function loadRelease() {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repository}/releases/latest`, { headers: { Accept: "application/vnd.github+json" } });
    if (response.status === 404) {
      state.textContent = "目前尚無已發布版本，安裝檔尚未提供。";
      return;
    }
    if (!response.ok) throw new Error(`GitHub Releases 回應 ${response.status}`);
    const release = await response.json();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const wanted = [
      ["Windows 10／11 · x64 安裝程式", assets.find((asset) => /setup.*\.exe$/i.test(asset.name))],
      ["macOS · Apple silicon 安裝檔", assets.find((asset) => /(?:arm64|aarch64).*\.dmg$/i.test(asset.name))],
      ["macOS · Intel 安裝檔", assets.find((asset) => /(?:x64|x86_64).*\.dmg$/i.test(asset.name))],
      ["Chrome YouTube 擴充功能", assets.find((asset) => /chrome-extension\.zip$/i.test(asset.name))],
      ["SHA-256 校驗清單", assets.find((asset) => asset.name === "SHA256SUMS.txt")],
    ];
    const available = wanted.filter(([, asset]) => asset);
    if (available.length === 0) state.textContent = "最新發行版本尚未提供可下載的安裝檔。";
    else {
      for (const [label, asset] of available) addAsset(label, asset);
      list.hidden = false;
      state.textContent = `最新版本 ${release.tag_name} · ${new Date(release.published_at || release.created_at).toLocaleDateString("zh-TW")}`;
    }
  } catch {
    state.classList.add("error");
    state.textContent = "目前無法讀取 GitHub 最新發行版本；請前往 GitHub Releases 查看可用下載檔。";
    const fallback = document.createElement("a");
    fallback.href = `https://github.com/${owner}/${repository}/releases`;
    fallback.textContent = "前往 GitHub Releases";
    fallback.rel = "noopener";
    state.append(" ", fallback);
  }
}
void loadRelease();
