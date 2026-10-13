import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const require = createRequire(import.meta.url);
const dictionaryDirectory = resolve(dirname(require.resolve("@sglkc/kuromoji")), "../dict");
const dictionaryFiles = [
  "base", "cc", "check", "tid", "tid_map", "tid_pos",
  "unk", "unk_char", "unk_compat", "unk_invoke", "unk_map", "unk_pos",
].map((name) => `${name}.dat.gz`);
const thirdPartyDirectory = fileURLToPath(new URL("../browser-extension/third-party/", import.meta.url));

function kuromojiAssets(): Plugin {
  return {
    name: "kuromoji-local-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = request.url?.split("?")[0]?.replace(/^\/kuromoji-dict\//, "");
        if (!file || !dictionaryFiles.includes(file) || request.url?.split("?")[0] !== `/kuromoji-dict/${file}`) {
          next();
          return;
        }
        try {
          response.setHeader("Content-Type", "application/gzip");
          response.end(readFileSync(resolve(dictionaryDirectory, file)));
        } catch {
          response.statusCode = 404;
          response.end();
        }
      });
    },
    generateBundle() {
      for (const file of dictionaryFiles) {
        this.emitFile({
          type: "asset",
          fileName: `kuromoji-dict/${file}`,
          source: readFileSync(resolve(dictionaryDirectory, file)),
        });
      }
      for (const file of [
        "kuromoji-LICENSE-2.0.txt",
        "kuromoji-NOTICE.md",
        "wanakana-LICENSE",
        "opencc-js-LICENSE",
        "transformers-LICENSE",
        "onnxruntime-web-LICENSE",
        "whisper-NOTICE.md",
      ]) {
        this.emitFile({
          type: "asset",
          fileName: `third-party/${file}`,
          source: readFileSync(resolve(thirdPartyDirectory, file)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [kuromojiAssets()],
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  publicDir: false,
  build: {
    assetsInlineLimit: 0,
    outDir: "../browser-extension/app",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./index.html", import.meta.url)),
    },
  },
});
