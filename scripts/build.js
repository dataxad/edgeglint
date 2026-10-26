// Minify the tracker script. Write `dist/tracker.js`, `src/tracker.built.js` and `src/version.js` (package version and git short SHA).
// Then make sure that the gzip file is not larger than 3072 bytes. With `--size`, do only this check.
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const at = (p) => new URL("../" + p, import.meta.url);
if (!process.argv.includes("--size")) {
  await build({ entryPoints: [at("src/tracker.js").pathname], outfile: at("dist/tracker.js").pathname, bundle: true, format: "iife", minify: true, target: "es2022", logLevel: "warning" });
  writeFileSync(at("src/tracker.built.js"), `export default ${JSON.stringify(readFileSync(at("dist/tracker.js"), "utf8").trim())};\n`);
  let sha = "nogit";
  try {
    sha = execSync("git rev-parse --short HEAD", { cwd: at("").pathname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {}
  const { version } = JSON.parse(readFileSync(at("package.json"), "utf8"));
  writeFileSync(at("src/version.js"), `export default ${JSON.stringify({ version, sha })};\n`);
}
const size = gzipSync(readFileSync(at("dist/tracker.js")), { level: 9 }).length;
console.log(`dist/tracker.js: ${size} bytes gzip -9 (limit 3072)`);
if (size > 3072) process.exit(1);
