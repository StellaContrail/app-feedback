import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CI policy rejects escalated permissions, tracked private settings and credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "ci-policy-"));
  try {
    await mkdir(join(root, "apps/extension/dist"), { recursive: true });
    await copyFile(
      new URL("./validate-ci.mjs", import.meta.url),
      join(root, "validate-ci.mjs"),
    );
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    const manifest = {
      manifest_version: 3,
      permissions: ["activeTab", "scripting", "storage", "identity"],
      host_permissions: ["http://localhost/*", "http://127.0.0.1/*"],
    };
    const save = (value) =>
      writeFile(
        join(root, "apps/extension/dist/manifest.json"),
        JSON.stringify(value),
      );
    const run = () =>
      execFileSync(process.execPath, ["validate-ci.mjs"], {
        cwd: root,
        stdio: "pipe",
      });
    await save(manifest);
    run();
    for (const change of [
      { permissions: [...manifest.permissions, "cookies"] },
      { host_permissions: ["<all_urls>"] },
      { content_scripts: [] },
      { optional_host_permissions: ["https://*/*"] },
      { manifest_version: 2 },
    ]) {
      await save({ ...manifest, ...change });
      assert.throws(run);
    }
    await save(manifest);
    for (const [name, value] of [
      ["wrangler.private.jsonc", "{}"],
      ["credential.txt", "ghp_" + "a".repeat(36)],
      [
        "wrangler.jsonc",
        JSON.stringify({ database_id: "non-example-resource" }),
      ],
    ]) {
      await writeFile(join(root, name), value);
      execFileSync("git", ["add", name], { cwd: root });
      assert.throws(run);
      execFileSync("git", ["rm", "--cached", "--quiet", name], { cwd: root });
    }
    run();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
