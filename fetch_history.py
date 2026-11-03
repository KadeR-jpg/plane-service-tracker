#!/usr/bin/env python3
"""Download adsb.lol daily globe_history archives and keep only target aircraft.

Each day is published as a GitHub release on adsblol/globe_history_<year>
(tag v<YYYY.MM.DD>-planes-readsb-prod-0) with assets
<tag>.tar.aa, <tag>.tar.ab, ... which concatenate into one tar. Inside, per-aircraft
traces live at ./traces/<last2hex>/trace_full_<hex>.json (gzip-compressed JSON).

The archive is streamed straight from curl into tarfile, so no raw archive ever
touches disk. Only matching traces are written, in a compacted form, to
traces/YYYY-MM-DD/<hex>.json. A day is complete when traces/YYYY-MM-DD/.done
exists; completed days are skipped on restart. Progress goes to progress.log.

Target selection:
  --candidates candidates.csv   hex set from the candidate list (column 'hex')
  --types GLF5,GLF6,...         interim mode: every US-registered (hex a*) trace
                                whose adsb.lol type code is in the list
"""
import argparse
import csv
import datetime as dt
import gzip
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import time
import zlib

BASE = "https://github.com/adsblol/globe_history_{year}/releases/download/{tag}/{tag}.tar.{part}"
TYPE_RE = re.compile(rb'"t":"([A-Z0-9]+)"')
TRACE_RE = re.compile(r"(?:^|/)traces/[0-9a-f]{2}/trace_full_([0-9a-f]{6})\.json$")
LOG = "progress.log"


def log(msg):
    line = f"{dt.datetime.now(dt.timezone.utc):%Y-%m-%dT%H:%M:%SZ} {msg}"
    print(line, flush=True)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def available_days(year):
    """Dates with a prod release, read from git tags (no API needed)."""
    out = subprocess.run(
        ["git", "ls-remote", "--tags", f"https://github.com/adsblol/globe_history_{year}"],
        capture_output=True, text=True, check=True).stdout
    days = set()
    for m in re.finditer(r"refs/tags/v(\d{4})\.(\d{2})\.(\d{2})-planes-readsb-prod-0$", out, re.M):
        days.add(dt.date(int(m[1]), int(m[2]), int(m[3])))
    return days


def part_urls(day):
    tag = f"v{day:%Y.%m.%d}-planes-readsb-prod-0"
    urls = []
    for i in range(26 * 26):
        part = chr(97 + i // 26) + chr(97 + i % 26)
        url = BASE.format(year=day.year, tag=tag, part=part)
        code = subprocess.run(["curl", "-sSL", "-o", "/dev/null", "-r", "0-0", "-w", "%{http_code}", url],
                              capture_output=True, text=True).stdout.strip()
        if code in ("200", "206"):
            urls.append(url)
        else:
            break
    return urls


def is_ground(p):
    alt, gs = p[3], p[4]
    if alt == "ground":
        return True
    return gs is not None and gs < 40 and (alt is None or (isinstance(alt, (int, float)) and alt < 15000))


def compact(d):
    """Absolute timestamps, keep [t, lat, lon, alt, gs]; thin dense airborne/ground runs."""
    t0 = d.get("timestamp", 0)
    raw = [p for p in d.get("trace", []) if p[1] is not None and p[2] is not None]
    pts = [[round(t0 + p[0], 1), round(p[1], 5), round(p[2], 5), p[3], p[4]] for p in raw]
    n = len(pts)
    keep, last_t = [], None
    for i, p in enumerate(pts):
        g = is_ground(p)
        edge = (i == 0 or i == n - 1
                or g != is_ground(pts[i - 1]) or g != is_ground(pts[i + 1])
                or pts[i + 1][0] - p[0] > 60 or p[0] - pts[i - 1][0] > 60)
        step = 60 if g else 20
        if edge or last_t is None or p[0] - last_t >= step:
            keep.append(p)
            last_t = p[0]
    return {k: d.get(k) for k in ("icao", "r", "t", "desc", "ownOp")} | {"pts": keep}


def fetch_day(day, outroot, hexset, types):
    outdir = os.path.join(outroot, day.isoformat())
    if os.path.exists(os.path.join(outdir, ".done")):
        return "skip"
    urls = part_urls(day)
    if not urls:
        log(f"{day} no archive parts found")
        return "missing"
    tmp = outdir + ".partial"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    t_start = time.time()
    proc = subprocess.Popen(["curl", "-sSfL", "--retry", "3"] + urls, stdout=subprocess.PIPE)
    n_kept = n_seen = 0
    try:
        with tarfile.open(fileobj=proc.stdout, mode="r|") as tf:
            for m in tf:
                if not m.isfile():
                    continue
                mm = TRACE_RE.search(m.name)
                if not mm:
                    continue
                hx = mm[1]
                n_seen += 1
                if hexset is not None and hx not in hexset:
                    continue
                if types is not None and not hx.startswith("a"):
                    continue
                data = tf.extractfile(m).read()
                if types is not None:
                    # type code sits in the JSON header; inflate only the first bytes
                    head = zlib.decompressobj(31).decompress(data, 4096) if data[:2] == b"\x1f\x8b" else data[:4096]
                    tm = TYPE_RE.search(head)
                    if not tm or tm[1].decode() not in types:
                        continue
                if data[:2] == b"\x1f\x8b":
                    data = gzip.decompress(data)
                d = json.loads(data)
                if types is not None and d.get("t") not in types:
                    continue
                c = compact(d)
                if not c["pts"]:
                    continue
                with open(os.path.join(tmp, f"{hx}.json"), "w") as f:
                    json.dump(c, f, separators=(",", ":"))
                n_kept += 1
    finally:
        proc.stdout.close()
        rc = proc.wait()
    if rc != 0 or n_seen == 0:
        shutil.rmtree(tmp, ignore_errors=True)
        log(f"{day} FAILED curl_rc={rc} traces_seen={n_seen}")
        return "fail"
    with open(os.path.join(tmp, ".done"), "w") as f:
        f.write(f"{n_kept} {n_seen}\n")
    shutil.rmtree(outdir, ignore_errors=True)
    os.rename(tmp, outdir)
    log(f"{day} ok parts={len(urls)} traces_in_archive={n_seen} kept={n_kept} secs={time.time() - t_start:.0f}")
    return "ok"


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--candidates")
    g.add_argument("--types")
    ap.add_argument("--days", type=int, default=90, help="number of most recent available days")
    ap.add_argument("--end", help="last day YYYY-MM-DD (default: latest available)")
    ap.add_argument("--out", default="traces")
    a = ap.parse_args()

    hexset = types = None
    if a.candidates:
        with open(a.candidates) as f:
            hexset = {r["hex"].strip().lower() for r in csv.DictReader(f) if r.get("hex")}
        log(f"start: {len(hexset)} candidate hex codes")
    else:
        types = set(a.types.split(","))
        log(f"start: type mode {sorted(types)}")

    today = dt.date.today()
    days = available_days(today.year) | (available_days(today.year - 1) if a.days > 300 or today.month <= 4 else set())
    end = dt.date.fromisoformat(a.end) if a.end else max(days)
    want = [end - dt.timedelta(days=i) for i in range(a.days)]
    want = sorted(d for d in want if d in days)
    log(f"window {want[0]} .. {want[-1]} ({len(want)} days available)")
    for day in want:
        for attempt in range(3):
            r = fetch_day(day, a.out, hexset, types)
            if r != "fail":
                break
            time.sleep(5 * (attempt + 1))
    log("fetch complete")


if __name__ == "__main__":
    sys.exit(main())
