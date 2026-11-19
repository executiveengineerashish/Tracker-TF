#!/usr/bin/env python3
"""
Import the TRACKING_OF_TRANSFORMERs Excel workbook into Supabase.

Usage:
  python scripts/import_excel.py TRACKING.xlsx --dry-run          # parse only, writes preview CSV
  python scripts/import_excel.py TRACKING.xlsx                    # upload to Supabase

Needs env vars (see .env.example):  SUPABASE_URL, SUPABASE_SERVICE_KEY
The service key bypasses RLS -> keep it on YOUR computer only, never in GitHub / web page.
Safe to re-run: rows are upserted on pr_no, so nothing gets duplicated.
"""
import argparse, csv, datetime as dt, os, re, sys
import openpyxl

# --- sheets to read (monthly data sheets only; skips SUMMARY, daily, PR SEARCH, logs...) ---
def is_data_sheet(name: str) -> bool:
    n = name.upper()
    if any(k in n for k in ("SUMMARY", "PR SEARCH", "CALLLOGS", "USERS", "DRIVERMASTER", "MAPPING")):
        return False
    if re.match(r"^\d{2}\.\d{2}\.\d{4}$", name.strip()):      # daily sheets like 01.11.2026
        return False
    return bool(re.search(r"(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)", n))

# --- header text (normalised) -> database column ---
ALIASES = {
    "workshop": "workshop", "circle": "workshop",
    "division": "division", "subdivision": "subdivision", "substation": "substation", "feeder": "feeder",
    "date of damage": "date_of_damage", "place of damage": "place_of_damage",
    "did no": "did_no",
    "capacity": "capacity_kva", "capicity in kva": "capacity_kva", "capacity in kva": "capacity_kva",
    "complain number": "complain_no", "complain date": "complain_date",
    "pr no": "pr_no", "pr date": "pr_date",
    "je name": "je_name", "je name(d)": "je_name", "je mobile": "je_mobile", "je mobile number": "je_mobile",
    "issued to firm": "issued_to_firm", "issue date": "issue_date",
    "driver name": "driver_name", "driver mobile": "driver_mobile",
    "replacement date": "replacement_date",
    "tx return date": "tx_return_date", "damage tx return date to workshop": "tx_return_date",
    "observation during dtc": "observation_dtc", "cause of damage": "cause_of_damage",
    "ht protection": "ht_protection", "lt protection": "lt_protection",
    "dtc number": "dtc_number", "dtc date": "dtc_date",
    "firm name issued to repairing": "repair_firm", "date of issue to firm": "repair_issue_date",
    "job number": "job_number", "repaired date": "repaired_date", "testing date": "testing_date",
    "inclusion in kitty date": "kitty_date", "reissue date": "reissue_date",
    "reissue dt location": "reissue_location", "reissue feeder": "reissue_feeder",
    "reissue substation": "reissue_substation", "reissue division": "reissue_division",
}
DATE_COLS = {"date_of_damage", "complain_date", "pr_date", "issue_date", "replacement_date",
             "tx_return_date", "dtc_date", "repair_issue_date", "repaired_date", "testing_date",
             "kitty_date", "reissue_date"}
TEXT_COLS = {"workshop", "division", "subdivision", "substation", "feeder", "place_of_damage", "did_no",
             "complain_no", "pr_no", "je_name", "je_mobile", "issued_to_firm", "driver_name", "driver_mobile",
             "observation_dtc", "cause_of_damage", "ht_protection", "lt_protection", "dtc_number",
             "repair_firm", "job_number", "reissue_location", "reissue_feeder", "reissue_substation",
             "reissue_division"}
ALL_COLS = ["pr_no", "workshop", "division", "subdivision", "substation", "feeder", "date_of_damage",
            "place_of_damage", "did_no", "capacity_kva", "complain_no", "complain_date", "pr_date",
            "je_name", "je_mobile", "issued_to_firm", "issue_date", "driver_name", "driver_mobile",
            "replacement_date", "tx_return_date", "observation_dtc", "cause_of_damage", "ht_protection",
            "lt_protection", "dtc_number", "dtc_date", "repair_firm", "repair_issue_date", "job_number",
            "repaired_date", "testing_date", "kitty_date", "reissue_date", "reissue_location",
            "reissue_feeder", "reissue_substation", "reissue_division", "source_sheet"]

