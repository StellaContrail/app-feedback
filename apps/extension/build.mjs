import { build } from "esbuild";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
const raw = process.env.APP_FEEDBACK_API_ORIGIN ?? "http://localhost:8787";
const api = new URL(raw);
if (
  !(
    api.protocol === "https:" ||
    (api.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(api.hostname))
  ) ||
  api.username ||
  api.password ||
  api.pathname !== "/" ||
  api.search ||
  api.hash
)
  throw new Error(
    "APP_FEEDBACK_API_ORIGIN must be an HTTPS origin (HTTP loopback allowed for development)",
  );
await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/background.ts", "src/popup.tsx"],
  outdir: "dist",
  bundle: true,
  format: "esm",
  define: { __API_ORIGIN__: JSON.stringify(api.origin) },
  target: "chrome120",
});
await build({
  entryPoints: ["src/content.ts"],
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
});
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
if (process.env.APP_FEEDBACK_API_ORIGIN) {
  manifest.host_permissions = [`${api.origin}/*`];
  manifest.name = "App Feedback";
}
await writeFile("dist/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
await copyFile("popup.html", "dist/popup.html");
