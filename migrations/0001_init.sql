-- Candidate aircraft (uploaded in the app from the BSJC PDF or a CSV)
CREATE TABLE candidates (
  hex TEXT PRIMARY KEY,               -- lowercase 6-char Mode S hex
  registration TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  registered_owner TEXT NOT NULL DEFAULT '',
  owner_city TEXT NOT NULL DEFAULT '',
  owner_state TEXT NOT NULL DEFAULT '',
  uploaded_at TEXT NOT NULL
);

-- Airports referenced by overnights / landings
CREATE TABLE airports (
  ident TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT '',
  iso_region TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  in_region INTEGER NOT NULL
);

-- One row per aircraft-night: airport at 03:00 local on night+1
CREATE TABLE overnights (
  hex TEXT NOT NULL,
  night TEXT NOT NULL,                -- YYYY-MM-DD (evening date)
  airport TEXT NOT NULL,
  in_region INTEGER NOT NULL,
  PRIMARY KEY (hex, night)
);
CREATE INDEX overnights_airport ON overnights (airport);

-- Observed or inferred landings (arrival of a ground stay)
CREATE TABLE landings (
  hex TEXT NOT NULL,
  t INTEGER NOT NULL,                 -- epoch seconds
  airport TEXT NOT NULL,
  in_region INTEGER NOT NULL,
  inferred INTEGER NOT NULL,
  PRIMARY KEY (hex, t)
);
CREATE INDEX landings_airport ON landings (airport);

-- Per-aircraft scores, recomputed by each ingest run
CREATE TABLE scores (
  hex TEXT PRIMARY KEY,
  first_seen TEXT,
  last_seen TEXT,
  adsb_registration TEXT,
  adsb_type TEXT,
  top_airport TEXT,
  top_airport_share REAL NOT NULL DEFAULT 0,
  nights_observed INTEGER NOT NULL DEFAULT 0,
  nights_in_region INTEGER NOT NULL DEFAULT 0,
  region_share REAL NOT NULL DEFAULT 0,
  landings_in_region INTEGER NOT NULL DEFAULT 0,
  landings_total INTEGER NOT NULL DEFAULT 0,
  top_region_airport TEXT
);

CREATE TABLE ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  days INTEGER NOT NULL,
  candidates INTEGER NOT NULL,
  aircraft_seen INTEGER NOT NULL,
  finished_at TEXT NOT NULL
);
