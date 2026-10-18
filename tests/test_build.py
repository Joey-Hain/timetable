"""A tiny GTFS through tools/build.py: passenger trimming, flags, direction,
dates and shared files for identical days."""
import json, sys, tempfile, zipfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import build  # noqa: E402

FILES = {
    "stops.txt": "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station\n"
                 "C,Central Station,-33.8832,151.2065,1,\n"
                 "C1,Central Station Platform 1,-33.8832,151.2065,0,C\n"
                 "R,Redfern Station,-33.8916,151.1985,1,\n"
                 "R1,Redfern Station Platform 3,-33.8916,151.1985,0,R\n"
                 "S,Sydenham Station,-33.9150,151.1670,1,\n"
                 "S1,Sydenham Station Platform 2,-33.9150,151.1670,0,S\n"
                 "H,Hurstville Station,-33.9670,151.1020,1,\n"
                 "H1,Hurstville Station Platform 1,-33.9670,151.1020,0,H\n",
    "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_desc,route_type,route_color\n"
                  "R4,SydneyTrains,T4,City to Hurstville,T4 Illawarra Line,2,005AA3\n"
                  "NR,SydneyTrains,,Non Revenue,Non Revenue trips,2,888888\n",
    "vehicle_categories.txt": "vehicle_category_id,vehicle_category_name\nT8,8 car Tangara\n",
    "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
                    "WD,1,1,1,1,1,0,0,20261116,20261122\n",
    "trips.txt": "route_id,service_id,trip_id,trip_headsign,direction_id,vehicle_category_id\n"
                 "R4,WD,10A.1.1.1.T.8.1,Empty Train,0,T8\n"
                 "R4,WD,11B.1.1.1.T.8.2,Central,1,T8\n"
                 "NR,WD,99X.1.1.1.T.8.3,Empty Train,0,T8\n",
    "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence,stop_headsign,pickup_type,drop_off_type\n"
                      # empty to Central, then in service, passes Sydenham, ends empty past Hurstville
                      "10A.1.1.1.T.8.1,08:00:00,08:02:00,C1,1,Hurstville,0,1\n"
                      "10A.1.1.1.T.8.1,08:05:00,08:05:30,R1,2,Hurstville,0,0\n"
                      "10A.1.1.1.T.8.1,08:09:00,08:09:00,S1,3,Hurstville,1,1\n"
                      "10A.1.1.1.T.8.1,08:20:00,08:24:00,H1,4,,1,0\n"
                      "11B.1.1.1.T.8.2,25:10:00,25:10:00,H1,1,Central,0,1\n"
                      "11B.1.1.1.T.8.2,25:30:00,25:31:00,S1,2,Central,0,0\n"
                      "11B.1.1.1.T.8.2,25:40:00,25:40:00,C1,3,,1,0\n"
                      "99X.1.1.1.T.8.3,09:00:00,09:00:00,C1,1,,1,1\n"
                      "99X.1.1.1.T.8.3,09:10:00,09:10:00,H1,2,,1,1\n",
}


def main():
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        with zipfile.ZipFile(d / "g.zip", "w") as z:
            for n, body in FILES.items():
                z.writestr(n, body)
        idx = build.build(d / "g.zip", d / "out", today=date(2026, 11, 17))
        st = [s[0] for s in json.loads((d / "out" / "stations.json").read_text())]
        t4 = idx["lines"]["T4"]
        assert sorted(idx["lines"]) == ["ECS", "T4"], "non-revenue route only as empty trains"
        assert sorted(t4["dates"]) == ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"], t4["dates"]
        assert len(set(t4["dates"].values())) == 1, "identical days share one file"
        trips = json.loads((d / "out" / "lines" / "T4" / f"{t4['dates']['2026-11-17']}.json").read_text())["trips"]
        down = next(t for t in trips if t["r"] == "10A")
        up = next(t for t in trips if t["r"] == "11B")
        assert down["d"] == "down" and up["d"] == "up"
        assert down["h"] == "Hurstville" and down["v"] == "T8"
        assert [st[s[0]] for s in down["s"]] == ["Sydney Terminal", "Redfern", "Sydenham", "Hurstville"]
        assert down["s"][0] == [st.index("Sydney Terminal"), 8 * 3600, 120, "1", "u"], down["s"][0]
        assert down["s"][1] == [st.index("Redfern"), 8 * 3600 + 300, 30, "3"], down["s"][1]
        assert down["s"][2][-1] == "p", "passes Sydenham"
        assert up["s"][0][1] == 25 * 3600 + 600, "times past midnight kept"
        ecs = json.loads((d / "out" / "lines" / "ECS" / f"{idx['lines']['ECS']['dates']['2026-11-17']}.json").read_text())["trips"]
        assert [t["r"] for t in ecs] == ["99X"] and all(x[-1] == "p" for x in ecs[0]["s"])
        print("ok")


if __name__ == "__main__":
    main()
