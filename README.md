# ULR large-cabin aircraft: regional home-base finder

This tool finds which large-cabin / ULR aircraft are probably **based** in MT, ID, WY, eastern WA (east of -120.5°) and northern UT (north of 39.5°). It works from ADS-B overnight locations, not FAA registered addresses.

## Pipeline

```
pip install -r requirements.txt

# 1. Candidate list (PDF -> candidates.csv; hex lowercased, rows without hex dropped)
python3 extract_candidates.py BSJC_FAA_ULR_LargeCabin_Candidate_List.pdf -o candidates.csv

# 2. Airport reference data (OurAirports)
mkdir -p data
curl -sSfL -o data/airports.csv https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv
curl -sSfL -o data/runways.csv  https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/runways.csv

# 3. History: last 90 days of adsb.lol globe_history, filtered to the candidate hexes
python3 fetch_history.py --candidates candidates.csv --days 90

# 4. Score
python3 analyze.py --candidates candidates.csv
```

Outputs:

- `regional_base_candidates.csv`: one row per candidate, sorted by `region_share`, then `nights_observed`. Columns follow the spec, plus `landings_total`, `top_region_airport` and `region_airports` (`ICAO:<nights>n/<landings>l` for each in-region airport).
- `overnights.csv`: one row per aircraft-night with the 03:00-local airport, for auditing.
- `summary.md`: in-region activity count, the likely-based list (`region_share >= 0.5` and `nights_observed >= 10`), frequent visitors, and counts by airport.
- `progress.log`: one line per fetched day.

## Fetching

- Release tags (`v<YYYY.MM.DD>-planes-readsb-prod-0`) are read with `git ls-remote`, so the GitHub API is not needed. Assets are `<tag>.tar.aa`, `.tar.ab`, … and concatenate into one tar.
- Traces are stored in the tar as `./traces/<last2hex>/trace_full_<hex>.json`, gzip-compressed readsb trace JSON.
- The parts are streamed from `curl` straight into Python `tarfile`. **No raw archive is written to disk.** One day is about 3–4 GB and takes 30–80 s.
- The output per day is `traces/YYYY-MM-DD/<hex>.json`, a compact form: `[epoch, lat, lon, alt|"ground", gs]`. Airborne points are thinned to 20 s and ground points to 60 s. Transitions and points next to gaps are always kept.
- A day counts as done when `traces/YYYY-MM-DD/.done` exists. On restart, finished days are skipped and a half-written `.partial` directory is redone.
- `--types GLF5,GLF6,...` replaces `--candidates` with a filter on the adsb.lol type code for US (`a*`) hex codes. Use it when the PDF is not available. Then run `analyze.py --derive-candidates --candidates candidates_interim.csv`.

## Scoring logic

- Airports: OurAirports large and medium airports, plus small airports with an open runway of at least 4000 ft.
- Ground point: `alt == "ground"` or ground speed < 40 kt. It is snapped to the nearest airport within 3 NM.
- Inferred landing or departure: a coverage gap of more than 20 minutes, where the track ends or starts low near an airport (≤ 8 NM and < 3000 ft above the field, or ≤ 20 NM and < 6000 ft).
- Stay at airport X: runs from arrival to the first later airborne point.
  - If that point is more than 150 NM away (departure not seen), the stay is capped at 36 h after the last evidence at X.
  - Before an aircraft's first evidence and after its last, a parked stay extends by at most 14 days.
- Overnight for night D: the stay that covers 03:00 local on D+1, using the airport's time zone (`timezonefinder`).
- `landings_in_region`: stays opened at in-region airports, counting both observed and inferred landings.

## Caveats

- PIA/LADD aircraft use rotating hex codes and are not matched.
- Receiver coverage in rural MT, WY and ID is patchy. Some small-field legs are still missed.
- Visitors to Sun Valley, Jackson Hole or Bozeman show high `landings_in_region` with a low `region_share`. `summary.md` lists them separately from based aircraft.
