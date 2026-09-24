CREATE TABLE share_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('read', 'write')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  disabled_at INTEGER,
  last_used_at INTEGER
);
