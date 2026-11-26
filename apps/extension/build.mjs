import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/background.ts", "src/popup.tsx"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  target: "chrome120",
});
await build({
  entryPoints: ["src/content.ts"],
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
});
for (const file of ["manifest.json", "popup.html"])
  await copyFile(file, `dist/${file}`);
