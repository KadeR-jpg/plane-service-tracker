-- Archive parts still to process per day in a refresh run (a day is done when all its parts are)
CREATE TABLE IF NOT EXISTS day_parts (
  run INTEGER NOT NULL,
  day TEXT NOT NULL,
  pending INTEGER NOT NULL,
  failed INTEGER NOT NULL DEFAULT 0,
  seen INTEGER NOT NULL DEFAULT 0,
  kept INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run, day)
);
