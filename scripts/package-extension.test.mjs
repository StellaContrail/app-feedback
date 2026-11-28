import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("packages only a local build and rejects extra files and production config", async () => {
  const root = await mkdtemp(join(tmpdir(), "extension-package-"));
  try {
    await mkdir(join(root, "scripts"));
    const dist = join(root, "apps/extension/dist");
    await mkdir(dist, { recursive: true });
    await copyFile(
      new URL("./package-extension.mjs", import.meta.url),
      join(root, "scripts/package-extension.mjs"),
    );
    const manifest = await readFile(
      new URL("../apps/extension/manifest.json", import.meta.url),
      "utf8",
    );
    await writeFile(join(root, "apps/extension/manifest.json"), manifest);
    await writeFile(join(dist, "manifest.json"), manifest);
    for (const name of [
      "background.js",
      "content.js",
      "popup.js",
      "popup.html",
    ])
      await writeFile(join(dist, name), "fixture");
    const run = (...args) =>
      execFileSync(
        process.execPath,
        [join(root, "scripts/package-extension.mjs"), ...args],
        { stdio: "pipe" },
      );
    run(`extension-v${JSON.parse(manifest).version}`);
    assert.throws(() => run("extension-v99.0.0"));
    assert.throws(() => run("v0.1.4"));
    const name = `app-feedback-extension-${JSON.parse(manifest).version}.zip`;
    const zip = join(root, "dist/extension-release", name);
    assert.deepEqual(
      execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" })
        .trim()
        .split("\n")
        .sort(),
      [
        "background.js",
        "content.js",
        "manifest.json",
        "popup.html",
        "popup.js",
      ],
    );
    assert.equal(
      await readFile(`${zip}.sha256`, "utf8"),
      `${createHash("sha256")
        .update(await readFile(zip))
        .digest("hex")}  ${name}\n`,
    );
    await writeFile(join(dist, ".env"), "must not ship");
    assert.throws(run);
    await rm(join(dist, ".env"));
    const production = JSON.parse(manifest);
    production.host_permissions = ["https://api.example.com/*"];
    await writeFile(join(dist, "manifest.json"), JSON.stringify(production));
    assert.throws(run);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
