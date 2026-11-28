import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  parentsFor,
  chooseAlert,
  assertFixed,
  assertPatchAllowed,
} from "./dependabot-repair.mjs";

test("transitive repairs include all direct parents and coordinate Workers tooling", () => {
  const tree = [
    {
      dependencies: {
        hono: {},
        wrangler: { dependencies: { vulnerable: {} } },
        other: { optionalDependencies: { vulnerable: {} } },
      },
    },
  ];
  assert.deepEqual(parentsFor(tree, "vulnerable"), [
    "@cloudflare/vitest-pool-workers",
    "other",
    "wrangler",
  ]);
  assert.deepEqual(parentsFor(tree, "missing"), []);
});
const alert = {
  number: 2,
  state: "open",
  created_at: "2020-01-01",
  html_url: "https://github.com/example/repo/security/dependabot/2",
  security_advisory: { ghsa_id: "GHSA-aaaa-bbbb-cccc" },
  security_vulnerability: {
    package: { ecosystem: "npm", name: "example" },
    first_patched_version: { identifier: "2.0.0" },
  },
};
test("discovery waits for Dependabot and excludes covered, unpatched and unsupported alerts", () => {
  assert.equal(chooseAlert([alert], []), alert);
  for (const pr of [
    { title: "repair GHSA-aaaa-bbbb-cccc", body: "", head: { ref: "other" } },
    {
      title: "Bump example",
      body: "",
      head: { ref: "other" },
      user: { login: "dependabot[bot]" },
    },
    { title: "", body: "", head: { ref: "security/alert-2" } },
  ])
    assert.equal(chooseAlert([alert], [pr]), undefined);
  assert.equal(
    chooseAlert([alert], [], Date.parse(alert.created_at) + 1000),
    undefined,
  );
  assert.equal(
    chooseAlert(
      [
        {
          ...alert,
          security_vulnerability: {
            ...alert.security_vulnerability,
            first_patched_version: null,
          },
        },
      ],
      [],
    ),
    undefined,
  );
  assert.equal(
    chooseAlert(
      [
        {
          ...alert,
          security_vulnerability: {
            ...alert.security_vulnerability,
            package: { ecosystem: "pip", name: "example" },
          },
        },
      ],
      [],
    ),
    undefined,
  );
});
test("audit must be recognizable and prove the target advisory is absent", () => {
  assert.throws(() => assertFixed({}, "GHSA-test"));
  assert.throws(() =>
    assertFixed(
      { metadata: {}, advisories: { 1: { github_advisory_id: "GHSA-test" } } },
      "GHSA-test",
    ),
  );
  assert.throws(() =>
    assertFixed(
      {
        metadata: {},
        advisories: { 1: { url: "https://github.com/advisories/GHSA-test" } },
      },
      "GHSA-test",
    ),
  );
  assertFixed(
    { metadata: {}, advisories: { 1: { github_advisory_id: "GHSA-other" } } },
    "GHSA-test",
  );
});

test("workspace packages are never upgraded from the registry", () => {
  assert.deepEqual(
    parentsFor(
      [
        {
          name: "app",
          dependencies: { "@app/shared": { dependencies: { vulnerable: {} } } },
        },
        { name: "@app/shared", dependencies: { vulnerable: {} } },
      ],
      "vulnerable",
    ),
    ["vulnerable"],
  );
});

test("publication rejects script edits, renames, binary files and mode changes", () => {
  assertPatchAllowed(
    "2\t1\tpackage.json\n4\t3\tpnpm-lock.yaml\n",
    "diff --git a/package.json b/package.json\n",
  );
  for (const stat of [
    "",
    "1\t1\tscripts/dependabot-repair.mjs",
    "-\t-\tpackage.json",
    "1\t1\tpackage.json\textra",
    "1\t0\t../package.json",
  ]) {
    assert.throws(() => assertPatchAllowed(stat, ""));
  }
  for (const mode of [
    "new mode 120000",
    "deleted file mode 100644",
    "rename from package.json",
  ]) {
    assert.throws(() => assertPatchAllowed("1\t1\tpackage.json", mode));
  }
});

test("manual selection targets only the requested eligible alert", () => {
  const other = { ...alert, number: 3 };
  assert.equal(chooseAlert([alert, other], [], Date.now(), "3"), other);
  assert.equal(chooseAlert([alert], [], Date.now(), "3"), undefined);
  assert.throws(() => chooseAlert([alert], [], Date.now(), "--help"));
});

test("fresh publisher applies dependency patches but refuses bundled script modifications", () => {
  const root = mkdtempSync(join(tmpdir(), "repair-publisher-"));
  const script = fileURLToPath(
    new URL("./dependabot-repair.mjs", import.meta.url),
  );
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" });
  const apply = () =>
    execFileSync(
      process.execPath,
      [script, "apply", join(root, "repair.patch")],
      {
        cwd: root,
        env: { ...process.env, GITHUB_REPOSITORY: "example/repo" },
        stdio: "pipe",
      },
    );
  try {
    git("init", "--quiet");
    writeFileSync(join(root, "package.json"), '{"version":"1"}\n');
    writeFileSync(join(root, "publish.mjs"), "trusted\n");
    git("add", "package.json", "publish.mjs");
    writeFileSync(join(root, "package.json"), '{"version":"2"}\n');
    const safe = git("diff");
    writeFileSync(join(root, "publish.mjs"), "untrusted\n");
    const unsafe = git("diff");
    writeFileSync(join(root, "package.json"), '{"version":"1"}\n');
    writeFileSync(join(root, "publish.mjs"), "trusted\n");
    writeFileSync(join(root, "repair.patch"), unsafe);
    assert.throws(apply);
    assert.equal(
      readFileSync(join(root, "package.json"), "utf8"),
      '{"version":"1"}\n',
    );
    assert.equal(readFileSync(join(root, "publish.mjs"), "utf8"), "trusted\n");
    writeFileSync(join(root, "repair.patch"), safe);
    apply();
    assert.equal(
      readFileSync(join(root, "package.json"), "utf8"),
      '{"version":"2"}\n',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
