import fs from "fs";
import path from "path";
import { zipSync } from "fflate";

const sourceDir = path.resolve("browser-extension");
const outDir = path.resolve("release");
const outFile = path.join(outDir, "lyrics-everywhere-extension.zip");

function collectFiles(dir, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectFiles(path.join(dir, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

fs.rmSync(outFile, { force: true });
fs.mkdirSync(outDir, { recursive: true });

const entries = {};
for (const relativePath of collectFiles(sourceDir).sort()) {
  entries[relativePath] = new Uint8Array(fs.readFileSync(path.join(sourceDir, relativePath)));
}

fs.writeFileSync(outFile, zipSync(entries, { mtime: new Date("2000-01-01T00:00:00Z") }));
console.log(`Packaged ${Object.keys(entries).length} files to ${path.relative(process.cwd(), outFile)}`);
