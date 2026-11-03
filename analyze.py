#!/usr/bin/env python3
"""Score each candidate aircraft for being based in the MT/ID/WY/E-WA/N-UT region.

Reads compacted traces from traces/YYYY-MM-DD/<hex>.json (written by
fetch_history.py), snaps ground activity to airports, reconstructs ground
"stays", assigns an overnight airport per night (location at 03:00 local),
and writes regional_base_candidates.csv, overnights.csv and summary.md.

Stay logic (per aircraft, all days merged in time order):
  * Ground point (alt == "ground" or gs < 40 kt) within 3 NM of an airport
    -> aircraft is at that airport.
  * Coverage gap > 20 min after an airborne point that is low and close to an
    airport (<= 8 NM and < 3000 ft above field, or <= 20 NM and < 6000 ft)
    -> inferred landing there. Symmetric rule for the first airborne point
    after a gap -> inferred departure from that airport.
  * A stay at airport X runs from arrival until the first later airborne
    observation. If that observation is > 150 NM from X (departure not seen),
    the stay is capped at 36 h after the last evidence at X. A stay that opens
    at the start of the data, or never sees a later airborne point, runs to the
    window boundary (aircraft parked with transponder off).
  * Night D is assigned to X if a stay at X covers 03:00 local (airport time
    zone) on D+1.
"""
import argparse
import csv
import datetime as dt
import glob
import json
import math
import os
import statistics
from collections import Counter, defaultdict
from zoneinfo import ZoneInfo

from timezonefinder import TimezoneFinder

GAP_S = 20 * 60
CAP_S = 36 * 3600
EDGE_CAP_S = 14 * 86400  # max parked extension before first / after last evidence
BRACKET_NM = 150
GROUND_SNAP_NM = 3.0
MIN_RUNWAY_FT = 4000


