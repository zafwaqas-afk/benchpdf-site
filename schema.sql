-- BenchPDF sign-ups. One row per person; answers stay optional columns.
-- Apply with:
--   npx wrangler d1 execute benchpdf --remote --file=./schema.sql
CREATE TABLE IF NOT EXISTS signups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  industry TEXT,
  converts TEXT,
  tools TEXT,
  breaks TEXT,
  consent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