def norm(h):
    return " ".join(str(h).split()).lower() if h is not None else ""

def parse_date(v):
    if v is None or v == "": return None
    if isinstance(v, dt.datetime):
        return v.date().isoformat() if v.year >= 2000 else None   # 1900-xx = time-only junk
    if isinstance(v, dt.date): return v.isoformat()
    s = str(v).strip()
    for f in ("%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d.%m.%y", "%d/%m/%y"):
        try:
            d = dt.datetime.strptime(s, f).date()
            return d.isoformat() if 2000 <= d.year <= 2100 else None
        except ValueError: pass
    return None

def parse_text(v):
    if v is None: return None
    if isinstance(v, float) and v.is_integer(): v = int(v)
    s = str(v).strip()
    return s or None

def parse_int(v):
    try: return int(float(v))
    except (TypeError, ValueError): return None

def read_workbook(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out, stats = {}, []
    for ws in wb:
        if not is_data_sheet(ws.title): continue
        rows = ws.iter_rows(values_only=True)
        header = next(rows, None)
        if not header: continue
        colmap = {}
        for i, h in enumerate(header):
            c = ALIASES.get(norm(h))
            if c and c not in colmap: colmap[c] = i
        if "pr_no" not in colmap and "pr_date" in colmap and colmap["pr_date"] > 0:
            colmap["pr_no"] = colmap["pr_date"] - 1      # blank "PR NO" header (e.g. SEP-2026): column just before PR DATE
        if "pr_no" not in colmap:
            print(f"  skip {ws.title}: no PR NO column"); continue
        n = 0
        for r in rows:
            rec = {c: None for c in ALL_COLS}
            for c, i in colmap.items():
                v = r[i] if i < len(r) else None
                rec[c] = parse_date(v) if c in DATE_COLS else parse_int(v) if c == "capacity_kva" else parse_text(v)
            if not rec["pr_no"] or not re.fullmatch(r"\d{6,}", rec["pr_no"]): continue
            if not rec["workshop"]: continue
            w = rec["workshop"].upper().replace("EDC", "").strip()      # old sheets say "EDC AZAMGARH"
            rec["workshop"] = w
            rec["source_sheet"] = ws.title.strip()
            out[rec["pr_no"]] = rec          # later sheet wins for a repeated PR number
            n += 1
        stats.append((ws.title, n))
    return list(out.values()), stats

def upload(rows, url, key, batch=100, start=0):
    import requests
    ep = url.rstrip("/") + "/rest/v1/transformer_cases?on_conflict=pr_no"
    h = {"apikey": key, "Content-Type": "application/json",
         "Prefer": "resolution=merge-duplicates,return=minimal"}
    # legacy service_role keys are JWTs and need a Bearer header; new sb_secret_ keys must NOT be sent as Bearer
    if not key.startswith("sb_"):
        h["Authorization"] = f"Bearer {key}"
    for i in range(start, len(rows), batch):
        r = None
        for attempt in range(1, 6):
            try:
                r = requests.post(ep, headers=h, json=rows[i:i + batch], timeout=30)
                if r.status_code < 300:
                    break
                print(f"  row {i}: HTTP {r.status_code}, retry {attempt}/5 ...")
            except requests.exceptions.RequestException as e:
                print(f"  row {i}: network problem, retry {attempt}/5 ...")
            import time; time.sleep(3 * attempt)
        if r is None or r.status_code >= 300:
            sys.exit(f"Upload failed at row {i}: {(r.status_code, r.text[:400]) if r is not None else 'no response'}")
        print(f"  uploaded {min(i + batch, len(rows))}/{len(rows)}")

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx"); ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--start", type=int, default=0, help="skip rows already uploaded")
    a = ap.parse_args()
    rows, stats = read_workbook(a.xlsx)
    for s, n in stats: print(f"  {s:<18}{n:>6} rows")
    print(f"Unique PR numbers: {len(rows)}")
    if a.dry_run:
        with open("import_preview.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=ALL_COLS); w.writeheader(); w.writerows(rows)
        print("Wrote import_preview.csv — open it and check before uploading.")
    else:
        url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
        if not url or not key: sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY")
        upload(rows, url, key, start=a.start)
        print("Done.")
