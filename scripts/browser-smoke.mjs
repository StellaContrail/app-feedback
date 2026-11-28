// Local-only acceptance smoke: two independent Chrome profiles + real Worker/D1.
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";

const permissionsMode = process.argv.includes("--permissions");
const fixtureTitle = `App Feedback permission test ${randomBytes(8).toString("hex")}`;
const temporary = await mkdtemp(join(tmpdir(), "app-feedback-smoke-"));
const apiDirectory = resolve("apps/api");
let extensionDirectory = resolve("apps/extension/dist");
if (permissionsMode) {
  extensionDirectory = join(temporary, "extension");
  await cp(resolve("apps/extension/dist"), extensionDirectory, {
    recursive: true,
  });
  const manifestPath = join(extensionDirectory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // Add only a shortcut to a temporary copy, never any host permission.
  manifest.commands = {
    _execute_action: { suggested_key: { default: "Ctrl+Shift+Y" } },
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
}
const contexts = [];
let workerProcess, displayProcess, permissionDisplay;
const environment = { ...process.env, WRANGLER_SEND_METRICS: "false" };
const fixture = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    `<!doctype html><html><head><title>${fixtureTitle}</title></head><body><h1>Review app</h1><a href="/app/other">Other route</a><a href="/outside">Another page</a><form action="/submitted"><button type="submit">Save</button><input type="password" value="never-store-this"></form><script>window.submissions=0;document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submissions++});</script></body></html>`,
  );
});
async function waitUntil(check, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timeout: ${label}`);
}
function wrangler(args) {
  return execFileSync("pnpm", ["exec", "wrangler", ...args], {
    cwd: apiDirectory,
    env: environment,
    encoding: "utf8",
  });
}
async function openProfile(name) {
  const context = await chromium.launchPersistentContext(
    join(temporary, name),
    {
      executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome",
      headless: !permissionsMode,
      env: permissionsMode
        ? { ...process.env, DISPLAY: permissionDisplay }
        : process.env,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [
        "--no-sandbox",
        "--enable-unsafe-extension-debugging",
        ...(permissionsMode
          ? [
              "--ozone-platform=x11",
              "--no-proxy-server",
              "--host-resolver-rules=MAP review.test 127.0.0.1, MAP other.test 127.0.0.1",
            ]
          : []),
      ],
    },
  );
  contexts.push(context);
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send("Extensions.loadUnpacked", {
    path: extensionDirectory,
  });
  if (!context.serviceWorkers().length)
    await context.waitForEvent("serviceworker");
  const worker = context.serviceWorkers()[0];
  const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
  const browserPid = processInfo.find((p) => p.type === "browser")?.id;
  return { context, id, worker, browserPid };
}
// Closed Shadow DOM stays closed to the page. DevTools inspects it for this test.
async function shadow(page, expression) {
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send("DOM.getDocument", {
      depth: -1,
      pierce: true,
    });
    function find(node) {
      if (node.nodeName === "APP-FEEDBACK-UI") return node;
      for (const child of [
        ...(node.children ?? []),
        ...(node.shadowRoots ?? []),
      ]) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    }
    const host = find(root);
    assert.ok(host?.shadowRoots?.[0], "feedback UI mounted");
    const { object } = await session.send("DOM.resolveNode", {
      nodeId: host.shadowRoots[0].nodeId,
    });
    const result = await session.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: `function(){${expression}}`,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  } finally {
    await session.detach();
  }
}
try {
  if (permissionsMode) {
    displayProcess = spawn(
      process.env.XVFB_PATH ?? "Xvfb",
      [
        "-displayfd",
        "1",
        "-screen",
        "0",
        "1280x900x24",
        "-nolisten",
        "tcp",
        "-nolisten",
        "unix",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let ready = "",
      displayError,
      displayLogs = "";
    displayProcess.on("error", (error) => {
      displayError = error;
    });
    displayProcess.stdout.on("data", (data) => {
      ready += data;
    });
    displayProcess.stderr.on("data", (data) => {
      displayLogs = (displayLogs + data).slice(-3000);
    });
    await waitUntil(async () => {
      if (displayError)
        throw new Error(
          `Xvfb unavailable: ${displayError.message}. Install Xvfb or set XVFB_PATH.`,
        );
      if (displayProcess.exitCode !== null)
        throw new Error(`Xvfb exited: ${displayLogs}`);
      if (/^\d+\s*$/.test(ready)) {
        permissionDisplay = `:${ready.trim()}`;
        return true;
      }
      return false;
    }, "isolated Xvfb display ready");
  }
  await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
  const fixtureUrl = `http://${permissionsMode ? "review.test" : "127.0.0.1"}:${fixture.address().port}`;
  const a = await openProfile("reviewer-a");
  // Reserve a free loopback port without using any cloud resource.
  const reservation = createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const apiPort = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const apiUrl = `http://127.0.0.1:${apiPort}`,
    persistence = join(temporary, "d1");
  wrangler([
    "d1",
    "migrations",
    "apply",
    "feedback",
    "--local",
    "--persist-to",
    persistence,
  ]);
  const hash = (s) => createHash("sha256").update(s).digest("hex");
  const participantTokens = {
    "Reviewer A": randomBytes(32).toString("hex"),
    "Reviewer B": randomBytes(32).toString("hex"),
  };
  const participantExpiry = new Date(Date.now() + 3600000).toISOString();
  const sqlFile = join(temporary, "seed.sql");
  // Test-only DB fixtures establish already-authenticated app sessions. No
  // production auth bypass is available; real Google login is tested separately.
  const fixtureSql = Object.entries(participantTokens)
    .map(
      ([name, token], index) =>
        `INSERT INTO site_participants(id,display_name,token_hash,expires_at,google_subject_hash) VALUES('smoke-reviewer-${index}','${name}','${hash(token)}','${participantExpiry}','${hash("google:test-" + index)}');`,
    )
    .join("\n");
  await writeFile(sqlFile, fixtureSql, { mode: 0o600 });
  wrangler([
    "d1",
    "execute",
    "feedback",
    "--local",
    "--persist-to",
    persistence,
    "--file",
    sqlFile,
  ]);
  workerProcess = spawn(
    "pnpm",
    [
      "exec",
      "wrangler",
      "dev",
      "--local",
      "--ip",
      "127.0.0.1",
      "--port",
      String(apiPort),
      "--persist-to",
      persistence,
      "--var",
      `EXTENSION_ORIGINS:chrome-extension://${a.id}`,
      "--var",
      "GOOGLE_CLIENT_ID:browser-test.apps.googleusercontent.com",
      "--var",
      "GOOGLE_CLIENT_SECRET:browser-test-not-a-real-secret",
    ],
    { cwd: apiDirectory, env: environment, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  workerProcess.stdout.on("data", (data) => (logs += data));
  workerProcess.stderr.on("data", (data) => (logs += data));
  await waitUntil(async () => {
    if (workerProcess.exitCode !== null)
      throw new Error(`Local Worker exited: ${logs}`);
    try {
      return (await fetch(`${apiUrl}/health`)).ok;
    } catch {
      return false;
    }
  }, "local Worker ready");
  async function reviewer(profile, name) {
    await profile.worker.evaluate(
      async (settings) => {
        await chrome.storage.session.set({ settings });
      },
      {
        authProvider: "google",
        apiUrl,
        scope: "sites",
        token: participantTokens[name],
        expiresAt: participantExpiry,
        displayName: name,
      },
    );
    const popup = await profile.context.newPage();
    await popup.goto(`chrome-extension://${profile.id}/popup.html`);
    await popup.getByRole("status").filter({ hasText: "参加中" }).waitFor();
    const layout = await popup.evaluate(() => {
      const main = document.querySelector("main");
      const button = document.querySelector(".actions > button");
      if (!main || !button) throw new Error("Joined popup missing");
      const style = window.getComputedStyle(button);
      return {
        width: main.getBoundingClientRect().width,
        height: main.getBoundingClientRect().height,
        overflow: main.scrollWidth > main.clientWidth,
        foreground: style.color,
        background: style.backgroundColor,
      };
    });
    assert.ok(
      layout.width <= 360 && layout.height <= 420 && !layout.overflow,
      "Joined popup stays compact without horizontal overflow",
    );
    function luminance(rgb) {
      const values = rgb
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map((v) => {
          const c = Number(v) / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
    }
    const light = luminance(layout.foreground),
      dark = luminance(layout.background);
    assert.ok(
      (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05) >= 4.5,
      "Primary action text remains readable",
    );
    const page = await profile.context.newPage();
    await page.goto(`${fixtureUrl}/app`);
    await page.bringToFront();
    assert.equal(await page.title(), fixtureTitle);
    const tabId = await profile.worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab.id;
    });
    async function canInject() {
      return profile.worker.evaluate(async (tabId) => {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => document.title,
          });
          return true;
        } catch {
          return false;
        }
      }, tabId);
    }
    if (permissionsMode) {
      assert.equal(
        await canInject(),
        false,
        "Non-allowlisted origin requires activeTab",
      );
      const denied = await popup.evaluate(() =>
        chrome.runtime.sendMessage({ type: "activate" }),
      );
      assert.equal(
        denied.ok,
        false,
        "Popup-tab message alone must not grant activeTab",
      );
      assert.equal(await page.locator("app-feedback-ui").count(), 0);
      assert.ok(profile.browserPid, "Owned browser PID available");
      // Native Chrome shortcut executes the real extension action, unlike a DOM key event.
      execFileSync(
        "python3",
        [
          resolve("scripts/chrome-action.py"),
          String(profile.browserPid),
          fixtureTitle,
        ],
        { stdio: "pipe", env: { ...process.env, DISPLAY: permissionDisplay } },
      );
      await waitUntil(canInject, `${name} receives action-granted activeTab`);
      await page.bringToFront();
      console.log(
        `PASS: ${name} denied before native action; native action-granted activeTab verified on review.test.`,
      );
    }
    async function activate(mode = "view") {
      const reply = await popup.evaluate(
        (mode) => chrome.runtime.sendMessage({ type: "activate", mode }),
        mode,
      );
      assert.equal(reply.ok, true);
      await page.locator("app-feedback-ui").waitFor();
    }
    await activate();
    return { page, popup, activate, canInject };
  }
  const reviewerA = await reviewer(a, "Reviewer A");
  assert.equal(
    await reviewerA.popup.locator("form:visible").count(),
    0,
    "Joined popup hides forms until explicitly opened",
  );
  assert.equal(
    await reviewerA.popup.locator(".actions > button").count(),
    1,
    "A single joined entry action",
  );
  await shadow(
    reviewerA.page,
    "Array.from(this.querySelectorAll('button')).find(b=>b.textContent==='＋ コメントを書く').click()",
  );
  await reviewerA.page
    .getByRole("button", { name: "Save", exact: true })
    .click();
  assert.equal(await reviewerA.page.evaluate(() => window.submissions), 0);
  assert.equal(reviewerA.page.url(), `${fixtureUrl}/app`);
  await shadow(
    reviewerA.page,
    "this.querySelector('.category-picker input[value=bug]').click();this.querySelector('textarea').value='Two-profile feedback';this.querySelector('form').requestSubmit();",
  );
  await waitUntil(
    async () =>
      String(
        await shadow(
          reviewerA.page,
          "return this.querySelector('ol').textContent",
        ),
      ).includes("Two-profile feedback"),
    "A post visible",
  );
  const b = await openProfile("reviewer-b");
  assert.equal(a.id, b.id);
  const reviewerB = await reviewer(b, "Reviewer B");
  await waitUntil(
    async () =>
      (await shadow(
        reviewerB.page,
        "return this.querySelectorAll('.pin').length",
      )) === 1,
    "B sees pin",
  );
  assert.ok(
    String(
      await shadow(
        reviewerB.page,
        "return this.querySelector('ol').textContent",
      ),
    ).includes("Two-profile feedback"),
  );
  assert.equal(
    await reviewerB.page.evaluate(
      () => document.querySelector("app-feedback-ui").shadowRoot,
    ),
    null,
  );
  assert.equal(
    await shadow(
      reviewerB.page,
      "return this.querySelector('.comment-author').textContent",
    ),
    "Reviewer A",
  );
  await waitUntil(
    async () =>
      (await shadow(
        reviewerB.page,
        "return getComputedStyle(this.querySelector('.pin')).backgroundColor",
      )) === "rgb(185, 74, 72)",
    "Bug pin settles to red after its color transition",
  );
  // Real pointer actions exercise list -> target -> pin detail and the clipboard.
  await reviewerB.page.bringToFront();
  await reviewerB.page.evaluate(() => {
    document.querySelector("form").style.marginTop = "1800px";
  });
  await waitUntil(
    async () =>
      await shadow(reviewerB.page, "return this.querySelector('.pin').hidden"),
    "offscreen pin hidden",
  );
  const clickUI = async (selector) => {
    const point = await shadow(
      reviewerB.page,
      "const el=this.querySelector(" +
        JSON.stringify(selector) +
        ");el.scrollIntoView({block:'nearest'});const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}",
    );
    await reviewerB.page.mouse.click(point.x, point.y);
  };
  await clickUI(".comment-action");
  await waitUntil(
    async () =>
      await shadow(
        reviewerB.page,
        "return !this.querySelector('.highlight').hidden && !this.querySelector('.pin').hidden",
      ),
    "list click reveals and highlights offscreen target",
  );
  assert.equal(
    await reviewerB.page.evaluate(() => window.submissions),
    0,
    "Jump does not submit the target",
  );
  await clickUI(".pin");
  assert.equal(
    await shadow(
      reviewerB.page,
      "return this.querySelector('.feedback-preview').hidden",
    ),
    false,
  );
  assert.ok(
    String(
      await shadow(
        reviewerB.page,
        "return this.querySelector('.feedback-preview').textContent",
      ),
    ).includes("Two-profile feedback"),
  );
  assert.equal(
    await shadow(
      reviewerB.page,
      "return this.querySelector('.feedback-preview .comment-author').textContent",
    ),
    "Reviewer A",
  );
  await shadow(
    reviewerB.page,
    "this.querySelector('.feedback-preview .panel-close').click()",
  );
  if (!permissionsMode) {
    await clickUI(".copy-action");
    await waitUntil(
      async () =>
        String(
          await shadow(
            reviewerB.page,
            "return this.querySelector('[role=status]').textContent",
          ),
        ).includes("コピーしました"),
      "one-click feedback copy",
    );
    await b.context.grantPermissions(["clipboard-read"], {
      origin: fixtureUrl,
    });
    const copied = await reviewerB.page.evaluate(() =>
      window.navigator.clipboard.readText(),
    );
    const exported = JSON.parse(copied);
    assert.equal(exported.pageUrl, fixtureUrl + "/app");
    assert.equal(exported.feedback[0].comment, "Two-profile feedback");
    for (const secret of [
      ...Object.values(participantTokens),
      "never-store-this",
    ])
      assert.ok(!copied.includes(secret));
  }
  await reviewerB.page.evaluate(() => {
    document.querySelector("form").style.marginTop = "";
    window.scrollTo(0, 0);
  });
  const panelStyleProbe =
    "const panel=getComputedStyle(this.querySelector('section'));return {background:panel.backgroundColor,position:panel.position,fontSize:panel.fontSize,buttonFontSize:getComputedStyle(this.querySelector('section button')).fontSize}";
  const originalPanelStyle = await shadow(reviewerB.page, panelStyleProbe);
  const hostileStyle = await reviewerB.page.addStyleTag({
    content:
      "section {background: red !important;position: static !important;font-size:64px !important} button,textarea {font-size:64px !important}",
  });
  assert.equal(
    await reviewerB.page
      .getByRole("button", { name: "Save", exact: true })
      .evaluate((el) => window.getComputedStyle(el).fontSize),
    "64px",
  );
  assert.deepEqual(
    await shadow(reviewerB.page, panelStyleProbe),
    originalPanelStyle,
    "Host CSS must not change the feedback panel",
  );
  await hostileStyle.evaluate((el) => el.remove());
  // Explicit opt-in survives full navigation and back/forward in viewing mode.
  await reviewerB.activate();
  assert.equal(await reviewerB.page.locator("app-feedback-ui").count(), 1);
  await reviewerB.page.reload();
  await reviewerB.page.locator("app-feedback-ui").waitFor();
  await waitUntil(
    async () =>
      (await shadow(
        reviewerB.page,
        "return this.querySelectorAll('.pin').length",
      )) === 1,
    "B reload pin",
  );
  await reviewerB.page
    .getByRole("link", { name: "Other route", exact: true })
    .click();
  await reviewerB.page.waitForURL(`${fixtureUrl}/app/other`);
  await reviewerB.page.locator("app-feedback-ui").waitFor();
  await waitUntil(
    async () =>
      (await shadow(
        reviewerB.page,
        "return this.querySelectorAll('li').length",
      )) === 0,
    "Unrelated route stays empty after auto restore",
  );
  await reviewerB.page.goBack();
  await reviewerB.page.locator("app-feedback-ui").waitFor();
  await waitUntil(
    async () =>
      (await shadow(
        reviewerB.page,
        "return this.querySelectorAll('.pin').length",
      )) === 1,
    "Back navigation restores pins without popup action",
  );
  await reviewerB.page.goto(`${fixtureUrl}/outside`);
  // Every path on this origin is supported, with its own comment list.
  await reviewerB.page.locator("app-feedback-ui").waitFor();
  await waitUntil(
    async () =>
      (await shadow(
        reviewerB.page,
        "return this.querySelectorAll('li').length",
      )) === 0,
    "Another same-origin path restores an empty list",
  );
  await reviewerB.page.goBack();
  await reviewerB.page.locator("app-feedback-ui").waitFor();
  // A host page can replace/remove injected DOM. Selection must then release
  // native page interactions and allow a fresh user activation.
  await reviewerB.page.evaluate(() =>
    document.querySelector("app-feedback-ui").remove(),
  );
  await reviewerB.page
    .getByRole("button", { name: "Save", exact: true })
    .click();
  assert.equal(
    await reviewerB.page.evaluate(() => window.submissions),
    1,
    "Removed UI releases native form submission",
  );
  await reviewerB.activate();
  assert.equal(await reviewerB.page.locator("app-feedback-ui").count(), 1);
  await reviewerB.page.evaluate(() => document.querySelector("form").remove());
  await waitUntil(
    async () =>
      String(
        await shadow(
          reviewerB.page,
          "return this.querySelector('ol').textContent",
        ),
      ).includes("対象が見つかりません"),
    "stale selector list",
  );
  await reviewerB.page.evaluate(() =>
    history.pushState({}, "", "/app/other?secret=ignore#ignore"),
  );
  await waitUntil(
    async () =>
      (await shadow(
        reviewerB.page,
        "return this.querySelectorAll('li').length",
      )) === 0,
    "SPA route isolation",
  );
  await reviewerB.activate("select");
  await reviewerB.page.keyboard.press("Escape");
  assert.equal(
    await reviewerB.page.locator("app-feedback-ui").count(),
    1,
    "Escape returns to viewing mode",
  );
  await shadow(
    reviewerB.page,
    "this.querySelector('button[aria-label=\"このタブのコメント表示をやめる\"]').click()",
  );
  await waitUntil(
    async () => (await reviewerB.page.locator("app-feedback-ui").count()) === 0,
    "Explicit hide closes UI",
  );
  // Wait for background persistence before testing a fresh document.
  await waitUntil(
    async () =>
      !(
        await reviewerB.popup.evaluate(() =>
          chrome.runtime.sendMessage({ type: "status" }),
        )
      ).data.active,
    "Tab display disabled",
  );
  await reviewerB.page.reload();
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(
    await reviewerB.page.locator("app-feedback-ui").count(),
    0,
    "Explicit hide disables auto restore",
  );
  if (permissionsMode) {
    assert.equal(
      await reviewerB.canInject(),
      true,
      "Same-origin SPA navigation retains grant",
    );
    await reviewerB.page.goto(
      `http://other.test:${fixture.address().port}/app`,
    );
    assert.equal(await reviewerB.page.locator("app-feedback-ui").count(), 0);
    assert.equal(
      await reviewerB.canInject(),
      false,
      "Cross-origin navigation revokes activeTab",
    );
    await reviewerB.page.goto(`${fixtureUrl}/app`);
    assert.equal(
      await reviewerB.canInject(),
      false,
      "Returning to original origin requires a new action",
    );
    console.log(
      "PASS: activeTab retained on same-origin SPA/reload and revoked after cross-origin navigation.",
    );
  }
  // Capture the requested Issue URL at the tab API boundary, then open a
  // local fixture instead. This tests tab creation without contacting GitHub.
  await reviewerA.popup.evaluate((fixtureUrl) => {
    const create = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = async (options) => {
      chrome.tabs.create = create;
      globalThis.__feedbackIssueUrl = options.url;
      return create({ url: fixtureUrl + "/issue-editor-test" });
    };
  }, fixtureUrl);
  await reviewerA.popup
    .getByText("この拡張機能にフィードバック", { exact: true })
    .click();
  const extensionReport = "拡張機能のフィードバック導線を試す";
  await reviewerA.popup.getByLabel("気づいたこと").fill(extensionReport);
  const issuePagePromise = a.context.waitForEvent("page");
  await reviewerA.popup
    .getByRole("button", { name: "GitHubで確認する", exact: true })
    .click();
  const issuePage = await issuePagePromise;
  await issuePage.waitForURL(fixtureUrl + "/issue-editor-test");
  const issueUrl = new URL(
    await reviewerA.popup.evaluate(() => globalThis.__feedbackIssueUrl),
  );
  assert.equal(
    issueUrl.origin + issueUrl.pathname,
    "https://github.com/StellaContrail/app-feedback/issues/new",
  );
  assert.equal(
    issueUrl.searchParams.get("title"),
    `[拡張機能] ${extensionReport}`,
  );
  assert.ok(issueUrl.searchParams.get("body").includes(extensionReport));
  assert.ok(!issueUrl.searchParams.get("body").includes(fixtureUrl));
  assert.ok(!issueUrl.searchParams.get("body").includes("Reviewer A"));
  assert.equal(Array.from(issueUrl.searchParams.keys()).length, 2);
  await issuePage.close();
  console.log(
    "PASS: extension feedback opens a prefilled Issue editor without site/account data; tab redirected locally, no GitHub request or Issue created.",
  );
  const stored = wrangler([
    "d1",
    "execute",
    "feedback",
    "--local",
    "--persist-to",
    persistence,
    "--command",
    "SELECT * FROM site_feedback",
    "--json",
  ]);
  assert.ok(!stored.includes("never-store-this"));
  for (const token of Object.values(participantTokens))
    assert.ok(!stored.includes(token));
  assert.ok(stored.includes("Two-profile feedback"));
  console.log(
    "PASS: two Chrome profiles use seeded authenticated sessions, A selects/posts without form submission, B sees pin after reload; joined popup, list target jumps/highlights, pin detail, " +
      (permissionsMode ? "" : "clipboard on localhost, ") +
      "automatic same-origin reload/back restoration, explicit hide, duplicate injection, removed-host cleanup, closed Shadow DOM/CSS isolation, stale list, SPA route isolation, Escape and private storage verified.",
  );
  console.log(
    permissionsMode
      ? "Permission-mode evidence uses seeded app sessions and a native extension-action shortcut; real Google consent and human visual review remain separate."
      : "Note: Google login is not exercised by this seeded-session UI smoke; loopback API host permission covers this fixture. Run test:permissions for native action-granted activeTab coverage.",
  );
} finally {
  for (const context of contexts) await context.close();
  if (workerProcess) {
    workerProcess.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => workerProcess.once("exit", r)),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  }
  if (displayProcess) displayProcess.kill("SIGTERM");
  await new Promise((r) => fixture.close(r));
  await rm(temporary, { recursive: true, force: true });
}
