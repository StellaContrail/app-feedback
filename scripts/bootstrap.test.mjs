import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const bootstrap = resolve("apps/api/scripts/bootstrap.mjs");
test("local bootstrap hashes secrets, creates private files and refuses overwrite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "feedback-bootstrap-"));
  try {
    const output = execFileSync(
      process.execPath,
      [bootstrap, "https://demo.example/app/?query=discard#discard"],
      { cwd: directory, encoding: "utf8" },
    );
    const credentialPath = join(directory, ".local/credentials.json");
    const credentials = JSON.parse(await readFile(credentialPath, "utf8"));
    const sql = await readFile(join(directory, ".local/bootstrap.sql"), "utf8");
    assert.equal(credentials.origin, "https://demo.example");
    assert.equal(credentials.basePath, "/app");
    for (const secret of [credentials.inviteCode, credentials.adminSecret]) {
      assert.match(secret, /^[a-f0-9]{64}$/);
      assert.ok(!sql.includes(secret));
      assert.ok(!output.includes(secret));
      assert.ok(
        sql.includes(createHash("sha256").update(secret).digest("hex")),
      );
    }
    assert.notEqual(credentials.inviteCode, credentials.adminSecret);
    assert.ok(!sql.includes("discard"));
    assert.equal((await stat(credentialPath)).mode & 0o777, 0o600);
    const original = await readFile(credentialPath, "utf8");
    assert.throws(() =>
      execFileSync(process.execPath, [bootstrap, "https://other.example"], {
        cwd: directory,
        stdio: "pipe",
      }),
    );
    assert.equal(await readFile(credentialPath, "utf8"), original);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("bootstrap rejects credentials, unsafe schemes and ambiguous URL paths before writing", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "feedback-bootstrap-invalid-"),
  );
  try {
    for (const url of [
      "file:///tmp",
      "https://user:password@demo.example",
      "https://demo.example/app%2fprivate",
    ])
      assert.throws(() =>
        execFileSync(process.execPath, [bootstrap, url], {
          cwd: directory,
          stdio: "pipe",
        }),
      );
    await assert.rejects(stat(join(directory, ".local")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
