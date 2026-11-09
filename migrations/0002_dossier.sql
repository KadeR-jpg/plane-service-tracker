-- FAA Part 135 operators (www.faa.gov weekly list), one row per authorized aircraft
CREATE TABLE part135 (
  registration TEXT PRIMARY KEY,      -- N-number, uppercase with N
  operator TEXT NOT NULL,
  designator TEXT NOT NULL DEFAULT '', -- FAA certificate designator
  chdo TEXT NOT NULL DEFAULT '',       -- certificate-holding district office
  cfr TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  list_date TEXT NOT NULL
);
CREATE INDEX part135_operator ON part135 (operator);

-- FAA aircraft registry (ReleasableAircraft.zip MASTER.txt), candidates only
CREATE TABLE faa_registry (
  registration TEXT PRIMARY KEY,
  serial TEXT NOT NULL DEFAULT '',
  year_mfr TEXT NOT NULL DEFAULT '',
  registrant_type TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  street2 TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  county TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  other_names TEXT NOT NULL DEFAULT '',   -- co-owners, '; '-separated
  cert_issue_date TEXT NOT NULL DEFAULT '',
  last_action_date TEXT NOT NULL DEFAULT '',
  expiration_date TEXT NOT NULL DEFAULT '',
  fract_owner TEXT NOT NULL DEFAULT '',
  status_code TEXT NOT NULL DEFAULT '',
  file_date TEXT NOT NULL
);

-- Earlier registrations of the same airframe (DEREG.txt, matched on serial number)
CREATE TABLE faa_prior (
  registration TEXT NOT NULL,          -- current N-number of the airframe
  prior_registration TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  street TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  cert_issue_date TEXT NOT NULL DEFAULT '',
  cancel_date TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (registration, prior_registration, name, cancel_date)
);

-- Callsigns seen in ADS-B (operator ICAO prefix or N-number), per aircraft
CREATE TABLE callsigns (
  hex TEXT NOT NULL,
  callsign TEXT NOT NULL,
  days INTEGER NOT NULL,               -- days on which it was used
  last_day TEXT NOT NULL,
  PRIMARY KEY (hex, callsign)
);

-- User-maintained prospect tracking
CREATE TABLE prospects (
  hex TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'new',  -- new | researching | contacted | customer | not_a_fit
  contact_name TEXT NOT NULL DEFAULT '',
  contact_role TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
