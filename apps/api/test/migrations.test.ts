import { applyD1Migrations, env } from "cloudflare:test";
import { expect, it } from "vitest";
import app, { hash } from "../src/index";

it("upgrades populated pre-Google databases without publishing private feedback", async () => {
  const migrations = env.TEST_MIGRATIONS;
  await applyD1Migrations(env.DB, migrations.slice(0, 2));
  await env.DB.prepare(
    "INSERT INTO sessions(id,name,invite_secret_hash,admin_secret_hash,expires_at) VALUES(?,?,?,?,?)",
  )
    .bind(
      "legacy-session",
      "Private",
      "invite-hash",
      "admin-hash",
      "2099-01-01",
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO apps(id,session_id,name,origin) VALUES(?,?,?,?)",
  )
    .bind("legacy-app", "legacy-session", "Private", "https://example.com")
    .run();
  const token = "legacy-token";
  await env.DB.prepare(
    "INSERT INTO participants(id,session_id,display_name,token_hash,expires_at) VALUES(?,?,?,?,?)",
  )
    .bind(
      "legacy-user",
      "legacy-session",
      "Private reviewer",
      await hash(token),
      "2099-01-01",
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO feedback(id,app_id,author_id,page_path,selector,tag_name,rect_json,category,comment) VALUES(?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      "legacy-feedback",
      "legacy-app",
      "legacy-user",
      "/",
      "button",
      "BUTTON",
      "{}",
      "bug",
      "Private comment",
    )
    .run();
  const before = (await env.DB.prepare("SELECT * FROM feedback").all()).results;
  await applyD1Migrations(env.DB, migrations);
  expect(
    (await env.DB.prepare("SELECT * FROM feedback").all()).results,
  ).toEqual(before);
  expect(
    await env.DB.prepare(
      "SELECT google_subject_hash FROM participants",
    ).first(),
  ).toEqual({ google_subject_hash: null });
  for (const table of ["sites", "site_feedback", "site_participants"]) {
    expect(
      await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first(),
    ).toEqual({ count: 0 });
  }
  const origin = `chrome-extension://${"a".repeat(32)}`;
  for (const path of [
    "/v1/sites/feedback?pageUrl=https%3A%2F%2Fexample.com%2F&path=%2F",
    "/v1/apps/legacy-app/feedback?pageUrl=https%3A%2F%2Fexample.com%2F&path=%2F",
  ]) {
    const response = await app.request(
      `http://local${path}`,
      { headers: { Origin: origin, Authorization: `Bearer ${token}` } },
      {
        DB: env.DB,
        EXTENSION_ORIGINS: origin,
        GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
        GOOGLE_CLIENT_SECRET: "test-client-secret",
      },
    );
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("Private comment");
  }
  // Reapplying the complete migration list must preserve data too.
  await applyD1Migrations(env.DB, migrations);
  expect(
    (await env.DB.prepare("SELECT * FROM feedback").all()).results,
  ).toEqual(before);
});
