-- JBB PANEL — schema for a free Postgres (Neon / Supabase / Aiven)
--
-- You normally DO NOT need to run this: the server creates the table itself on
-- first boot (CREATE TABLE IF NOT EXISTS). This file exists so you can:
--   • inspect what the app stores
--   • create the table ahead of time from the Neon SQL editor
--   • reset the app to a clean state
--
-- Run it in the Neon console → SQL Editor.

-- The entire dataset is one JSON document in one row. This mirrors the file
-- backend exactly, so the same code path and version logic work on every host.
CREATE TABLE IF NOT EXISTS jbb_store (
  id         integer     PRIMARY KEY DEFAULT 1,
  doc        jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT jbb_store_single_row CHECK (id = 1)
);

-- Optional: see what is in it
-- SELECT id, doc->'ver' AS ver, updated_at, pg_size_pretty(pg_column_size(doc)) AS size FROM jbb_store;

-- DANGER: wipe all panel data (workers, advances, expenses, users)
-- DELETE FROM jbb_store;

-- DANGER: full reset — next boot re-seeds demo data and creates fresh accounts
-- DROP TABLE jbb_store;

-- Verification after deploy
-- SELECT count(*) FROM jbb_store;                 -- expect 1
-- SELECT doc->'ver', doc->>'updatedAt' FROM jbb_store;
