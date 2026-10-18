"""Which TfNSW GTFS feeds reach how far ahead? Downloads each candidate and
prints its calendar range and the number of rail trips per date."""
import csv, io, os, sys, zipfile
from collections import Counter
from datetime import date, timedelta
import requests

KEY = os.environ["TFNSW_KEY"].strip()
BASE = "https://api.transport.nsw.gov.au"
CANDIDATES = sys.argv[1:] or [
    "/v1/gtfs/schedule/sydneytrains",
    "/v1/gtfs/schedule/nswtrains",
    "/v1/publictransport/timetables/complete/gtfs",
]


def rows(z, name):
    if name not in z.namelist():
        return []
    return csv.DictReader(io.TextIOWrapper(z.open(name), "utf-8-sig"))


for path in CANDIDATES:
    print(f"\n## {path}", flush=True)
    out = "probe.zip"
    try:
        with requests.get(BASE + path, headers={"Authorization": f"apikey {KEY}"}, stream=True, timeout=600) as r:
            print("status", r.status_code, r.headers.get("content-type"))
            r.raise_for_status()
            with open(out, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
    except Exception as e:
        print("failed:", e)
        continue
    print(f"size {os.path.getsize(out) / 1e6:.1f} MB")
    z = zipfile.ZipFile(out)
    print("files", z.namelist())
    agencies = {a["agency_id"]: a["agency_name"] for a in rows(z, "agency.txt")}
    rail = {a for a, n in agencies.items() if any(k in n for k in ("Sydney Trains", "NSW TrainLink", "Metro"))}
    print("rail agencies", {a: agencies[a] for a in rail} if len(agencies) > 3 else agencies)
    routes = {r["route_id"] for r in rows(z, "routes.txt") if len(agencies) <= 3 or r.get("agency_id") in rail}
    trips = Counter(t["service_id"] for t in rows(z, "trips.txt") if t["route_id"] in routes)
    print("rail trips", sum(trips.values()), "services", len(trips))
    per_day = Counter()
    lo, hi = "99999999", "0"
    for c in rows(z, "calendar.txt"):
        if c["service_id"] not in trips:
            continue
        lo, hi = min(lo, c["start_date"]), max(hi, c["end_date"])
        d0 = date(int(c["start_date"][:4]), int(c["start_date"][4:6]), int(c["start_date"][6:]))
        d1 = date(int(c["end_date"][:4]), int(c["end_date"][4:6]), int(c["end_date"][6:]))
        d = d0
        days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        while d <= d1:
            if c[days[d.weekday()]] == "1":
                per_day[d.isoformat()] += trips[c["service_id"]]
            d += timedelta(days=1)
    for c in rows(z, "calendar_dates.txt"):
        if c["service_id"] in trips:
            k = f"{c['date'][:4]}-{c['date'][4:6]}-{c['date'][6:]}"
            per_day[k] += trips[c["service_id"]] * (1 if c["exception_type"] == "1" else -1)
    print("calendar", lo, "to", hi)
    for k in sorted(per_day):
        if k >= "2026-10-18":
            print(f"  {k} {per_day[k]}")
    os.remove(out)
