PRAGMA foreign_keys = ON;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  invite_secret_hash TEXT NOT NULL,
  admin_secret_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE TABLE apps (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  origin TEXT NOT NULL,
  base_path TEXT NOT NULL DEFAULT '/',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX apps_by_session ON apps(session_id);
CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX participants_by_session ON participants(session_id);
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  page_path TEXT NOT NULL,
  selector TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  text_snippet TEXT NOT NULL DEFAULT '',
  rect_json TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('bug','suggestion','praise')),
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX feedback_by_app_path ON feedback(app_id,page_path,created_at);
