"""Trips per agency / route type / line in the full TfNSW bundle on dates
either side of 15/11, to see where (if anywhere) the new timetable is."""
import csv, io, os, zipfile
from collections import Counter, defaultdict
from datetime import date
import requests

KEY = os.environ["TFNSW_KEY"].strip()
URL = "https://api.transport.nsw.gov.au/v1/publictransport/timetables/complete/gtfs"
DATES = [date(2026, 11, d) for d in (8, 9, 15, 16, 17, 22, 23)] + [date(2026, 12, 7)]

with requests.get(URL, headers={"Authorization": f"apikey {KEY}"}, stream=True, timeout=900) as r:
    r.raise_for_status()
    with open("bundle.zip", "wb") as f:
        for c in r.iter_content(1 << 20):
            f.write(c)
z = zipfile.ZipFile("bundle.zip")
R = lambda n: csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig"))
agency = {a["agency_id"]: a["agency_name"] for a in R("agency.txt")}
routes = {r["route_id"]: r for r in R("routes.txt")}
cal = {c["service_id"]: c for c in R("calendar.txt")}
cd = defaultdict(dict)
for c in R("calendar_dates.txt"):
    cd[c["service_id"]][c["date"]] = c["exception_type"]
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

def runs(sid, d):
    ds = d.strftime("%Y%m%d")
    if ds in cd.get(sid, {}):
        return cd[sid][ds] == "1"
    c = cal.get(sid)
    return bool(c) and c["start_date"] <= ds <= c["end_date"] and c[DAYS[d.weekday()]] == "1"

# skip buses, coaches and ferries
rail_types = {"0", "1", "2", "12", "100", "101", "102", "106", "109", "400", "401", "900"}
by_agency = defaultdict(Counter)
by_line = defaultdict(Counter)
sample = {}
for t in R("trips.txt"):
    r = routes.get(t["route_id"])
    if not r or r["route_type"] not in rail_types:
        continue
    a = agency.get(r["agency_id"], r["agency_id"])
    for d in DATES:
        if runs(t["service_id"], d):
            by_agency[d][(a, r["route_type"])] += 1
            by_line[d][(a, r["route_short_name"] or r["route_long_name"][:30])] += 1
            sample.setdefault((a, d), t["trip_id"])
for d in DATES:
    print(f"\n{d} {d.strftime('%a')}")
    for k, v in sorted(by_agency[d].items()):
        print(f"  {k} {v}")
    print("  lines:", ", ".join(f"{a[:14]}/{l}:{n}" for (a, l), n in sorted(by_line[d].items())))
print("\nsample trip ids:", {f"{a} {d}": t for (a, d), t in sample.items() if "Sydney Trains" in a})
