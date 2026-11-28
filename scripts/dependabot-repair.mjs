import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const allowedFiles = new Set([
  "package.json",
  "apps/api/package.json",
  "apps/extension/package.json",
  "packages/shared/package.json",
  "pnpm-lock.yaml",
]);

export function assertPatchAllowed(numstat, patch) {
  const rows = numstat.trim().split("\n");
  if (
    !numstat.trim() ||
    rows.some((row) => {
      const parts = row.split("\t");
      return (
        parts.length !== 3 ||
        !/^\d+$/.test(parts[0]) ||
        !/^\d+$/.test(parts[1]) ||
        !allowedFiles.has(parts[2])
      );
    }) ||
    /^(?:old mode|new mode|new file mode|deleted file mode|rename from|rename to|copy from|copy to) /m.test(
      patch,
    )
  ) {
    throw new Error(
      "Patch must contain only edits to existing dependency files",
    );
  }
}

const groups = ["dependencies", "devDependencies", "optionalDependencies"];
const validPackage = (name) =>
  /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/.test(name);

export function parentsFor(tree, target) {
  const contains = (name, node) =>
    name === target ||
    groups.some((group) =>
      Object.entries(node[group] ?? {}).some(([child, value]) =>
        contains(child, value),
      ),
    );
  const parents = new Set();
  for (const project of tree) {
    for (const group of groups) {
      for (const [name, node] of Object.entries(project[group] ?? {})) {
        if (contains(name, node)) parents.add(name);
      }
    }
  }
  // These packages share the workerd runtime and must pass validation together.
  if (
    parents.has("wrangler") ||
    parents.has("@cloudflare/vitest-pool-workers")
  ) {
    parents.add("wrangler");
    parents.add("@cloudflare/vitest-pool-workers");
  }
  const workspaceNames = new Set(tree.map((project) => project.name));
  return [...parents]
    .filter((name) => validPackage(name) && !workspaceNames.has(name))
    .sort();
}

export function chooseAlert(alerts, prs, now = Date.now(), alertNumber = "") {
  if (alertNumber && !/^[1-9][0-9]*$/.test(alertNumber))
    throw new Error("Alert number must be a positive integer");
  return alerts.find((alert) => {
    const vulnerability = alert.security_vulnerability;
    return (
      (!alertNumber || String(alert.number) === alertNumber) &&
      alert.state === "open" &&
      vulnerability?.package?.ecosystem === "npm" &&
      validPackage(vulnerability.package.name) &&
      vulnerability.first_patched_version?.identifier &&
      /^GHSA-[a-z0-9-]+$/.test(alert.security_advisory?.ghsa_id ?? "") &&
      Number.isSafeInteger(alert.number) &&
      now - Date.parse(alert.created_at) >= 24 * 60 * 60 * 1000 &&
      !prs.some(
        (pr) =>
          `${pr.title}\n${pr.body}`.includes(alert.security_advisory.ghsa_id) ||
          `${pr.title}\n${pr.body}`.includes(alert.html_url) ||
          pr.head.ref === `security/alert-${alert.number}` ||
          (pr.user?.login === "dependabot[bot]" &&
            `${pr.title}\n${pr.body}`.includes(vulnerability.package.name)),
      )
    );
  });
}

export function assertFixed(report, ghsa) {
  if (
    !report.metadata ||
    !report.advisories ||
    typeof report.advisories !== "object"
  ) {
    throw new Error("Unrecognized audit response; refusing to claim a fix");
  }
  if (
    Object.values(report.advisories).some(
      (item) => item.github_advisory_id === ghsa || item.url?.includes(ghsa),
    )
  ) {
    throw new Error("Target advisory remains in the resolved dependency graph");
  }
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}
function api(path) {
  return JSON.parse(run("gh", ["api", "--paginate", "--slurp", path])).flat();
}

