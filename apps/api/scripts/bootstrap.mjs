import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
const url = new URL(process.argv[2] ?? "http://localhost:4173/");
if (
  !["http:", "https:"].includes(url.protocol) ||
  url.username ||
  url.password ||
  /%2f|%5c/i.test(url.pathname)
)
  throw new Error("Use an HTTP(S) app URL without credentials");
const path = url.pathname.replace(/\/+$/, "") || "/";
const sessionId = randomUUID(),
  appId = randomUUID();
const inviteCode = randomBytes(32).toString("hex"),
  adminSecret = randomBytes(32).toString("hex");
const hash = (s) => createHash("sha256").update(s).digest("hex");
const quote = (s) => `'${s.replaceAll("'", "''")}'`;
const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
await mkdir(".local", { recursive: true, mode: 0o700 });
// Exclusive creation prevents accidentally overwriting credentials for an existing DB.
await writeFile(
  ".local/credentials.json",
  JSON.stringify(
    {
      sessionId,
      appId,
      inviteCode,
      adminSecret,
      expiresAt,
      origin: url.origin,
      basePath: path,
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600, flag: "wx" },
);
await writeFile(
  ".local/bootstrap.sql",
  `INSERT INTO sessions(id,name,invite_secret_hash,admin_secret_hash,expires_at) VALUES (${[sessionId, "Local review", hash(inviteCode), hash(adminSecret), expiresAt].map(quote).join(",")});\nINSERT INTO apps(id,session_id,name,origin,base_path) VALUES (${[appId, sessionId, "Local app", url.origin, path].map(quote).join(",")});\n`,
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Created .local/credentials.json (private) and .local/bootstrap.sql (hashes only). Apply SQL with the documented --local command.",
);
