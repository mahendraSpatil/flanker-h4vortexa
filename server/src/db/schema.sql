-- Owner: Archit (frozen; ask before changing) | SQLite schema, verbatim from CLAUDE.md "API contract and database"
CREATE TABLE IF NOT EXISTS batches (
  batch_id TEXT PRIMARY KEY, root TEXT NOT NULL, leaf_count INTEGER NOT NULL,
  tree_json TEXT NOT NULL,                  -- all levels, bottom to top
  tx_hash TEXT, block_number INTEGER, published_at TEXT
);
CREATE TABLE IF NOT EXISTS records (
  record_id      TEXT PRIMARY KEY,          -- REC-000001
  file_hash      TEXT NOT NULL UNIQUE,
  file_name      TEXT NOT NULL,
  mime           TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('draft','pending','anchored')),
  doc_type       TEXT, issuer TEXT, doc_date TEXT,   -- confirmed values (NULL while draft)
  leaf           TEXT,
  batch_id       TEXT REFERENCES batches(batch_id),
  leaf_index     INTEGER,
  ai_suggestions TEXT,                      -- JSON, kept for audit only
  extraction_path TEXT,                     -- 'ai' | 'fallback'
  created_by TEXT, confirmed_by TEXT,
  created_at TEXT NOT NULL, confirmed_at TEXT
);
-- v2: each confirmed record's salted fields, the leaves of its field tree (fieldsRoot is rebuilt from these)
CREATE TABLE IF NOT EXISTS record_fields (
  record_id TEXT NOT NULL REFERENCES records(record_id),
  idx       INTEGER NOT NULL,               -- position in the field tree (schema order), 0-based
  name      TEXT NOT NULL,                  -- e.g. netPay
  value     TEXT NOT NULL,                  -- normalised: amounts in paise, names uppercase, months YYYY-MM
  salt      TEXT NOT NULL,                  -- 32 lowercase hex chars from crypto.randomBytes(16)
  PRIMARY KEY (record_id, name)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT,
  action TEXT NOT NULL,                     -- UPLOAD, CONFIRM, SEAL, PUBLISH, AUDIT, TAMPER, REJECT
  target TEXT, outcome TEXT, detail TEXT    -- detail = JSON
);
