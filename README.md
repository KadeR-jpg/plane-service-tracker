# Regional Base Finder

This SvelteKit app runs on Cloudflare Workers with D1. It finds which ULR / large-cabin aircraft are probably **based** in this service region:

- Montana
- Idaho
- Wyoming
- Eastern Washington (east of -120.5°)
- Northern Utah (north of 39.5°)

It uses ADS-B overnight locations from the adsb.lol history archives, not FAA registered addresses.

The work is split in two parts:

| Part | Where it runs | What it does |
|---|---|---|
| Web app (`src/`) | Cloudflare Worker | Summary, all-aircraft table, per-aircraft overnight calendar, candidate list upload, CSV/Markdown exports |
| Ingest CLI (`scripts/ingest/`) | Your machine (Node 22+) | Streams daily ADS-B history, filters it to the candidate hex codes, reconstructs overnights, and pushes the results to D1 with wrangler |

The ingest runs locally because each day of history is a 3–4 GB tar. Processing that on Workers would need the paid plan's long CPU limits.

## Setup

```sh
npm install
npx wrangler login
npx wrangler d1 create plane-service-tracker      # paste the database_id into wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put ADMIN_TOKEN               # required to replace the candidate list
npm run deploy
```

Local development:

```sh
echo 'ADMIN_TOKEN=dev-token' > .dev.vars
npm run db:migrate:local
npm run build && npx wrangler dev                 # http://localhost:8787
```

## Workflow

1. **Upload candidates.** On `/candidates`, choose `BSJC_FAA_ULR_LargeCabin_Candidate_List.pdf` or a CSV.
   - The PDF is parsed in the browser with pdf.js. Columns are found by their header labels: Registration, Mode S hex, FAA model, Registered owner, Owner city, Owner state.
   - Hex codes are lowercased and padded to 6 characters. Rows without a hex are dropped, and duplicates are removed.
   - Check the preview, then save with the admin token.
2. **Ingest.** Run this from the repo on your machine:
   ```sh
   npm run ingest -- run --days 90            # remote D1 (add --local for wrangler dev)
   ```
   - `fetch` reads the candidate hex codes from D1. It streams each day's archive parts straight into a tar reader, so **no raw archive is written to disk**. It keeps only matching traces, stored compactly under `traces/YYYY-MM-DD/<hex>.json`.
   - One day takes about 15–60 s, depending on bandwidth.
   - Finished days are skipped on restart. A day is downloaded again only if the candidate list has gained hex codes since that day was fetched.
   - Progress is written to `progress.log`.
   - `score` rebuilds the stays and overnights from the cached traces. It writes `ingest-out/push.sql` and runs it against D1. Use `--dry-run` to write the file without running it.
   - Behind an HTTPS proxy, set `NODE_USE_ENV_PROXY=1`.
3. **Read results** on `/`. The thresholds can be adjusted there. Exports:
   - `/export/regional_base_candidates.csv`
   - `/export/overnights.csv`
   - `/export/summary.md`

## Method

- **History source:** GitHub releases `adsblol/globe_history_<year>`, tag `v<YYYY.MM.DD>-planes-readsb-prod-0`. The assets `<tag>.tar.aa`, `.ab`, … concatenate into one tar, and traces are stored as `./traces/<xx>/trace_full_<hex>.json` (gzip). Tags are listed with `git ls-remote`, so no GitHub API is needed.
- **Airports:** OurAirports large and medium airports, plus small airports with an open runway of at least 4000 ft. The files are downloaded to `data/` on first run.
- **Ground point:** `alt == "ground"` or ground speed < 40 kt. It is snapped to the nearest airport within 3 NM.
- **Inferred landing or departure:** used for coverage gaps of more than 20 minutes, when the track ends or starts low near an airport (≤ 8 NM and < 3000 ft above field, or ≤ 20 NM and < 6000 ft). Medium airports get a 1.5 NM distance penalty and small airports 4 NM, so an approach to a big airport is not snapped to a strip next to it.
- **Stay:** runs from arrival until the next airborne point.
  - If that point is more than 150 NM away (departure not seen), the stay is capped at 36 h after the last evidence.
  - Before an aircraft's first evidence and after its last, a parked stay extends by at most 14 days.
- **Overnight for night D:** the airport where a stay covers 03:00 local (the airport's time zone) on D+1. Nights that fall on archive days that were not fetched are never counted.
- **Scores:**
  - `nights_observed`
  - `nights_in_region`
  - `region_share`
  - `top_airport` with its share
  - `landings_in_region` (observed and inferred landings at in-region airports)
- **Region rule:** `US-MT`, `US-ID` or `US-WY`; `US-WA` with lon > -120.5; `US-UT` with lat > 39.5. The lat > 39.5 rule includes Provo (KPVU).
- **Likely based:** `region_share ≥ 0.5` and `nights_observed ≥ 10`.
- **Frequent visitors:** at least 3 in-region landings, but not classed as based.

## Caveats

- PIA/LADD aircraft use rotating hex codes and do not match their FAA hex.
- Receiver coverage in rural MT, WY and ID is patchy, so some small-field legs are missed.
- Aircraft that visit Sun Valley, Jackson Hole or Bozeman often show high landings with a low overnight share. They are listed separately from based aircraft.

## Development

```sh
npm test          # vitest: stay/overnight logic, time zones, candidate parsing
npm run check     # svelte-check
npx tsc -p scripts/tsconfig.json
```