function main(mode, planPath) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? ""))
    throw new Error("Invalid repository");
  if (mode === "discover") {
    const alerts = api(
      `repos/${repo}/dependabot/alerts?state=open&per_page=100`,
    );
    const prs = api(`repos/${repo}/pulls?state=open&base=main&per_page=100`);
    const alert = chooseAlert(
      alerts,
      prs,
      Date.now(),
      process.env.REPAIR_ALERT_NUMBER,
    );
    writeFileSync(planPath, JSON.stringify(alert ?? null));
    appendFileSync(process.env.GITHUB_OUTPUT, `candidate=${Boolean(alert)}\n`);
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      alert
        ? `Attempting Dependabot alert #${alert.number}.\n`
        : "No eligible alert: waiting 24 hours, already covered, unsupported, or no patched release.\n",
    );
  } else if (mode === "repair") {
    const alert = JSON.parse(readFileSync(planPath, "utf8"));
    const tree = JSON.parse(
      run("pnpm", ["list", "-r", "--depth", "Infinity", "--json"]),
    );
    const parents = parentsFor(tree, alert.security_vulnerability.package.name);
    if (!parents.length) throw new Error("No installed parent found");
    for (const latest of [false, true]) {
      run(
        "pnpm",
        [
          "--recursive",
          "--include-workspace-root",
          "update",
          ...(latest ? ["--latest"] : []),
          ...parents,
        ],
        { stdio: "inherit" },
      );
      const audit = spawnSync("pnpm", ["audit", "--json"], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      if (audit.error || ![0, 1].includes(audit.status))
        throw new Error("Audit command failed");
      const report = JSON.parse(audit.stdout);
      try {
        assertFixed(report, alert.security_advisory.ghsa_id);
        return;
      } catch (error) {
        if (latest || !report.metadata || !report.advisories) throw error;
      }
    }
  } else if (mode === "apply") {
    const patch = readFileSync(planPath, "utf8");
    const numstat = run("git", ["apply", "--numstat", planPath]);
    assertPatchAllowed(numstat, patch);
    run("git", ["apply", "--check", planPath]);
    run("git", ["apply", planPath]);
  } else if (mode === "publish") {
    const alert = JSON.parse(readFileSync(planPath, "utf8"));
    const branch = `security/alert-${alert.number}`;
    const changed = run("git", ["diff", "--name-only"])
      .trim()
      .split("\n")
      .filter(Boolean);
    if (!changed.length) throw new Error("No dependency change");
    if (changed.some((path) => !allowedFiles.has(path)))
      throw new Error("Unexpected modified file");
    const current = api(`repos/${repo}/dependabot/alerts/${alert.number}`)[0];
    if (
      !chooseAlert(
        [current],
        api(`repos/${repo}/pulls?state=open&base=main&per_page=100`),
      )
    )
      throw new Error(
        "Alert is no longer eligible or is already covered by a PR",
      );
    if (
      api(`repos/${repo}/pulls?state=open&head=${repo.split("/")[0]}:${branch}`)
        .length
    )
      throw new Error("Repair PR already exists");
    run("git", ["switch", "-c", branch]);
    run("git", ["config", "user.name", "github-actions[bot]"]);
    run("git", [
      "config",
      "user.email",
      "41898282+github-actions[bot]@users.noreply.github.com",
    ]);
    run("git", ["add", "--", ...changed]);
    run("git", [
      "commit",
      "-m",
      `fix(deps): repair ${alert.security_advisory.ghsa_id}`,
    ]);
    run("git", ["push", "origin", `HEAD:refs/heads/${branch}`]);
    const bodyPath = `${planPath}.md`;
    writeFileSync(
      bodyPath,
      `Addresses ${alert.html_url}\n\nAdvisory: ${alert.security_advisory.ghsa_id}. Updated the affected dependency's direct parents; no overrides.\n\nValidated: lint, typecheck, unit/Workers D1 tests, build, CI policy, extension packaging, and browser smoke tests. The target advisory is absent from pnpm audit.\n\nHuman review required, especially for major upgrades and Workers runtime compatibility. This PR is not auto-merged.\n`,
    );
    run(
      "gh",
      [
        "pr",
        "create",
        "--repo",
        repo,
        "--base",
        "main",
        "--head",
        branch,
        "--draft",
        "--title",
        `fix(deps): repair ${alert.security_advisory.ghsa_id}`,
        "--body-file",
        bodyPath,
      ],
      { stdio: "inherit" },
    );
  } else throw new Error("Expected discover, repair, apply, or publish");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv[2], process.argv[3]);