def nm(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 3440.065 * math.asin(math.sqrt(a))


def in_region(iso_region, lat, lon):
    if iso_region in ("US-MT", "US-ID", "US-WY"):
        return True
    if iso_region == "US-WA" and lon > -120.5:
        return True
    if iso_region == "US-UT" and lat > 39.5:
        return True
    return False


class Airports:
    """Airports usable by a large-cabin jet: large/medium, or small with a >= 4000 ft open runway."""

    def __init__(self, airports_csv, runways_csv):
        longest = defaultdict(int)
        with open(runways_csv, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r["closed"] == "1" or not r["length_ft"]:
                    continue
                longest[r["airport_ref"]] = max(longest[r["airport_ref"]], int(float(r["length_ft"])))
        self.by_ident = {}
        self.grid = defaultdict(list)
        with open(airports_csv, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                t = r["type"]
                if t not in ("large_airport", "medium_airport", "small_airport"):
                    continue
                if t == "small_airport" and longest[r["id"]] < MIN_RUNWAY_FT:
                    continue
                lat, lon = float(r["latitude_deg"]), float(r["longitude_deg"])
                ident = r["icao_code"] or r["gps_code"] or r["ident"]
                a = {
                    "ident": ident, "name": r["name"], "lat": lat, "lon": lon,
                    "elev": float(r["elevation_ft"] or 0), "iso_region": r["iso_region"],
                    "city": r["municipality"], "region": in_region(r["iso_region"], lat, lon),
                    "rank": {"large_airport": 0, "medium_airport": 1, "small_airport": 2}[t],
                }
                self.by_ident[ident] = a
                self.grid[(math.floor(lat), math.floor(lon))].append(a)
        self._tf = TimezoneFinder()
        self._tz = {}

    def near(self, lat, lon, radius_nm):
        out = []
        la, lo = math.floor(lat), math.floor(lon)
        for i in (-1, 0, 1):
            for j in (-1, 0, 1):
                for a in self.grid.get((la + i, lo + j), ()):
                    d = nm(lat, lon, a["lat"], a["lon"])
                    if d <= radius_nm:
                        out.append((d, a))
        out.sort(key=lambda x: x[0])
        return out

    def snap_ground(self, lat, lon):
        c = self.near(lat, lon, GROUND_SNAP_NM)
        return c[0][1] if c else None

    def snap_low_airborne(self, lat, lon, alt):
        if not isinstance(alt, (int, float)):
            return None
        for d, a in self.near(lat, lon, 20):
            agl = alt - a["elev"]
            if (d <= 8 and agl < 3000) or (d <= 20 and agl < 6000):
                return a
        return None

    def tz(self, a):
        k = a["ident"]
        if k not in self._tz:
            self._tz[k] = ZoneInfo(self._tf.timezone_at(lat=a["lat"], lng=a["lon"]) or "UTC")
        return self._tz[k]


def is_ground(p):
    alt, gs = p[3], p[4]
    if alt == "ground":
        return True
    return gs is not None and gs < 40 and (alt is None or (isinstance(alt, (int, float)) and alt < 15000))


def build_items(pts, ap):
    """Ordered list of ('at', t, airport, inferred) and ('air', t, lat, lon)."""
    items = []
    prev = None
    for p in pts:
        t, lat, lon, alt = p[0], p[1], p[2], p[3]
        g = is_ground(p)
        if prev is not None and t - prev[0] > GAP_S:
            if not is_ground(prev):
                a = ap.snap_low_airborne(prev[1], prev[2], prev[3])
                if a:
                    items.append(("at", prev[0] + 1, a, True))
            if not g:
                a = ap.snap_low_airborne(lat, lon, alt)
                if a:
                    items.append(("at", t - 1, a, True))
        if g:
            a = ap.snap_ground(lat, lon)
            if a:
                items.append(("at", t, a, False))
        else:
            items.append(("air", t, lat, lon))
        prev = p
    return items


def build_stays(items, w_start, w_end):
    """Return list of dicts: airport, a, d, landing(bool)."""
    stays = []
    cur = None
    seen_any = False
    for idx, it in enumerate(items):
        if it[0] == "at":
            _, t, a, _inf = it
            if cur and cur["airport"] is a:
                cur["last"] = t
            else:
                if cur:
                    cur["d"] = min(t, cur["last"] + CAP_S)
                    stays.append(cur)
                cur = {"airport": a, "a": t if seen_any else max(w_start, t - EDGE_CAP_S), "last": t, "landing": seen_any}
        else:
            _, t, lat, lon = it
            if cur:
                a = cur["airport"]
                dist = nm(a["lat"], a["lon"], lat, lon)
                # taxi/glitch: airborne blip near the field with the next 'at' item at the same field soon after
                if dist < GROUND_SNAP_NM:
                    nxt = next((x for x in items[idx + 1:idx + 40] if x[0] == "at"), None)
                    if nxt and nxt[2] is a and nxt[1] - t < 300:
                        continue
                cur["d"] = t if dist <= BRACKET_NM else min(t, cur["last"] + CAP_S)
                stays.append(cur)
                cur = None
        seen_any = True
    if cur:
        cur["d"] = min(w_end, cur["last"] + EDGE_CAP_S)
        stays.append(cur)
    return stays


def nights_from_stays(stays, ap, w_start, w_end):
    nights = {}
    for s in stays:
        tz = ap.tz(s["airport"])
        d0 = dt.datetime.fromtimestamp(s["a"], tz).date() - dt.timedelta(days=1)
        d1 = dt.datetime.fromtimestamp(s["d"], tz).date()
        d = d0
        while d <= d1:
            cutoff = dt.datetime.combine(d + dt.timedelta(days=1), dt.time(3, 0), tz).timestamp()
            if s["a"] <= cutoff < s["d"] and w_start <= cutoff <= w_end and d not in nights:
                nights[d] = s["airport"]
            d += dt.timedelta(days=1)
    return nights


def load_traces(trace_root):
    days = sorted(d for d in os.listdir(trace_root) if os.path.exists(os.path.join(trace_root, d, ".done")))
    per_hex = defaultdict(list)
    meta = {}
    for day in days:
        for fp in glob.glob(os.path.join(trace_root, day, "*.json")):
            hx = os.path.basename(fp)[:-5]
            with open(fp) as f:
                d = json.load(f)
            per_hex[hx].extend(d["pts"])
            meta[hx] = {k: d.get(k) for k in ("r", "t", "desc", "ownOp")}
    return days, per_hex, meta


def main():
    ap_ = argparse.ArgumentParser()
    ap_.add_argument("--candidates", default="candidates.csv")
    ap_.add_argument("--derive-candidates", action="store_true",
                     help="build the candidate list from trace metadata (no PDF available)")
    ap_.add_argument("--traces", default="traces")
    ap_.add_argument("--airports", default="data/airports.csv")
    ap_.add_argument("--runways", default="data/runways.csv")
    ap_.add_argument("--out", default="regional_base_candidates.csv")
    ap_.add_argument("--overnights", default="overnights.csv")
    ap_.add_argument("--summary", default="summary.md")
    a = ap_.parse_args()

    ap = Airports(a.airports, a.runways)
    days, per_hex, meta = load_traces(a.traces)
    w_start = dt.datetime.combine(dt.date.fromisoformat(days[0]), dt.time(0), dt.timezone.utc).timestamp()
    w_end = dt.datetime.combine(dt.date.fromisoformat(days[-1]) + dt.timedelta(days=1), dt.time(0),
                                dt.timezone.utc).timestamp()

    if a.derive_candidates:
        rows = [{"registration": m["r"] or "", "hex": hx, "model": m["desc"] or m["t"] or "",
                 "type_code": m["t"] or "", "registered_owner": m["ownOp"] or "",
                 "owner_city": "", "owner_state": ""}
                for hx, m in sorted(meta.items())]
        with open(a.candidates, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0]))
            w.writeheader()
            w.writerows(rows)
        print(f"derived {len(rows)} candidates -> {a.candidates}")

    with open(a.candidates, newline="") as f:
        cands = [r for r in csv.DictReader(f) if r.get("hex")]

    results, overnight_rows = [], []
    for c in cands:
        hx = c["hex"].strip().lower()
        pts = sorted({p[0]: p for p in per_hex.get(hx, [])}.values(), key=lambda p: p[0])
        row = {
            "registration": c.get("registration", ""), "hex": hx, "model": c.get("model", ""),
            "registered_owner": c.get("registered_owner", ""),
            "owner_city_state": ", ".join(x for x in (c.get("owner_city", ""), c.get("owner_state", "")) if x),
            "top_airport": "", "top_airport_share": 0.0, "nights_observed": 0, "nights_in_region": 0,
            "region_share": 0.0, "landings_in_region": 0, "first_seen": "", "last_seen": "",
            "landings_total": 0, "top_region_airport": "", "region_airports": "",
        }
        if pts:
            row["first_seen"] = dt.datetime.fromtimestamp(pts[0][0], dt.timezone.utc).date().isoformat()
            row["last_seen"] = dt.datetime.fromtimestamp(pts[-1][0], dt.timezone.utc).date().isoformat()
            stays = build_stays(build_items(pts, ap), w_start, w_end)
            nights = nights_from_stays(stays, ap, w_start, w_end)
            land = [s for s in stays if s["landing"]]
            row["landings_total"] = len(land)
            row["landings_in_region"] = sum(1 for s in land if s["airport"]["region"])
            if nights:
                cnt = Counter(x["ident"] for x in nights.values())
                top, n = cnt.most_common(1)[0]
                reg = Counter(x["ident"] for x in nights.values() if x["region"])
                row.update(
                    top_airport=top, top_airport_share=round(n / len(nights), 3),
                    nights_observed=len(nights), nights_in_region=sum(reg.values()),
                    region_share=round(sum(reg.values()) / len(nights), 3),
                    top_region_airport=reg.most_common(1)[0][0] if reg else "",
                )
                for d, x in sorted(nights.items()):
                    overnight_rows.append({"registration": row["registration"], "hex": hx, "night": d.isoformat(),
                                           "airport": x["ident"], "airport_name": x["name"],
                                           "in_region": int(x["region"])})
            reg_land = Counter(s["airport"]["ident"] for s in land if s["airport"]["region"])
            reg_night = Counter(x["ident"] for x in nights.values() if x["region"])
            keys = sorted(set(reg_land) | set(reg_night), key=lambda k: -(reg_night[k] * 100 + reg_land[k]))
            row["region_airports"] = " ".join(f"{k}:{reg_night[k]}n/{reg_land[k]}l" for k in keys)
        results.append(row)

    results.sort(key=lambda r: (-r["region_share"], -r["nights_observed"], -r["landings_in_region"]))
    with open(a.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(results[0]))
        w.writeheader()
        w.writerows(results)
    with open(a.overnights, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["registration", "hex", "night", "airport", "airport_name", "in_region"])
        w.writeheader()
        w.writerows(overnight_rows)

    write_summary(a.summary, results, overnight_rows, ap, days, len(cands), a)


def write_summary(path, results, overnight_rows, ap, days, n_cands, args):
    seen = [r for r in results if r["first_seen"]]
    active = [r for r in results if r["nights_in_region"] or r["landings_in_region"]]
    based = [r for r in results if r["region_share"] >= 0.5 and r["nights_observed"] >= 10]
    visitors = sorted((r for r in active if r not in based and r["landings_in_region"] >= 3),
                      key=lambda r: (-r["landings_in_region"], -r["nights_in_region"]))

    by_apt = defaultdict(lambda: {"based": 0, "aircraft": set(), "nights": 0, "landings": 0})
    for r in based:
        k = r["top_region_airport"] or r["top_airport"]
        by_apt[k]["based"] += 1
    for o in overnight_rows:
        if o["in_region"]:
            by_apt[o["airport"]]["nights"] += 1
            by_apt[o["airport"]]["aircraft"].add(o["hex"])
    for r in results:
        for tok in r["region_airports"].split():
            k, v = tok.split(":")
            by_apt[k]["landings"] += int(v.split("/")[1][:-1])

    def apt_label(k):
        a = ap.by_ident.get(k)
        return f"{k} ({a['city'] or a['name']}, {a['iso_region'][3:]})" if a else k

    L = []
    L.append("# ULR large-cabin aircraft: regional home-base finder\n")
    L.append(f"- History window: **{days[0]} to {days[-1]}** ({len(days)} days of adsb.lol globe_history)")
    L.append(f"- Candidates: **{n_cands}** (source: `{args.candidates}`); seen at least once in window: **{len(seen)}**")
    L.append("- Region: US-MT, US-ID, US-WY, US-WA east of -120.5 lon, US-UT north of 39.5 lat")
    L.append(f"- Aircraft with any in-region activity (overnight or landing): **{len(active)}**")
    L.append(f"- Likely based (region_share >= 0.5 and nights_observed >= 10): **{len(based)}**\n")

    L.append("## Likely based in region\n")
    L.append("| Registration | Hex | Model | Owner | Top airport | Top share | Nights obs | Nights in region | Region share | Landings in region |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for r in based:
        L.append(f"| {r['registration']} | {r['hex']} | {r['model']} | {r['registered_owner']} | {apt_label(r['top_airport'])} | "
                 f"{r['top_airport_share']:.2f} | {r['nights_observed']} | {r['nights_in_region']} | {r['region_share']:.2f} | {r['landings_in_region']} |")

    L.append("\n## Frequent visitors (>= 3 in-region landings, not classed as based)\n")
    L.append("Second-home, seasonal or charter traffic: high landings, low overnight share.\n")
    L.append("| Registration | Hex | Model | Owner | Top airport | Nights obs | Nights in region | Region share | Landings in region | In-region airports (nights/landings) |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for r in visitors:
        L.append(f"| {r['registration']} | {r['hex']} | {r['model']} | {r['registered_owner']} | {r['top_airport']} | {r['nights_observed']} | "
                 f"{r['nights_in_region']} | {r['region_share']:.2f} | {r['landings_in_region']} | {r['region_airports']} |")

    L.append("\n## Counts by in-region airport\n")
    L.append("| Airport | Likely-based aircraft | Distinct aircraft overnighting | Overnights | Landings |")
    L.append("|---|---|---|---|---|")
    for k, v in sorted(by_apt.items(), key=lambda kv: (-kv[1]["based"], -kv[1]["nights"], -kv[1]["landings"])):
        L.append(f"| {apt_label(k)} | {v['based']} | {len(v['aircraft'])} | {v['nights']} | {v['landings']} |")

    L.append("\n## Method notes and caveats\n")
    L.append("- Overnight = airport where the aircraft sits at 03:00 local (airport time zone). Ground stays are "
             "built from ground points snapped to airports within 3 NM, plus inferred landings/departures where "
             "the track ends/starts low near an airport across a > 20 min coverage gap.")
    L.append("- A stay with an unseen departure (next airborne point > 150 NM away) is capped at 36 h. A stay at "
             "the start or end of an aircraft's data extends at most 14 days before the first / after the last evidence (parked, transponder off).")
    L.append("- Airports considered: OurAirports large/medium airports and small airports with an open runway >= 4000 ft.")
    L.append("- Aircraft on PIA/LADD with rotating hex codes do not match their FAA hex and are invisible here.")
    L.append("- Rural MT/WY/ID receiver coverage is patchy; low-altitude legs into small fields may be missed.")
    with open(path, "w") as f:
        f.write("\n".join(L) + "\n")


if __name__ == "__main__":
    main()
