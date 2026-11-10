-- When each aircraft first joined the list (uploaded_at changes on every update; added_at does not).
-- The refresh worker downloads history for aircraft added after a day was last processed.
ALTER TABLE candidates ADD COLUMN added_at TEXT NOT NULL DEFAULT '';
UPDATE candidates SET added_at = uploaded_at;

-- One condensed record per aircraft-day (see src/lib/ingest/dayrecord.ts), written once per archive day
CREATE TABLE day_items (
  hex TEXT NOT NULL,
  day TEXT NOT NULL,
  data TEXT NOT NULL,                 -- JSON DayRecord
  PRIMARY KEY (hex, day)
);
CREATE INDEX day_items_day ON day_items (day);

-- Archive days processed by the worker
CREATE TABLE ingest_days (
  day TEXT PRIMARY KEY,
  processed_at TEXT NOT NULL,         -- candidate list snapshot time used for this day
  traces_seen INTEGER NOT NULL DEFAULT 0,
  kept INTEGER NOT NULL DEFAULT 0
);

-- Refresh runs started by the nightly schedule, a list upload or the Refresh now button
CREATE TABLE refresh_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL,              -- schedule | upload | manual
  status TEXT NOT NULL,               -- downloading | scoring | done | failed
  started_at TEXT NOT NULL,
  finished_at TEXT,
  window_start TEXT,
  window_end TEXT,
  days_total INTEGER NOT NULL DEFAULT 0,
  days_pending INTEGER NOT NULL DEFAULT 0,
  days_failed INTEGER NOT NULL DEFAULT 0,
  score_total INTEGER NOT NULL DEFAULT 0,
  score_pending INTEGER NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT ''
);
