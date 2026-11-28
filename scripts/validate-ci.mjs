import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

// Inspect tracked files only: local credentials must never be printed or read.
const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
for (const path of paths) {
  assert(
    !/(^|\/)(wrangler\.private\.jsonc|\.dev\.vars(?:\..*)?|\.env(?:\..*)?|.*\.pem)$/.test(
      path,
    ) || path.endsWith(".example"),
    `Private file tracked: ${path}`,
  );
  const content = await readFile(path, "utf8");
  assert(
    !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{30,}|sk-proj-[A-Za-z0-9_-]{30,})/.test(
      content,
    ),
    `Credential pattern in: ${path}`,
  );
  if (/wrangler.*\.jsonc$/.test(path)) {
    for (const match of content.matchAll(/"database_id"\s*:\s*"([^"]+)"/g)) {
      assert.equal(
        match[1],
        "00000000-0000-0000-0000-000000000000",
        `Non-example database ID: ${path}`,
      );
    }
  }
}
const manifest = JSON.parse(
  await readFile("apps/extension/dist/manifest.json", "utf8"),
);
assert.equal(manifest.manifest_version, 3);
assert.deepEqual(
  [...manifest.permissions].sort(),
  ["activeTab", "identity", "scripting", "storage"].sort(),
);
assert.deepEqual([...manifest.host_permissions].sort(), [
  "http://127.0.0.1/*",
  "http://localhost/*",
]);
for (const key of [
  "content_scripts",
  "optional_permissions",
  "optional_host_permissions",
  "externally_connectable",
])
  assert.equal(manifest[key], undefined, `Unexpected manifest field: ${key}`);
console.log("Tracked-file policy and built manifest validated");
