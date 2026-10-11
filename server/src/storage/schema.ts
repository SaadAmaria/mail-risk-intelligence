/** Bump when the schema changes and add a migration step in sqliteRepository.ts. */
export const SCHEMA_VERSION = 1;

/**
 * Idempotent DDL (IF NOT EXISTS). `analyses`, `entities`, `entity_mentions` and `relationships`
 * are schema foundations for later phases; Phase 1 writes only `emails` and `attachments`.
 */
export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY,
  external_id TEXT UNIQUE,
  content_hash TEXT NOT NULL UNIQUE,
  source_kind TEXT NOT NULL,
  source_filename TEXT,
  from_address TEXT,
  from_name TEXT,
  to_json TEXT NOT NULL,
  cc_json TEXT NOT NULL,
  date TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  body_truncated INTEGER NOT NULL DEFAULT 0,
  missing_headers_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  raw_source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  text_origin TEXT,
  extraction_status TEXT NOT NULL,
  error_message TEXT,
  truncated INTEGER NOT NULL DEFAULT 0,
  extracted_text TEXT
);
CREATE INDEX IF NOT EXISTS idx_attachments_email ON attachments(email_id, position);

CREATE TABLE IF NOT EXISTS analyses (
  email_id TEXT PRIMARY KEY REFERENCES emails(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  analysis_mode TEXT,
  provenance TEXT,
  extraction_json TEXT,
  assessment_json TEXT,
  warnings_json TEXT,
  attempts_json TEXT,
  model TEXT,
  prompt_version TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  attributes_json TEXT,
  UNIQUE (type, canonical_key)
);

CREATE TABLE IF NOT EXISTS entity_mentions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  surface_form TEXT NOT NULL,
  snippet_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_mentions_entity ON entity_mentions(entity_id);
CREATE INDEX IF NOT EXISTS idx_mentions_email ON entity_mentions(email_id);

CREATE TABLE IF NOT EXISTS relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_id TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  source_entity TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  predicate TEXT NOT NULL,
  target_entity TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  snippet_id TEXT,
  quote TEXT
);
CREATE INDEX IF NOT EXISTS idx_relationships_email ON relationships(email_id);
`;
