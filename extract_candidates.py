#!/usr/bin/env python3
"""Extract BSJC_FAA_ULR_LargeCabin_Candidate_List.pdf -> candidates.csv.

Output columns: registration, hex, model, registered_owner, owner_city, owner_state.
Hex codes are normalized to lowercase 6-character strings; rows without a hex are dropped.

Strategy: pdfplumber table extraction with header-name mapping; if no ruled
table is found, assign words to columns by the x-position of the header labels;
last resort is line parsing of the text layer
(N-number + 6-hex anchored, remaining fields split on runs of 2+ spaces).
Check the printed counts against the PDF before relying on the output.
"""
import argparse
import csv
import re
import sys

import pdfplumber

OUT_FIELDS = ["registration", "hex", "model", "registered_owner", "owner_city", "owner_state"]
HEADER_KEYS = {
    "registration": ("registration", "reg", "n-number", "n number", "nnumber", "tail"),
    "hex": ("mode s hex", "mode-s hex", "modes hex", "hex", "mode s code", "icao"),
    "model": ("faa model", "model", "aircraft model", "type"),
    "registered_owner": ("registered owner", "owner", "registrant", "name"),
    "owner_city": ("owner city", "city"),
    "owner_state": ("owner state", "state", "st"),
}
NNUM = re.compile(r"\bN?[1-9][0-9A-Z]{0,4}\b")
HEX = re.compile(r"\b[0-9A-Fa-f]{6}\b")


def norm_hex(v):
    v = (v or "").strip().lower().replace("0x", "")
    v = re.sub(r"[^0-9a-f]", "", v)
    return v.zfill(6) if 0 < len(v) <= 6 else ""


def norm_reg(v):
    v = (v or "").strip().upper().replace(" ", "")
    return v if not v or v.startswith("N") else "N" + v


def map_header(cells):
    cells = [(c or "").strip().lower().replace("\n", " ") for c in cells]
    m = {}
    for field, keys in HEADER_KEYS.items():
        for k in keys:  # most specific key first
            for i, c in enumerate(cells):
                if i in m.values():
                    continue
                if c == k or (len(k) > 3 and k in c):
                    m[field] = i
                    break
            if field in m:
                break
    return m if "hex" in m else None


def from_tables(pdf):
    rows, colmap = [], None
    for page in pdf.pages:
        for table in page.extract_tables():
            for r in table:
                hm = map_header(r)
                if hm:
                    colmap = hm
                    continue
                if not colmap:
                    continue
                rec = {f: (r[i] or "").replace("\n", " ").strip() if i < len(r) else "" for f, i in colmap.items()}
                rows.append(rec)
    return rows


def from_words(pdf):
    """Column assignment by x-position of header labels (tables without ruling lines)."""
    rows, cols = [], None  # cols: list of (x0, field)
    for page in pdf.pages:
        words = page.extract_words(keep_blank_chars=False, use_text_flow=False)
        lines = {}
        for w in words:
            lines.setdefault(round(w["top"] / 3), []).append(w)
        for key in sorted(lines):
            ws = sorted(lines[key], key=lambda w: w["x0"])
            # group words into labels separated by > 8pt gaps
            labels, curl = [], [ws[0]]
            for w in ws[1:]:
                if w["x0"] - curl[-1]["x1"] > 8:
                    labels.append(curl)
                    curl = [w]
                else:
                    curl.append(w)
            labels.append(curl)
            texts = [" ".join(w["text"] for w in l) for l in labels]
            hm = map_header(texts)
            if hm:
                cols = sorted((labels[i][0]["x0"], f) for f, i in hm.items())
                continue
            if not cols:
                continue
            rec = {}
            for w in ws:
                field = cols[0][1]
                for x0, f in cols:
                    if w["x0"] + 2 >= x0:
                        field = f
                rec[field] = (rec.get(field, "") + " " + w["text"]).strip()
            if rec.get("hex") or rec.get("registration"):
                rows.append(rec)
    return rows


def from_text(pdf):
    rows = []
    for page in pdf.pages:
        for line in (page.extract_text(layout=True) or "").splitlines():
            h = HEX.findall(line)
            n = NNUM.search(line)
            if not h or not n:
                continue
            parts = [p.strip() for p in re.split(r"\s{2,}", line.strip()) if p.strip()]
            rec = {"registration": n.group(0), "hex": h[-1]}
            rest = [p for p in parts if p != n.group(0) and p.lower() != h[-1].lower()]
            if rest and re.fullmatch(r"[A-Z]{2}", rest[-1]):
                rec["owner_state"] = rest.pop()
            for f in ("model", "registered_owner", "owner_city"):
                if rest:
                    rec[f] = rest.pop(0)
            rows.append(rec)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", nargs="?", default="BSJC_FAA_ULR_LargeCabin_Candidate_List.pdf")
    ap.add_argument("-o", "--out", default="candidates.csv")
    a = ap.parse_args()
    with pdfplumber.open(a.pdf) as pdf:
        raw = from_tables(pdf)
        method = "tables"
        if not raw:
            raw, method = from_words(pdf), "words"
        if not raw:
            raw, method = from_text(pdf), "text"
    out, seen, dropped = [], set(), 0
    for r in raw:
        hx = norm_hex(r.get("hex"))
        if len(hx) != 6:
            dropped += 1
            continue
        if hx in seen:
            continue
        seen.add(hx)
        out.append({"registration": norm_reg(r.get("registration")), "hex": hx,
                    "model": r.get("model", ""), "registered_owner": r.get("registered_owner", ""),
                    "owner_city": r.get("owner_city", ""), "owner_state": r.get("owner_state", "")})
    with open(a.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=OUT_FIELDS)
        w.writeheader()
        w.writerows(out)
    print(f"{method}: {len(raw)} rows parsed, {dropped} without hex dropped, {len(out)} unique -> {a.out}",
          file=sys.stderr)


if __name__ == "__main__":
    main()
