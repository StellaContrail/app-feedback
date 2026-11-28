-- Site sharing starts empty. Private legacy session feedback is not published.
CREATE TABLE site_participants (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  google_subject_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE site_login_flows (
  id TEXT PRIMARY KEY,
  redirect_uri TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  nonce_hash TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX site_login_flows_expiry ON site_login_flows(expires_at);
CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE site_feedback (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES site_participants(id),
  page_path TEXT NOT NULL,
  selector TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  text_snippet TEXT NOT NULL DEFAULT '',
  rect_json TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('bug','suggestion','praise')),
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX site_feedback_by_page ON site_feedback(site_id,page_path,created_at,id);
