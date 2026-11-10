-- Job log for the refresh worker (also created on demand by the worker)
CREATE TABLE IF NOT EXISTS refresh_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  run INTEGER,
  kind TEXT NOT NULL,
  day TEXT,
  attempt INTEGER,
  event TEXT NOT NULL,                -- start | done | error
  secs REAL,
  detail TEXT NOT NULL DEFAULT ''
);
