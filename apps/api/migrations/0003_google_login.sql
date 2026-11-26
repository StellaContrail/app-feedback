-- Legacy participant rows and feedback remain, but anonymous bearer tokens no
-- longer authorize reads/writes once the API requires this verified marker.
ALTER TABLE participants ADD COLUMN google_subject_hash TEXT;
CREATE INDEX participants_by_google ON participants(google_subject_hash);
CREATE TABLE google_login_flows (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  invite_secret_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  nonce_hash TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX google_login_flows_expiry ON google_login_flows(expires_at);
