"""
Turn the Sydney Trains GTFS into the files the site reads.

    python tools/build.py --gtfs sydneytrains.zip --out out

Writes
  out/index.json              lines, their dates and which file holds each date
  out/stations.json           [[name, lat, lon], ...]; trips refer to stations by index
  out/lines/<line>/<hash>.json   one service day of a line (days with identical
                                 trains share a file)

A line file is {"trips": [trip, ...]} with each trip
  {"r": run number, "d": "up"|"down", "h": headsign, "v": set type (e.g. "B8"),
   "b": formed by, "f": forms (each [run, 1 if it carries passengers else 0]),
   "s": [[station, arr, dwell, platform, flag], ...]}
arr in seconds after midnight of the service day (can pass 24:00), dwell in
seconds (dep = arr + dwell); trailing 0 / "" values are left off; flag
"" = stops, "p" = passes, "d" = sets down only, "u" = picks up only. Only the
part of a trip that carries passengers is kept, so an "Empty Train" that runs in
service for part of its journey still shows for that part.

The Sydney Trains feed also carries the NSW TrainLink intercity and regional
trains (as Sydney Trains sees them), so it's the only feed needed. Its regional
trains are only right inside Sydney Trains' own area, so they're cut to that.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import time
import zipfile
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

SYDNEY = ZoneInfo("Australia/Sydney")
CENTRAL = (-33.8832, 151.2065)
DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
REGIONAL = {"NRC", "NRW", "STH", "WST"}   # NSW TrainLink long-distance trains


def rows(z: zipfile.ZipFile, name: str):
    if name not in z.namelist():
        return iter(())
    return csv.DictReader(io.TextIOWrapper(z.open(name), "utf-8-sig"))


def secs(t: str) -> int:
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def dist_km(a, b) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    x = (lo2 - lo1) * math.cos((la1 + la2) / 2)
    return 6371 * math.hypot(x, la2 - la1)


def ymd(s: str) -> date:
    return date(int(s[:4]), int(s[4:6]), int(s[6:]))


def service_dates(z) -> dict[str, set[date]]:
    out: dict[str, set[date]] = defaultdict(set)
    for c in rows(z, "calendar.txt"):
        d, end = ymd(c["start_date"]), ymd(c["end_date"])
        while d <= end:
            if c[DAYS[d.weekday()]] == "1":
                out[c["service_id"]].add(d)
            d += timedelta(days=1)
    for c in rows(z, "calendar_dates.txt"):
        d = ymd(c["date"])
        (out[c["service_id"]].add if c["exception_type"] == "1" else out[c["service_id"]].discard)(d)
    return out

LETTERS = "ABCDEFGHJKLMNPRSTUVWXYZ"   # run suffixes skip I, O and Q


def link_workings(workings, span) -> dict:
    """{(trip, day): (formed-by, forms)} with each as [run, carries passengers 0/1].
    A train's day is a GTFS block; trips without one are linked to the same
    run number with the next suffix letter (322C forms 322D), the usual
    pattern for suburban runs."""
    by_block = defaultdict(list)
    by_run = defaultdict(list)
    for tid, (run, block, days) in workings.items():
        if tid not in span:
            continue
        for d in days:
            if block:
                by_block[(block, d)].append(tid)
            else:
                by_run[(run[:-1], d)].append(tid)
    out = {}
    def link(a, b, d):
        pa, pb = out.get((a, d), [None, None]), out.get((b, d), [None, None])
        pa[1] = [workings[b][0], int(span[b][2])]
        pb[0] = [workings[a][0], int(span[a][2])]
        out[(a, d)], out[(b, d)] = pa, pb
    for (block, d), tids in by_block.items():
        tids.sort(key=lambda t: span[t][0])
        for a, b in zip(tids, tids[1:]):
            link(a, b, d)
    for (stem, d), tids in by_run.items():
        by_suffix = {workings[t][0][-1]: t for t in tids}
        for t in tids:
            suffix = workings[t][0][-1]
            if suffix in LETTERS and LETTERS.index(suffix) + 1 < len(LETTERS):
                n = by_suffix.get(LETTERS[LETTERS.index(suffix) + 1])
                if n and span[n][0] >= span[t][1] and out.get((t, d), [None, None])[1] is None:
                    link(t, n, d)
    return {k: tuple(v) for k, v in out.items()}


def build(gtfs: Path, out: Path, today: date | None = None):
    z = zipfile.ZipFile(gtfs)
    today = today or datetime.now(SYDNEY).date()

    # stations: platforms roll up to their station; platform number from the name
    raw = {s["stop_id"]: s for s in rows(z, "stops.txt")}
    stations, station_ix, stop_station, stop_platform = [], {}, {}, {}
    for sid, s in raw.items():
        parent = raw.get(s.get("parent_station") or "", s)
        name = re.sub(r"\s+Station$", "", parent["stop_name"].strip())
        if name not in station_ix:
            station_ix[name] = len(stations)
            stations.append([name, round(float(parent["stop_lat"]), 5), round(float(parent["stop_lon"]), 5)])
        stop_station[sid] = station_ix[name]
        m = re.search(r"Platform\s+(\S+)", s["stop_name"])
        stop_platform[sid] = (s.get("platform_code") or (m.group(1) if m else "")).strip()

    routes = {r["route_id"]: r for r in rows(z, "routes.txt")}
    sets = {v["vehicle_category_id"]: v["vehicle_category_name"] for v in rows(z, "vehicle_categories.txt")}
    dates_of = service_dates(z)

    lines: dict[str, dict] = {}
    trip_meta = {}
    workings = {}  # every trip, empty ones too, for "formed by" / "forms": tid -> (run, block, days)
    for t in rows(z, "trips.txt"):
        r = routes.get(t["route_id"])
        line = (r or {}).get("route_short_name", "").strip()
        days = {d for d in dates_of.get(t["service_id"], ()) if d >= today}
        if not days:
            continue
        workings[t["trip_id"]] = (t["trip_id"].split(".")[0], (t.get("block_id") or "").strip(), days)
        if not line:
            continue  # non-revenue and out-of-service routes
        lines.setdefault(line, {"name": r.get("route_desc") or r.get("route_long_name") or line,
                                "colour": "#" + (r.get("route_color") or "888888"),
                                "network": "regional" if line in REGIONAL else
                                           "intercity" if r.get("agency_id") == "NSWTrains" else "suburban"})
        trip_meta[t["trip_id"]] = (line, t, days)

    stop_times = defaultdict(list)
    span = {}  # tid -> [first time, last time, carries passengers]
    for st in rows(z, "stop_times.txt"):
        tid = st["trip_id"]
        if tid in trip_meta:
            stop_times[tid].append(st)
        if tid in workings:
            a, d = st["arrival_time"] or st["departure_time"], st["departure_time"] or st["arrival_time"]
            if not a:
                continue
            e = span.setdefault(tid, [secs(d), secs(a), False])
            e[0], e[1] = min(e[0], secs(d)), max(e[1], secs(a))
            e[2] = e[2] or st["pickup_type"] != "1"
    links = link_workings(workings, span)

    by_line_day: dict[tuple[str, date], list] = defaultdict(list)
    for tid, (line, t, days) in trip_meta.items():
        sts = sorted(stop_times.get(tid, ()), key=lambda x: int(x["stop_sequence"]))
        board = [i for i, x in enumerate(sts) if x["pickup_type"] != "1"]
        alight = [i for i, x in enumerate(sts) if x["drop_off_type"] != "1"]
        if not board or not alight or alight[-1] <= board[0]:
            continue  # carries no passengers
        part = sts[board[0]:alight[-1] + 1]
        stops = []
        for x in part:
            if x["stop_id"] not in stop_station:
                continue
            if stations[stop_station[x["stop_id"]]][0].endswith(" Bus") and x["pickup_type"] == "1" and x["drop_off_type"] == "1":
                # Sydney Trains times trains past closed stations (Wallerawang,
                # Raglan, Thirlmere...) using the coach stops that replaced them
                continue
            up, down = x["pickup_type"] != "1", x["drop_off_type"] != "1"
            flag = "" if up and down else "d" if down else "u" if up else "p"
            arr, dep = secs(x["arrival_time"] or x["departure_time"]), secs(x["departure_time"] or x["arrival_time"])
            stop = [stop_station[x["stop_id"]], arr, dep - arr, stop_platform.get(x["stop_id"], ""), flag]
            while stop[-1] in ("", 0) and len(stop) > 2:
                stop.pop()  # trailing defaults: no dwell, no platform, stops
            stops.append(stop)
        if len(stops) < 2:
            continue
        if any(stations[x[0]][0].endswith(" Bus") for x in stops):
            continue  # a train calling at coach stops is a tourist special (Cockatoo Run via Robertson)
        first, last = stations[stops[0][0]], stations[stops[-1][0]]
        # up = towards Sydney (Central), as railways count it
        up = dist_km(last[1:], CENTRAL) < dist_km(first[1:], CENTRAL)
        headsign = (part[0].get("stop_headsign") or "").strip()
        if not headsign or headsign.lower() in ("empty train", "special"):
            headsign = last[0]
        trip = {"r": tid.split(".")[0], "d": "up" if up else "down", "h": headsign,
                "v": t.get("vehicle_category_id", ""), "s": stops}
        for d in days:
            prev, nxt = links.get((tid, d), (None, None))
            day_trip = dict(trip)
            if prev:
                day_trip["b"] = prev   # formed by: [run, carries passengers]
            if nxt:
                day_trip["f"] = nxt    # forms
            by_line_day[(line, d)].append(day_trip)

    # The regional trains as Sydney Trains has them are only right inside its
    # own (suburban and intercity) area, so cut them to their longest stretch
    # of stations Sydney Trains' own trains run through
    served = {s[0] for (line, d), trips in by_line_day.items() if line not in REGIONAL
              for t in trips for s in t["s"]}
    for (line, d), trips in by_line_day.items():
        if line not in REGIONAL:
            continue
        kept = []
        for t in trips:
            best, cur = None, None
            for i, s in enumerate(t["s"]):
                if s[0] in served:
                    cur = [cur[0], i] if cur else [i, i]
                    if not best or cur[1] - cur[0] > best[1] - best[0]:
                        best = list(cur)
                else:
                    cur = None
            if best and best[1] > best[0]:
                kept.append({**t, "s": t["s"][best[0]:best[1] + 1]})
        trips[:] = kept

    # one file per distinct service day of each line
    (out / "lines").mkdir(parents=True, exist_ok=True)
    index_lines = {}
    for (line, d), trips in sorted(by_line_day.items()):
        trips.sort(key=lambda x: (x["d"], x["s"][0][1], x["r"]))
        body = json.dumps({"trips": trips}, separators=(",", ":"))
        h = hashlib.sha1(body.encode()).hexdigest()[:12]
        p = out / "lines" / line / f"{h}.json"
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(body)
        e = index_lines.setdefault(line, {**lines[line], "dates": {}})
        e["dates"][d.isoformat()] = h
    used = {s for (line, d), trips in by_line_day.items() for t in trips for s, *_ in t["s"]}
    (out / "stations.json").write_text(json.dumps(stations, separators=(",", ":")))
    all_dates = sorted({d for e in index_lines.values() for d in e["dates"]})
    index = {
        "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": gtfs.name,
        "first": all_dates[0] if all_dates else None,
        "last": all_dates[-1] if all_dates else None,
        "sets": {k: v for k, v in sets.items() if not k.endswith("car")},
        "lines": index_lines,
    }
    (out / "index.json").write_text(json.dumps(index, separators=(",", ":")))
    n_files = sum(1 for _ in (out / "lines").rglob("*.json"))
    print(f"{len(index_lines)} lines, {len(all_dates)} days ({index['first']} to {index['last']}), "
          f"{n_files} line files, {len(used)} stations used")
    return index


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--gtfs", type=Path, required=True)
    p.add_argument("--out", type=Path, default=Path("out"))
    p.add_argument("--today", help="first date to keep (YYYY-MM-DD; default today in Sydney)")
    a = p.parse_args()
    build(a.gtfs, a.out, date.fromisoformat(a.today) if a.today else None)
