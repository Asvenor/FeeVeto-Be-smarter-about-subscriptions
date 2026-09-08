-- Additive account history. Never migrate or upload browser-local subscriptions automatically.
CREATE TABLE IF NOT EXISTS saved_audit_versions (
  version_no INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  input_json TEXT NOT NULL,
  assessment_json TEXT NOT NULL,
  access_scope TEXT NOT NULL CHECK(access_scope IN ('public', 'complete')),
  created_at TEXT NOT NULL,
  UNIQUE(owner_id, request_key)
);
CREATE INDEX IF NOT EXISTS audit_owner_history ON saved_audit_versions(owner_id, audit_id, version_no DESC);
