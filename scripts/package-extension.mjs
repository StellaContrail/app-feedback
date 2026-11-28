import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = `${root}apps/extension/dist`;
const files = [
  "background.js",
  "content.js",
  "manifest.json",
  "popup.html",
  "popup.js",
];
const manifest = JSON.parse(await readFile(`${dist}/manifest.json`, "utf8"));
const source = JSON.parse(
  await readFile(`${root}apps/extension/manifest.json`, "utf8"),
);
if (
  manifest.manifest_version !== 3 ||
  !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version) ||
  manifest.version !== source.version ||
  manifest.key !== source.key ||
  JSON.stringify(manifest) !== JSON.stringify(source)
) {
  throw new Error(
    "Release packaging requires the unchanged local MV3 manifest",
  );
}
if (JSON.stringify((await readdir(dist)).sort()) !== JSON.stringify(files)) {
  throw new Error(
    "Unexpected extension build files; rebuild from a clean dist",
  );
}
const tag = process.argv[2];
if (tag !== undefined && tag !== `extension-v${manifest.version}`) {
  throw new Error("Release tag must match the manifest version");
}
const output = `${root}dist/extension-release`;
await mkdir(output, { recursive: true });
const name = `app-feedback-extension-${manifest.version}.zip`;
await rm(`${output}/${name}`, { force: true });
// zip receives an explicit allowlist; no source, configuration, or credentials.
execFileSync("zip", ["-X", "-q", `${output}/${name}`, ...files], { cwd: dist });
const digest = createHash("sha256")
  .update(await readFile(`${output}/${name}`))
  .digest("hex");
await writeFile(`${output}/${name}.sha256`, `${digest}  ${name}\n`);
