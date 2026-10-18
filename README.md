# Timetable

Printed-style timetables for any Sydney Trains or NSW TrainLink line, or a
corridor of lines together (T4 + South Coast, T9 + Central Coast...), on any
day the published GTFS covers. Trains from every line on the corridor are
interleaved in the order they run.

- `tools/build.py` turns the Sydney Trains GTFS (which also carries the
  intercity and regional trains) into small per-line, per-day files.
- `.github/workflows/build.yml` runs it daily and publishes the files to the
  `data` branch.
- `site/` is the static page (Cloudflare Pages, output dir `site`), reading
  the data from `raw.githubusercontent.com`.
- Corridors and timed changes (interchanges) are listed in `site/config.js`.

The GTFS is a rolling window about 30 days ahead, so a new timetable shows up
here once Transport for NSW loads it into the feed. `Probe feeds` (Actions)
reports how far each candidate feed reaches.

Needs the repository secret `TFNSW_KEY` (Transport for NSW Open Data API key).

Data: Transport for NSW Open Data, CC BY 4.0.
