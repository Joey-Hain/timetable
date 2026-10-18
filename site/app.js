// Timetable: builds a classic station-by-train grid for a line or corridor on
// one day from the data the daily build publishes (see tools/build.py).
(() => {
  const C = window.TT_CONFIG;
  const $ = (id) => document.getElementById(id);
  const el = {
    line: $("line"), date: $("date"), dir: $("dir"), from: $("from"), to: $("to"),
    sfrom: $("sfrom"), sto: $("sto"),
    pass: $("pass"), plat: $("plat"), nonrev: $("nonrev"), run: $("run"),
    note: $("note"), table: $("table"), updated: $("updated"),
  };
  const state = { index: null, stations: null, files: new Map() };
  const params = new URLSearchParams(location.search);

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  // past midnight the service day carries on: 24:10, 25:30 (as railways count it)
  const hhmm = (t) => `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}`;
  const hhmmss = (t) => `${hhmm(t)}:${pad(t % 60)}`;

  async function getJSON(path) {
    if (!state.files.has(path)) {
      state.files.set(path, fetch(C.dataBase + path).then((r) => {
        if (!r.ok) throw new Error(`${path}: ${r.status}`);
        return r.json();
      }));
    }
    try { return await state.files.get(path); } catch (e) { state.files.delete(path); throw e; }
  }

  function sydneyToday() {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" });
    return p.format(new Date());
  }

  // ------------------------------------------------------------ options

  function lineLabel(code) {
    const name = state.index.lines[code].name || code;
    return name.startsWith(code) ? name : `${code} ${name}`;
  }

  function fillOptions() {
    const lines = state.index.lines;
    const groups = { suburban: [], intercity: [], regional: [] };
    for (const code of Object.keys(lines).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
      if (lines[code].network === "nonrev") continue;  // non-revenue trains: only alongside the others
      (groups[lines[code].network] || groups.suburban).push(code);
    }
    const corridors = C.corridors.filter((c) => c.lines.some((l) => lines[l]));
    const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
    el.line.innerHTML =
      `<optgroup label="Corridors">${corridors.map((c) => opt("c:" + c.id, c.name)).join("")}</optgroup>` +
      [["suburban", "Sydney Trains"], ["intercity", "Intercity"], ["regional", "Regional"]]
        .filter(([k]) => groups[k].length)
        .map(([k, label]) => `<optgroup label="${label}">${groups[k].map((c) => opt("l:" + c, lineLabel(c))).join("")}</optgroup>`)
        .join("") +
      `<optgroup label="Other">${lines.X ? opt("k:mtpv", "Freight & inspection") : ""}${opt("k:fleet", "Fleet breakdown")}</optgroup>`;
    const hours = [];
    for (let h = 0; h <= 28; h++) hours.push(h);
    const hl = (h) => `${pad(h)}:00`;
    el.from.innerHTML = hours.slice(0, 24).map((h) => opt(h, hl(h))).join("");
    el.to.innerHTML = hours.slice(1).map((h) => opt(h, h === 28 ? "End of service" : hl(h))).join("");
    el.to.value = "28";

    el.date.min = state.index.first;
    el.date.max = state.index.last;
    const today = sydneyToday();
    el.date.value = today >= state.index.first && today <= state.index.last ? today : state.index.first;

    for (const [k, e] of [["l", el.line], ["d", el.date], ["dir", el.dir], ["from", el.from], ["to", el.to]]) {
      const v = params.get(k);
      if (v && [...(e.options || [])].some((o) => o.value === v)) e.value = v;
      else if (v && e === el.date) e.value = v;
    }
    el.pass.checked = params.get("pass") === "1";
    el.plat.checked = params.get("plat") === "1";
    el.nonrev.checked = params.get("nr") === "1" || params.get("ecs") === "1";
    el.run.value = params.get("run") || "";
    if (!el.line.value) el.line.selectedIndex = 0;
  }

  function selectedLines() {
    const [kind, id] = el.line.value.split(":");
    if (kind === "c") return C.corridors.find((c) => c.id === id).lines.filter((l) => state.index.lines[l]);
    if (kind === "k") return [];
    return [id];
  }

  function syncUrl() {
    const p = new URLSearchParams();
    p.set("l", el.line.value);
    p.set("d", el.date.value);
    p.set("dir", el.dir.value);
    if (el.from.value !== "0") p.set("from", el.from.value);
    if (el.to.value !== "28") p.set("to", el.to.value);
    if (el.sfrom.value && el.sfrom.selectedIndex > 0) p.set("sf", el.sfrom.value);
    if (el.sto.value && el.sto.selectedIndex < el.sto.options.length - 1) p.set("st", el.sto.value);
    if (el.pass.checked) p.set("pass", "1");
    if (el.plat.checked) p.set("plat", "1");
    if (el.nonrev.checked) p.set("nr", "1");
    if (el.run.value.trim()) p.set("run", el.run.value.trim().toUpperCase());
    history.replaceState(null, "", "?" + p.toString());
  }

  // ------------------------------------------------------------ building the grid

  // A trip's stops keyed by station and visit number (City Circle trains pass
  // Central twice), with the time shown: departure, or arrival at the end.
  // Feeder trains at an interchange (HUN at Hamilton) get rows of their own
  // there ("~<n>"), so the corridor reads one way: Dungog - Hamilton, change,
  // Hamilton - Sydney.
  function keyed(trip) {
    // a station visited twice (Central, round the City Circle) is numbered from
    // the Sydney end: going down, a train starting at Central matches the
    // Central a City Circle train leaves from, not the one it starts at
    const total = new Map();
    for (const [st] of trip.s) total.set(st, (total.get(st) || 0) + 1);
    const seen = new Map();
    const split = trip.split || new Map();
    return trip.s.map((stop, i) => {
      let [st, arr, dwell = 0, plat = "", flag = ""] = stop;
      const k = (seen.get(st) || 0) + 1;
      seen.set(st, k);
      const n = trip.dir === "down" && !trip.round ? total.get(st) - k + 1 : k;
      const last = i === trip.s.length - 1;
      // picking up only at the start / setting down only at the end goes without saying
      if ((i === 0 && flag === "u") || (last && flag === "d")) flag = "";
      const base = `${st}#${n}`;
      return { key: base + (split.get(st) || ""), base, st, arr, dep: arr + dwell,
               t: last || flag === "p" ? arr : arr + dwell, plat, flag, last, first: i === 0, join: !!stop.isJoin,
               rbRun: stop.rbRun, rbLine: stop.rbLine, rbThen: stop.rbThen, kind: stop.kind };
    });
  }

  const distKm = (st) => {
    const [, lat, lon] = state.stations[st];
    const x = (lon - 151.2065) * Math.cos((lat * Math.PI) / 180);
    return 111.2 * Math.hypot(x, lat + 33.8832);
  };

  // Merge every stopping pattern into one station order, busiest first; a
  // station not yet listed goes in beside its neighbours, so a branch stays
  // together (Cronulla stations follow Sutherland).
  function stationOrder(trips) {
    const seqs = new Map();
    for (const t of trips) {
      const k = t.stops.map((s) => s.key).join(",");
      const e = seqs.get(k) || { n: 0, regional: state.index.lines[t.line].network === "regional" };
      e.n += 1;
      seqs.set(k, e);
    }
    // regional trains last: they run through without calling much, and would
    // otherwise pull whole branches in after the junction
    const order = [...seqs.entries()]
      .map(([k, e]) => [k.split(","), e.n, e.regional])
      // busiest patterns first (trains x stations), so the main route sets
      // the order and branches slot in beside it
      .sort((a, b) => a[2] - b[2] || b[0].length * b[1] - a[0].length * a[1] || b[0].length - a[0].length);
    const st = (k) => Number(k.split("#")[0]);
    // x -> stations some train reaches after x
    const later = new Map();
    for (const [seq] of order) {
      seq.forEach((x, i) => {
        if (!later.has(x)) later.set(x, new Set());
        for (const y of seq.slice(i + 1)) later.get(x).add(y);
      });
    }
    const runsBefore = (x, y) => later.has(x) && later.get(x).has(y);
    // where to put a block of new stations: after `a` (moving on past rows
    // that trains run through on the way to the block: Waterfall before the
    // South Coast stations, though both follow Heathcote) or before `b`
    // (moving back the same way)
    const after = (a, block) => {
      while (a + 1 < master.length && runsBefore(master[a + 1], block[0])) a++;
      return a + 1;
    };
    const before = (b, block) => {
      while (b > 0 && runsBefore(block[block.length - 1], master[b - 1])) b--;
      return b;
    };
    const master = [];
    for (const [seq] of order) {
      let anchor = -1;
      let pending = [];
      for (const key of seq) {
        let i = master.indexOf(key);
        if (i >= 0) {
          if (pending.length) {
            // stations between two known ones go next to whichever of the
            // two is nearer Sydney: after it on the way out (Sydenham trains
            // after Central going down), before it on the way in (before
            // Central going up), so a branch sits by the junction it leaves
            // the city by, not the far one (Revesby)
            const near = anchor < 0 || distKm(st(key)) < distKm(st(master[anchor]));
            master.splice(near ? before(i, pending) : after(anchor, pending), 0, ...pending);
            i = master.indexOf(key);
            pending = [];
          }
          anchor = i;
        } else {
          pending.push(key);
        }
      }
      if (anchor >= 0 && pending.length) {
        master.splice(after(anchor, pending), 0, ...pending);
        pending = [];
      }
      if (pending.length) {
        // a block sharing no station (HUN beyond Hamilton): put it at the end
        // of the list nearer it, so Up still runs towards Sydney
        const mean = pending.reduce((a, k) => a + distKm(st(k)), 0) / pending.length;
        const top = master.length && Math.abs(mean - distKm(st(master[0]))) < Math.abs(mean - distKm(st(master[master.length - 1])));
        // an interchange's feeders (Kiama~ for the Bomaderry shuttle) go
        // hard against the interchange's own row, outside any other block
        // already there (Cronulla)
        const base = (k) => k.includes("~") ? k.replace(/~\d+/, "") : null;
        const x = pending.filter(base).length === 1 ? master.indexOf(base(top ? pending[pending.length - 1] : pending[0])) : -1;
        if (top) master.splice(x >= 0 ? x : 0, 0, ...pending);
        else master.splice(x >= 0 ? x + 1 : master.length, 0, ...pending);
      }
    }
    return master;
  }

  // A through line (config.js `through`) on its own: each train that runs on
  // through `at` under a new run number becomes one, its second run in `rb`.
  // Joined trains vote on the direction: Down passes `down` after the change.
  function joinThrough(trips, partners, { line, lineView }) {
    const cfg = C.through && C.through[line];
    const at = state.byName.get(C.throughAt);
    const via = cfg && state.byName.get(cfg.down);
    const loopIds = new Set((C.cityCircle || []).map((name) => state.byName.get(name)));
    const mine = new Set(trips);
    const used = new Set(), out = [];
    for (const a of trips) {
      if (used.has(a)) continue;
      const last = a.s[a.s.length - 1];
      // the run it forms (run numbers repeat across lines: the one leaving
      // here soonest after, its own line first)
      const b = a.f && a.f[1] && last[0] === at ? (partners.get(a.f[0]) || [])
        .filter((x) => !used.has(x) && x.s[0][0] === at && x.s[0][1] >= last[1])
        .sort((x, y) => (x.line !== a.line) - (y.line !== a.line) || x.s[0][1] - y.s[0][1])[0] : null;
      if (!b) continue;
      // round the City Circle (in any timetable), or on as another run in
      // a line's own timetable (T1 Western to North Shore, T9 to T1)
      const loop = b.s.length > 2 && loopIds.has(b.s[1][0]) && b.s.some((x, i) => i > 1 && x[0] === at);
      if (!loop && !lineView) continue;
      // a lap that goes on out (Central, the loop, Central, Sydenham) joins
      // as far as Central and shows where it carries on to
      const back = loop ? b.s.findIndex((x, i) => i > 0 && x[0] === at) : -1;
      const part = back > 0 ? b.s.slice(0, back + 1) : b.s;
      const onward = back > 0 && back < b.s.length - 1;
      used.add(a);
      if (!onward && mine.has(b)) used.add(b);
      const first = b.s[0];
      const join = [at, last[1], first[1] + (first[2] || 0) - last[1], first[3] || last[3] || "", ""];
      join.isJoin = true;   // where "Continues as" goes
      out.push({ ...a, s: [...a.s.slice(0, -1), join, ...part.slice(1)],
                 h: loop ? a.h : finalHead(a, b), f: onward ? null : b.f,
                 t: onward ? state.stations[b.s[b.s.length - 1][0]][0] : b.t,
                 rb: b.r, rbLine: b.line, rbLoop: loop,
                 vote: !loop && via ? (b.s.some((x) => x[0] === via) ? "down" : "up") : undefined,
                 fixDir: loop ? a.d : undefined });
    }
    for (const t of trips) if (!used.has(t)) out.push(t);
    return out;
  }

  // A shuttle's round trip as one service (config.js `rounds`: T7 Lidcombe -
  // Olympic Park - Lidcombe), "Continues as" at the far end, all one way
  function joinRounds(trips, at) {
    const byRun = new Map(trips.map((t) => [t.r, t]));
    const used = new Set(), out = [];
    for (const a of trips) {
      if (used.has(a)) continue;
      const last = a.s[a.s.length - 1];
      const b = a.f && a.f[1] ? byRun.get(a.f[0]) : null;
      if (!b || used.has(b) || last[0] !== at || b.s[0][0] !== at || b.s[0][1] < last[1]) continue;
      used.add(a); used.add(b);
      const first = b.s[0];
      const join = [at, last[1], first[1] + (first[2] || 0) - last[1], first[3] || last[3] || "", ""];
      join.isJoin = true;
      out.push({ ...a, s: [...a.s.slice(0, -1), join, ...b.s.slice(1)], h: b.h, f: b.f, rb: b.r, fixDir: "down", round: true });
    }
    for (const t of trips) if (!used.has(t)) out.push({ ...t, fixDir: "down", round: true });
    return out;
  }

  // The headboard a through train shows: its own if that already names where
  // it ends up ("Penrith via Gordon"), otherwise where it ends up via the
  // through station ("Hornsby via Central", not "Central")
  function finalHead(a, b) {
    const end = state.stations[b.s[b.s.length - 1][0]][0];
    return a.h.startsWith(end) ? a.h : `${end} via Central`;
  }

  // In a corridor a through line's trains stay as two runs, but the first
  // shows the headboard of where it ends up
  function throughHeads(trips) {
    const at = state.byName.get(C.throughAt);
    const byRun = new Map(trips.map((t) => [t.r, t]));
    return trips.map((a) => {
      const b = a.f && a.f[1] ? byRun.get(a.f[0]) : null;
      return b && a.s[a.s.length - 1][0] === at && b.s[0][0] === at ? { ...a, h: finalHead(a, b) } : a;
    });
  }

  // Branches as printed timetables have them (config.js `branches`): the
  // branch stations straight after the junction going out, straight before
  // it coming in, with the main line carrying on after them. Moves them in
  // `master` and returns them, to indent.
  function branches(master, trips) {
    const forced = [];
    const goes = new Set();
    for (const t of trips) t.stops.forEach((x, i) => { if (i) goes.add(t.stops[i - 1].key + ">" + x.key); });
    for (const br of C.branches || []) {
      if (br.views && !br.views.includes(el.line.value)) continue;
      const j = `${state.byName.get(br.at)}#1`;
      const ids = new Set(br.stations.map((name) => state.byName.get(name)));
      const keys = master.filter((k) => ids.has(Number(k.split("#")[0])));
      if (!master.includes(j) || !keys.length) continue;
      const out = goes.has(j + ">" + keys[0]), back = goes.has(keys[keys.length - 1] + ">" + j);
      if (out || back) {
        for (const k of keys) master.splice(master.indexOf(k), 1);
        master.splice(master.indexOf(j) + (out ? 1 : 0), 0, ...keys);
      }
      if (out || back) forced.push({ keys, j });
    }
    // a part of Central trains only start from (or only finish at) goes at
    // the top (or the bottom), not stuck after a branch (Sydney Terminal in
    // the South corridor)
    const has = (pre, k) => [...goes].some((g) => (pre ? g.endsWith(">" + k) : g.startsWith(k + ">")));
    for (const k of [...master]) {
      if (!/^(Sydney Terminal|Central Electric|Central ESR)$/.test(state.stations[Number(k.split("#")[0])][0])) continue;
      const i = master.indexOf(k);
      if (!has(true, k) && i > 0 && forced.some((g) => g.keys.includes(master[i - 1]))) { master.splice(i, 1); master.unshift(k); }
      else if (!has(false, k) && i < master.length - 1 && forced.some((g) => g.keys.includes(master[i + 1]))) { master.splice(i, 1); master.push(k); }
    }
    return depths(master, trips, forced);
  }

  // How far each station is off the line's main route, for the indent. The
  // main route is the busiest long stopping pattern; every other pattern's
  // new stations hang off where they leave it. At a junction where the main
  // route carries on they go one deeper (Harris Park - Parramatta off
  // Granville on T2; Bankstown off Regents Park, itself off Lidcombe, in the
  // Inner West); where it doesn't, they just carry the line on (Leppington on
  // T2 alone). A main route that only goes on a station or two to a dead end
  // swaps with the longer way (Newcastle Interchange off Hamilton, the Hunter
  // carrying on). Configured branches (config.js) always count as branches
  // where the line really splits there.
  function depths(master, trips, groups) {
    const inMaster = new Set(master);
    const succ = new Map(), pred = new Map();
    const add = (m, a, b) => { if (!m.has(a)) m.set(a, new Set()); m.get(a).add(b); };
    const pats = new Map();
    const local = trips.filter((t) => state.index.lines[t.line].network !== "regional");
    for (const t of (local.length ? local : trips)) {
      const ks = t.stops.map((x) => x.key).filter((k) => inMaster.has(k));
      for (let i = 1; i < ks.length; i++) { add(succ, ks[i - 1], ks[i]); add(pred, ks[i], ks[i - 1]); }
      const id = ks.join(",");
      pats.set(id, { ks, line: t.line, n: ((pats.get(id) || {}).n || 0) + 1 });
    }
    const many = (m, k) => (m.get(k) || new Set()).size > 1;
    // configured branches, where their junction is a junction here
    const forced = new Set();
    const active = groups.filter(({ keys, j }) => many(succ, j) || many(pred, j));
    for (const g of active) g.keys.forEach((k) => forced.add(k));
    // Central's parts (Sydney Terminal, Central Electric) are never a branch
    const central = (k) => /^(Sydney Terminal|Central Electric|Central ESR)$/.test(state.stations[Number(k.split("#")[0])][0]);
    const order = [...pats.values()].sort((x, y) => y.n * y.ks.length ** 2 - x.n * x.ks.length ** 2);
    const spine = order.find((p) => !p.ks.some((k) => forced.has(k))) || order[0];
    order.sort((x, y) => (x === spine ? -1 : y === spine ? 1 : y.ks.length - x.ks.length || y.n - x.n));
    // a station the main route runs past without a time (Waterfall for South
    // Coast expresses) is on it, not a branch
    const coords = (k) => state.stations[Number(k.split("#")[0])];
    const apart = (a, b) => {
      const [, la, oa] = coords(a), [, lb, ob] = coords(b);
      return 111.2 * Math.hypot((oa - ob) * Math.cos((la * Math.PI) / 180), la - lb);
    };
    const edges = spine ? spine.ks.slice(1).map((k, i) => [spine.ks[i], k]) : [];
    const onSpine = (k) => edges.some(([a, b]) => apart(a, k) + apart(k, b) < 1.15 * apart(a, b));
    const depth = new Map();
    if (!spine) return depth;
    spine.ks.forEach((k) => depth.set(k, 0));
    // the way the main route goes on from j (same depth) as far as a dead end;
    // null if it goes on for good, undefined if it doesn't go on another way
    const chain = (j, not, next) => {
      const d = depth.get(j);
      let m = [...(next.get(j) || [])].find((x) => x !== not && depth.get(x) === d && !forced.has(x));
      if (!m) return undefined;
      const out = [];
      while (m && out.length < 60) {
        out.push(m);
        const on = [...(next.get(m) || [])].filter((x) => depth.has(x));
        if (on.length !== 1 || on.some((x) => depth.get(x) !== d)) return on.length ? null : out;
        m = on[0];
      }
      return null;
    };
    const hang = (run, j, next, rejoin) => {
      const d = depth.get(j);
      let rd = d;
      if (rejoin) {
        // a way round that comes back to the main route: a branch only if
        // it's another line and the main route has stations in between
        // (T3 Sefton - Carramar in the Inner West; not T8 via Sydenham)
        if (rejoin.other && !(next.get(j) || new Set()).has(rejoin.k)) rd = d + 1;
      } else {
        const main = chain(j, run[0], next);
        if (main !== undefined) {
          if (main && main.length === 1 && main.length < run.length) main.forEach((k) => { if (!central(k)) depth.set(k, d + 1); });
          else if (!(run.length <= 2 && run.every(onSpine))) rd = d + 1;
        }
      }
      for (const k of run) depth.set(k, forced.has(k) ? Math.max(rd, d + 1) : central(k) ? d : rd);
    };
    for (const p of order) {
      let i = 0;
      while (i < p.ks.length) {
        if (depth.has(p.ks[i])) { i++; continue; }
        let e = i;
        while (e < p.ks.length && !depth.has(p.ks[e])) e++;
        const run = p.ks.slice(i, e);
        if (i > 0 && e < p.ks.length) hang(run, p.ks[i - 1], succ, { k: p.ks[e], other: p.line !== spine.line });
        else if (i > 0) hang(run, p.ks[i - 1], succ);
        else if (e < p.ks.length) hang([...run].reverse(), p.ks[e], pred);
        else run.forEach((k) => depth.set(k, 0));
        i = e;
      }
    }
    // a configured branch sits one deeper than its junction, all of it
    for (const g of active) {
      const d = (depth.get(g.j) || 0) + 1;
      g.keys.forEach((k) => depth.set(k, d));
    }
    return depth;
  }

  // The part of a train's run inside a corridor (see config.js), or null.
  function clip(stops, c, line) {
    // a line can have its own stations in a corridor (T1 Central - Parramatta
    // in the Inner West)
    const only = c.lineStations && c.lineStations[line];
    if (!only && !c.stations && !c.exclude) return stops;
    const name = (st) => state.stations[st][0];
    const keep = only ? new Set(only) : c.stations ? new Set(c.stations) : null;
    const drop = new Set(c.exclude || []);
    const inside = (st) => (keep ? keep.has(name(st)) : !drop.has(name(st)));
    const runs = [];
    let cur = null;
    stops.forEach((s, i) => {
      if (inside(s[0])) {
        if (!cur) runs.push((cur = { a: i, b: i }));
        cur.b = i;
      } else cur = null;
    });
    if (!runs.length) return null;
    const via = new Set(c.dropVia || []);
    for (let k = 1; k < runs.length; k++) {
      for (let i = runs[k - 1].b + 1; i < runs[k].a; i++) if (via.has(name(stops[i][0]))) return null;
    }
    const calls = (r) => stops.slice(r.a, r.b + 1).filter((s) => s[4] !== "p").length;
    const best = runs.reduce((x, y) => (calls(y) > calls(x) ? y : x));
    return calls(best) >= 2 ? stops.slice(best.a, best.b + 1) : null;
  }

  // Split trains into the two directions by the order they visit stations,
  // not by where they start and end, so through trains (T1 Emu Plains -
  // Berowra) and corridors line up. The longest train sets the order; others
  // follow or oppose it at the stations they share, passing it on to stations
  // the first one never reaches. The side most trains call "up" (towards
  // Central) is Up.
  function orient(trips) {
    if (!trips.length) return;
    const ids = (t) => t.s.map(([st]) => [t.split && t.split.has(st) ? st + t.split.get(st) : st]);
    const rank = new Map();
    const seed = trips.reduce((a, b) => (b.s.length > a.s.length ? b : a));
    ids(seed).forEach(([st], i) => { if (!rank.has(st)) rank.set(st, i); });
    const sign = new Map([[seed, 1]]);
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (const t of trips) {
        if (sign.has(t)) continue;
        const tid = ids(t);
        const shared = tid.filter(([st]) => rank.has(st));
        if (shared.length < 2) continue;
        // which way it mostly goes past the stations it shares (not just
        // first to last: a station only ranked by a branch train, Central
        // Electric for a City Circle train in the South corridor, can sit off)
        let vote = 0;
        for (let i = 1; i < shared.length; i++) vote += Math.sign(rank.get(shared[i][0]) - rank.get(shared[i - 1][0]));
        const a = rank.get(shared[0][0]), b = rank.get(shared[shared.length - 1][0]);
        if (!vote && a === b) continue;
        const sg = vote ? Math.sign(vote) : b > a ? 1 : -1;
        sign.set(t, sg);
        changed = true;
        // stations only this train reaches get ranks between its neighbours
        let last = null;
        tid.forEach(([st], i) => {
          if (rank.has(st)) { last = rank.get(st); return; }
          const r = last === null ? rank.get(shared[0][0]) - sg * (tid.length - i) * 1e-3
            : last + sg * 1e-3;
          rank.set(st, r);
          last = r;
        });
      }
      if (!changed) break;
    }
    let upVotes = 0;
    // through trains (config.js `through`) settle it on their own
    const voters = trips.some((t) => t.vote) ? trips.filter((t) => t.vote) : trips;
    for (const t of voters) if (sign.has(t)) upVotes += ((t.vote || t.d) === "up" ? 1 : -1) * sign.get(t);
    const upSign = upVotes >= 0 ? 1 : -1;
    for (const t of trips) t.dir = sign.has(t) ? (sign.get(t) === upSign ? "up" : "down") : t.d;
  }

  // Order trains as they run: by their time at the busiest station, or for a
  // train that doesn't call there, by its time somewhere it shares with other
  // trains plus their usual running time from there.
  function sortTrips(trips) {
    const count = new Map();
    for (const t of trips) {
      t.byBase = new Map(t.stops.map((s) => [s.base, s]));
      for (const s of t.stops) count.set(s.base, (count.get(s.base) || 0) + 1);
    }
    let ref = null;
    for (const [k, n] of count) if (!ref || n > count.get(ref)) ref = k;
    const diffs = new Map();
    for (const t of trips) {
      const r = t.byBase.get(ref);
      if (!r) continue;
      for (const s of t.stops) {
        if (!diffs.has(s.base)) diffs.set(s.base, []);
        diffs.get(s.base).push(r.t - s.t);
      }
    }
    const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    for (const t of trips) {
      const r = t.byBase.get(ref);
      if (r) { t.ref = r.t; continue; }
      let best = null;
      for (const s of t.stops) {
        const d = diffs.get(s.base);
        if (d && (!best || d.length > diffs.get(best.base).length)) best = s;
      }
      t.ref = best ? best.t + median(diffs.get(best.base)) : t.stops[0].t;
    }
    trips.sort((a, b) => a.ref - b.ref || a.line.localeCompare(b.line));
  }

  // Timed connections (config.js `interchanges`). The secondary trains are
  // the feeders (split interchanges: HUN at Hamilton, the Bomaderry shuttle at
  // Kiama) or the all-stations trains (express interchanges: SCO locals at
  // Thirroul); the primary trains are the rest calling there. When the
  // secondary arrives first, each gets the first primary leaving after it;
  // when it leaves after, each gets the last primary arriving before it. At
  // least ix.minutes (default 2) to change, at most ix.maxMinutes (default 30).
  // Returns the "Change at" row: where it goes, each column's text, and the
  // secondary -> primary pairs; or null if the interchange isn't in view.
  function connections(trips, rows, ix, n, at) {
    const mk = `${at}#1`;
    if (!rows.includes(mk)) return null;
    const isSecondary = (t) => !!(t.feeds && t.feeds.has(n));
    const feeders = trips.filter((t) => isSecondary(t) && t.byKey.has(mk));
    if (!feeders.length) return null;
    // the feeders arrive (ending at or just past the change) or leave
    const pos = (t) => t.stops.findIndex((x) => x.key === mk) / Math.max(1, t.stops.length - 1);
    const secondaryFirst = feeders.filter((t) => pos(t) > 0.5).length * 2 >= feeders.length;
    const gap = (ix.minutes ?? 2) * 60, most = (ix.maxMinutes ?? 30) * 60;
    const calls = (t, k) => { const x = t.byKey.get(k); return x && x.flag !== "p" ? x : null; };
    // ix.only: both trains on these lines (no change into a regional train,
    // which has to be booked)
    const ok = (t) => !ix.only || ix.only.includes(t.line);
    // non-revenue trains (specials, charters) take no part in a change
    const prim = trips.filter((t) => !t.e && ok(t) && !isSecondary(t) && calls(t, mk));
    const cells = new Map(), pairs = new Map(), arrows = [], arrowCells = new Map();
    const add = (t, html) => cells.set(t, (cells.get(t) ? cells.get(t) + "<br>" : "") + html);
    for (const t of feeders) {
      const s = !t.e && ok(t) && calls(t, mk);
      if (!s) continue;
      // a feeder starts or ends here (or one stop on: HUN to Newcastle);
      // all-stations trains (express changes) can run through
      if (!ix.express && !(secondaryFirst ? t.stops.slice(-2) : t.stops.slice(0, 2)).some((x) => x.key === mk)) continue;
      // the best connection (ix.perLine: the best from or to each line)
      const bests = new Map();
      for (const m of prim) {
        if (m === t || (ix.perLine && m.line === t.line)) continue;
        const ms = calls(m, mk);
        const wait = secondaryFirst ? ms.dep - s.arr : s.dep - ms.arr;
        if (wait < gap || wait > most) continue;
        const k = ix.perLine ? m.line : "";
        if (!bests.has(k) || wait < bests.get(k).wait) bests.set(k, { m, wait });
      }
      if (!bests.size) continue;
      const all = [...bests.values()].sort((a, b) => a.wait - b.wait);
      pairs.set(t, all[0].m);
      for (const best of all) {
        // each side names the other train and when it's there:
        //   arriving train: "to N418 / dep 06:42, 5 min"
        //   leaving train:  "from V710 / arr 06:38"
        const ms = calls(best.m, mk);
        const mins = Math.round(best.wait / 60);
        const wait = `<span class="work">, ${mins} min</span>`;
        const [inT, inS, outT, outS] = secondaryFirst ? [t, s, best.m, ms] : [best.m, ms, t, s];
        // arrow mode: from the arriving train's arr time to the leaving
        // train's dep time, as the NSW TrainLink regional timetables
        arrows.push({ inT, inKey: `${mk}|arr`, outT, outKey: `${mk}|dep`, mins });
        if (!arrowCells.has(outT)) arrowCells.set(outT, `<span class="work">${mins} min</span>`);
        add(inT, `to <b>${esc(outT.r)}</b><br><span class="work">dep ${hhmm(outS.dep)}</span>${wait}`);
        add(outT, `from <b>${esc(inT.r)}</b><br><span class="work">arr ${hhmm(inS.arr)}</span>`);
      }
    }
    if (!pairs.size) return null;
    return { key: mk, cells, pairs, arrows, arrowCells, secondaryFirst, label: `Change at ${state.stations[at][0]}` };
  }

  const KIND = { ecs: "Empty cars", mtpv: "MTPV", special: "Special", charter: "Charter", goods: "Goods", test: "Test" };
  const KIND_COLOUR = { ecs: "#888888", mtpv: "#8a6a3a", special: "#7a4f9e", charter: "#7a4f9e", goods: "#5b4a3a", test: "#2f7f7a" };
  // the MTPV kind by stock: I inspection cars stay MTPV, R the new regional
  // fleet on test, locomotives goods
  const kindOf = (t) => (t.c !== "mtpv" ? t.c : /^I/.test(t.v) ? "mtpv" : /^R/.test(t.v) ? "test" : "goods");

  // to the half minute, for an interchange's arr and dep rows: 18:02½
  const hhmm30 = (t) => { const r = Math.round(t / 30) * 30; return hhmm(r) + (r % 60 ? "½" : ""); };

  function cell(s, opts, t, role) {
    if (!s) return "<td></td>";
    // an interchange's arr and dep rows: when trains get there and when they
    // leave (a through train in both), to the half minute
    let shown = hhmm(s.t);
    if (role && s.flag !== "p") {
      if (role === "arr" ? s.first : s.last) return "<td></td>";
      shown = hhmm30(role === "arr" ? s.arr : s.dep);
    }
    const title = [`${s.flag === "p" ? "passes" : "arr"} ${hhmmss(s.arr)}`];
    if (s.flag !== "p" && s.dep !== s.arr) title.push(`dep ${hhmmss(s.dep)}`);
    if (s.plat) title.push(`platform ${s.plat}`);
    const attr = ` title="${esc(title.join(", "))}"`;
    // empty runs and MTPV: every timing point; specials and charters as
    // trains, greyed
    // (in a chain of runs each stop knows its own run's kind)
    const kind = s.kind !== undefined ? s.kind : t && t.e ? t.c : null;
    if (kind && (s.flag !== "p" || kind === "ecs" || kind === "mtpv")) {
      return `<td class="ecs"${attr}>${shown}${s.flag && s.flag !== "p" ? `<span class="flag">${s.flag}</span>` : ""}</td>`;
    }
    if (s.flag === "p") {
      const pplat = opts.plat && s.plat ? `<span class="plat">${esc(s.plat)}</span>` : "";
      return opts.pass ? `<td class="pass"${attr}>${hhmm(s.t)}${pplat}</td>` : `<td class="pass"${attr}>|${pplat}</td>`;
    }
    const flag = s.flag ? `<span class="flag">${s.flag}</span>` : "";
    const plat = opts.plat && s.plat ? `<span class="plat">${esc(s.plat)}</span>` : "";
    return `<td${attr}>${shown}${flag}${plat}</td>`;
  }

  function table(trips, master, opts, allTrips) {
    const names = state.stations;
    const lines = state.index.lines;
    const sets = state.index.sets || {};
    // set type number first (8B, not B8, which reads like a line)
    const set = (v) => String(v || "").replace(/^([A-Za-z]+)(\d+)$/, "$2$1");
    // a run, "empty" if it carries no one, and where it goes (forms)
    const working = (w) => (w ? esc(w[0]) + (w[1] ? "" : '<span class="work"> empty</span>') +
      (w[2] ? `<br><span class="work">${esc(w[2])}</span>` : "") : "");
    let h = '<div class="tt-scroll"><table class="tt"><thead><tr><th class="stn"></th>';
    h += trips.map((t) =>
      `<th${t.e ? ' class="ecs"' : ""}><span class="head">${esc(t.h)}</span>` +
      `<span class="line" style="background:${esc(t.e ? KIND_COLOUR[kindOf(t)] || "#888888" : lines[t.line].colour)}">${esc(t.e ? KIND[kindOf(t)] || "Non-revenue" : t.line)}</span>` +
      `<span class="run">${esc(t.r)}</span><span class="set" title="${esc(sets[t.v] || "")}">${esc(set(t.v))}</span>` +
      `</th>`).join("");
    // a regional train cut to this area: where it came from goes with Formed
    // by, where it goes on to with Forms
    const from = (t) => (t.o ? `<span class="work">arrives from ${esc(t.o)}</span>` : "");
    h += '</tr></thead><tbody><tr class="worked"><th class="stn">Formed by</th>' +
      trips.map((t) => `<td>${[working(t.b), from(t)].filter(Boolean).join("<br>")}</td>`).join("") + "</tr>";
    // a rule above a station no train reaches straight from the one listed
    // before it: the start of another branch
    const next = new Set();
    for (const t of allTrips) {
      // adjacent among the stations shown
      const shown = t.stops.filter((s) => master.includes(s.key));
      shown.forEach((s, i) => { if (i) next.add(shown[i - 1].key + ">" + s.key); });
    }
    master.forEach((key, i) => {
      const st = Number(key.split("#")[0]);
      const gap = i && !next.has(master[i - 1] + ">" + key) ? ' class="gap"' : "";
      const here = (opts.changes || []).filter((c) => c.key === key);
      const row = (k, role, cls) => `<tr${cls} data-k="${k}"><th class="stn${opts.branch && opts.branch.get(key) ? ` branch d${Math.min(3, opts.branch.get(key))}` : ""}">${esc(names[st][0])}${role ? ` <span class="role">${role}</span>` : ""}</th>` +
        trips.map((t) => cell(t.byKey.get(key), opts, t, role)).join("") + "</tr>";
      if (!here.length) h += row(key, "", gap);
      else {
        // a timed change: arr row, "Change at" row, dep row
        h += row(`${key}|arr`, "arr", gap);
        for (const c of here) {
          h += `<tr class="change"><th class="stn">${esc(c.label)}</th>` +
            trips.map((t) => `<td>${(opts.arrows ? c.arrowCells : c.cells).get(t) || ""}</td>`).join("") + "</tr>";
        }
        h += row(`${key}|dep`, "dep", "");
      }
      // through trains change run number here (T1 at Central Electric)
      if (trips.some((t) => t.byKey.has(key) && t.byKey.get(key).join && (t.rb || t.byKey.get(key).rbRun))) {
        // a change of line shows the new line's code (T9 on as T1); a lap of
        // the City Circle shows CC
        const badge = (t) => t.rbLoop ? '<span class="line cc">CC</span>'
          : t.rbLine && t.rbLine !== t.line ? `<span class="line" style="background:${esc(lines[t.rbLine].colour)}">${esc(t.rbLine)}</span>` : "";
        // a chain of runs (run search) carries its next run on the stop
        const cellOf = (t) => {
          const x = t.byKey.get(key);
          if (!x || !x.join) return "";
          // an empty run says so rather than showing a line code
          if (x.rbRun && x.rbLine === "X") return `<b>${esc(x.rbRun)}</b><span class="work"> empty</span>`;
          if (x.rbRun) return `${x.rbLine && x.rbLine !== t.line ? `<span class="line" style="background:${esc(lines[x.rbLine].colour)}">${esc(x.rbLine)}</span>` : ""}<b>${esc(x.rbRun)}</b>`;
          return t.rb ? `${badge(t)}<b>${esc(t.rb)}</b>` : "";
        };
        const then = trips.some((t) => t.byKey.has(key) && t.byKey.get(key).rbThen);
        h += `<tr class="change"><th class="stn">${then ? "Then" : "Continues as"}</th>` + trips.map((t) => `<td>${cellOf(t)}</td>`).join("") + "</tr>";
      }
    });
    // a regional train cut to this area says where it goes on to or came from
    const beyond = (t) => (t.t ? `<span class="work">continues to ${esc(t.t)}</span>` : "");
    h += '</tbody><tfoot><tr><th class="stn">Forms</th>' + trips.map((t) =>
      `<td>${[working(t.f), beyond(t)].filter(Boolean).join("<br>")}</td>`).join("") + "</tr></tfoot>";
    return h + "</table></div>";
  }

  // ------------------------------------------------------------ render

  // One run on its own (the Run box): every line that day, non-revenue
  // included, through trains joined, its whole journey
  // Runs one after another as one column, stop by stop: a set's day (the
  // Run box), an inspection train's runs. Where one forms the next at the
  // same place, "Continues as"; otherwise "Then".
  function chainTrip(runs) {
    const s = [];
    runs.forEach((t, i) => {
      const stops = t.s.map((x) => { const y = [...x]; y.kind = t.e ? t.c || "ecs" : ""; return y; });
      if (i) {
        const prev = runs[i - 1], last = s[s.length - 1], first = stops[0];
        const linked = prev.f && prev.f[0] === t.r && last[0] === first[0];
        if (linked) {
          const join = [first[0], last[1], first[1] + (first[2] || 0) - last[1], first[3] || last[3] || "", ""];
          join.isJoin = true; join.rbRun = t.r; join.rbLine = t.line; join.kind = first.kind;
          s[s.length - 1] = join;
          stops.shift();
        } else {
          first.isJoin = true; first.rbRun = t.r; first.rbLine = t.line; first.rbThen = true;
          // the "Then" row goes after the last stop of the one before
          s[s.length - 1].isJoin = true; s[s.length - 1].rbRun = t.r; s[s.length - 1].rbLine = t.line; s[s.length - 1].rbThen = true;
          first.isJoin = false;
        }
      }
      s.push(...stops);
    });
    const a = runs[0], z = runs[runs.length - 1];
    // headed by the set and the line it runs on in service
    const rev = runs.find((x) => !x.e);
    const t = { ...a, s, h: z.h, f: z.f, t: z.t, o: a.o, round: true, dir: "down", e: rev ? 0 : 1, c: rev ? undefined : a.c,
                line: rev ? rev.line : a.line };
    t.stops = keyed(t);
    t.byKey = new Map(t.stops.map((x) => [x.key, x]));
    return t;
  }
  const chainTable = (t, title) => `<h2 class="run-head">${esc(title)}</h2>` +
    table([t], t.stops.filter((x) => x.flag !== "p" || el.pass.checked || x.kind).map((x) => x.key),
      { pass: el.pass.checked, plat: el.plat.checked, changes: [] }, [t]);

  // What each run forms that day: the run it names, leaving where this one
  // ends (empty runs into sidings the feed doesn't list can start
  // elsewhere), soonest after. next: trip -> trip, prev: trip -> trip.
  function linkRuns(all) {
    const byRun = new Map();
    for (const t of all) { if (!byRun.has(t.r)) byRun.set(t.r, []); byRun.get(t.r).push(t); }
    const next = new Map(), prev = new Map();
    for (const t of [...all].sort((a, b) => a.s[a.s.length - 1][1] - b.s[b.s.length - 1][1])) {
      if (!t.f) continue;
      const end = t.s[t.s.length - 1][0], at = t.s[t.s.length - 1][1];
      const n = (byRun.get(t.f[0]) || []).filter((x) => x !== t && !prev.has(x) && x.s[0][1] >= at - 60)
        .sort((x, y) => (x.s[0][0] !== end) - (y.s[0][0] !== end) || x.s[0][1] - y.s[0][1])[0];
      if (n) { next.set(t, n); prev.set(n, t); }
    }
    return { next, prev };
  }

  // The Run box: every line that day, non-revenue included. * stands for one
  // character: 200* is 200A, 200B...; *360 is N360, W360...; 2*** every
  // 2xx set. Each set (run number without its letter) is one table, its
  // runs in order down the day, so the result reads as a fleet diagram.
  async function renderRun(run, day, id) {
    const codes = Object.keys(state.index.lines).filter((c) => state.index.lines[c].dates[day]);
    const re = new RegExp("^" + run.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".") + "$", "i");
    el.table.innerHTML = '<div class="empty">Loading…</div>';
    state.arrows = null;
    let found = [], all = [];
    try {
      const files = await Promise.all(codes.map(async (c) => [c, await getJSON(`lines/${encodeURIComponent(c)}/${state.index.lines[c].dates[day]}.json`)]));
      for (const [c, f] of files) for (const t of f.trips) all.push({ ...t, line: c, e: c === "X" ? 1 : 0 });
      found = all.filter((t) => re.test(t.r));
    } catch (e) {
      if (id === renderId) el.table.innerHTML = `<div class="empty">Couldn't load the timetable (${esc(e.message)}).</div>`;
      return;
    }
    if (id !== renderId) return;
    el.note.hidden = true;
    if (!found.length) {
      el.table.innerHTML = `<div class="empty">No run ${esc(run)} on ${esc(day)}.</div>`;
      return;
    }
    // each run's set for the day: everything it's formed by and forms
    // (intercity runs, N418 on as N423...), and for suburban sets anything
    // else with the same number that the feed doesn't link (200A ... 200G)
    const { next, prev } = linkRuns(all);
    const stem = (r) => (/[A-Z]$/i.test(r) && /\d/.test(r) ? r.slice(0, -1) : r);
    const day0 = (t) => { let a = t, n = 0; while (prev.has(a) && n++ < 80) a = prev.get(a); return a; };
    const whole = (a) => { const c = [a]; while (next.has(c[c.length - 1]) && c.length < 80) c.push(next.get(c[c.length - 1])); return c; };
    const sets = new Map();   // key -> Set of trips
    const keyOf = new Map();
    for (const t of found) {
      const c = whole(day0(t));
      const lettered = /[A-Z]$/i.test(t.r) && /^\d/.test(t.r);
      let k = lettered ? "s:" + stem(t.r) : "c:" + c[0].r + "@" + c[0].s[0][1];
      for (const x of c) if (keyOf.has(x)) k = keyOf.get(x);
      if (!sets.has(k)) sets.set(k, new Set());
      for (const x of c) { sets.get(k).add(x); keyOf.set(x, k); }
      if (lettered) for (const x of all) if (stem(x.r) === stem(t.r) && x.line !== "X" || (stem(x.r) === stem(t.r) && x.e)) {
        for (const y of whole(day0(x))) { sets.get(k).add(y); keyOf.set(y, k); }
      }
    }
    let html = "";
    const list = [...sets.values()].map((set) => [...set].sort((x, y) => x.s[0][1] - y.s[0][1]));
    list.sort((x, y) => x[0].r.localeCompare(y[0].r, "en", { numeric: true }));
    for (const runs of list) {
      const named = runs.filter((t) => re.test(t.r)).map((t) => t.r);
      html += chainTable(chainTrip(runs), runs.length > 1 ? `${named.join(", ")}: ${runs.map((t) => t.r).join(", ")}` : runs[0].r);
    }
    el.table.innerHTML = html;
  }

  // Fleet breakdown: the sets a day's timetable needs. Each set's day is
  // its runs chained by what each forms (empty runs included); by stock,
  // how many sets work at some point and how many are out at once at the
  // busiest moment (a set stabled for more than an hour between runs
  // doesn't count as out).
  async function renderFleet(day, id) {
    state.arrows = null;
    el.note.hidden = true;
    const codes = Object.keys(state.index.lines).filter((c) => state.index.lines[c].dates[day]);
    if (!codes.length) { el.table.innerHTML = `<div class="empty">No trains on ${esc(day)}.</div>`; return; }
    el.table.innerHTML = '<div class="empty">Loading…</div>';
    let files;
    try {
      files = await Promise.all(codes.map(async (c) => [c, await getJSON(`lines/${encodeURIComponent(c)}/${state.index.lines[c].dates[day]}.json`)]));
    } catch (e) {
      if (id === renderId) el.table.innerHTML = `<div class="empty">Couldn't load the timetable (${esc(e.message)}).</div>`;
      return;
    }
    if (id !== renderId) return;
    // the regional trains as Sydney Trains has them are cut short; the
    // rest are whole
    const all = [];
    for (const [c, f] of files) for (const t of f.trips) {
      if (t.c === "mtpv" || t.c === "special" || t.c === "charter") continue;
      all.push({ ...t, line: c, start: t.s[0][1], end: t.s[t.s.length - 1][1] });
    }
    const { next, prev } = linkRuns(all);
    const hasPrev = new Set(prev.keys());
    const chains = [];
    for (const t of all) {
      if (hasPrev.has(t)) continue;
      const c = [t];
      while (next.has(c[c.length - 1]) && c.length < 80) c.push(next.get(c[c.length - 1]));
      chains.push(c);
    }
    // each chain: its stock (most of its time) and when it's out
    const sets = state.index.sets || {};
    const stats = new Map();
    const events = [];
    for (const c of chains) {
      const time = new Map();
      for (const t of c) time.set(t.v, (time.get(t.v) || 0) + (t.end - t.start));
      const v = [...time].sort((a, b) => b[1] - a[1])[0][0] || "?";
      const out = [];
      for (const t of c) {
        const last = out[out.length - 1];
        if (last && t.start - last[1] <= 3600) last[1] = Math.max(last[1], t.end);
        else out.push([t.start, t.end]);
      }
      if (!stats.has(v)) stats.set(v, { v, chains: [], events: [] });
      const st = stats.get(v);
      st.chains.push(c);
      for (const [a, b] of out) { st.events.push([a, 1], [b, -1]); events.push([a, 1], [b, -1]); }
    }
    const peak = (ev) => {
      ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let n = 0, best = 0, at = 0;
      for (const [t, d] of ev) { n += d; if (n > best) { best = n; at = t; } }
      return [best, at];
    };
    const cars = (v) => Number((String(v).match(/\d+/) || [0])[0]);
    // sets needed: each set's day where the feed links it, and a set that
    // finishes somewhere picking up the next unlinked day starting there later
    const needed = (cs) => {
      const pool = new Map();
      let n = 0;
      for (const c of [...cs].sort((a, b) => a[0].start - b[0].start)) {
        const a = c[0], z = c[c.length - 1];
        const free = pool.get(a.s[0][0]) || [];
        const i = free.findIndex((t) => t <= a.start);
        if (i >= 0) free.splice(i, 1); else n += 1;
        const at = z.s[z.s.length - 1][0];
        if (!pool.has(at)) pool.set(at, []);
        pool.get(at).push(z.end);
      }
      return n;
    };
    const rows = [...stats.values()].map((st) => ({ ...st, used: needed(st.chains), peak: peak(st.events) }))
      .sort((a, b) => (sets[a.v] || a.v).localeCompare(sets[b.v] || b.v, "en", { numeric: true }));
    // cars of each type the day needs: sets needed x cars in the formation,
    // by fleet; an XPT (7X) is five cars between two power cars
    const fleet = new Map();
    const addCars = (name, n) => fleet.set(name, (fleet.get(name) || 0) + n);
    for (const r of rows) {
      const n = cars(r.v), name = String(sets[r.v] || r.v).replace(/^\d+\s*car\s+/i, "");
      if (/^X\d/.test(r.v)) { addCars("XPT power car", 2 * r.used); addCars("XPT car", (n - 2) * r.used); }
      else addCars(name, n * r.used);
    }
    const list = [...fleet].sort((a, b) => a[0].localeCompare(b[0]));
    el.table.innerHTML = `<div class="tt-scroll fleet"><table class="tt"><thead><tr><th class="stn">Cars</th><th></th></tr></thead><tbody>` +
      list.map(([name, n]) => `<tr><th class="stn">${esc(name)}</th><td>${n}</td></tr>`).join("") +
      `</tbody><tfoot><tr><th class="stn">All</th><td>${list.reduce((t, [, n]) => t + n, 0)}</td></tr></tfoot></table></div>`;
  }

  // Freight & inspection: every track machine, light engine and test train
  // that day, by what it is (inspection runs, freight and light engines, new
  // fleet test runs), each train on its own, whole journeys, both ways
  async function renderKind(kind, day, id) {
    const X = state.index.lines.X;
    state.arrows = null;
    el.note.hidden = true;
    if (!X || !X.dates[day]) { el.table.innerHTML = `<div class="empty">None on ${esc(day)}.</div>`; return; }
    el.table.innerHTML = '<div class="empty">Loading…</div>';
    let f;
    try { f = await getJSON(`lines/X/${X.dates[day]}.json`); } catch (e) {
      if (id === renderId) el.table.innerHTML = `<div class="empty">Couldn't load the timetable (${esc(e.message)}).</div>`;
      return;
    }
    if (id !== renderId) return;
    const ts = f.trips.filter((t) => t.c === kind).map((t) => ({ ...t, line: "X", e: 1, dir: t.d }))
      .sort((a, b) => a.s[0][1] - b.s[0][1]);
    // by stock: I inspection cars, R the new regional fleet on test, the
    // rest locomotives
    const sections = [
      ["Inspection", (t) => /^I/.test(t.v), ""],
      ["Freight and light engines", (t) => !/^[IR]/.test(t.v),
       "Freight trains often run off path or on generic paths that aren't in the published GTFS, so most of them won't be here."],
      ["Test runs", (t) => /^R/.test(t.v), ""],
    ];
    const name = (x) => state.stations[x[0]][0];
    let html = "";
    for (const [title, test, note] of sections) {
      const these = ts.filter(test);
      html += `<h2 class="kind-head">${esc(title)}</h2>` + (note ? `<p class="note">${esc(note)}</p>` : "");
      if (!these.length) { html += '<p class="note">None this day.</p>'; continue; }
      // each train's runs one after another (HM44, HM46, HM47...), following
      // what each forms
      const byRun = new Map(these.map((t) => [t.r, t]));
      const formed = new Set(these.filter((t) => t.f && byRun.has(t.f[0])).map((t) => t.f[0]));
      for (const start of these.filter((t) => !formed.has(t.r))) {
        const runs = [start];
        while (runs.length < 50) {
          const z = runs[runs.length - 1], nx = z.f && byRun.get(z.f[0]);
          if (!nx || runs.includes(nx)) break;
          runs.push(nx);
        }
        const a = runs[0], z = runs[runs.length - 1];
        html += chainTable(chainTrip(runs), `${runs.map((t) => t.r).join(", ")}: ${name(a.s[0])} to ${name(z.s[z.s.length - 1])}`)
          .replace('<h2 class="run-head">', '<h3 class="run-head">').replace("</h2>", "</h3>");
      }
    }
    el.table.innerHTML = html;
  }

  const arrowMode = params.get("arrows") !== "0";  // ?arrows=0: the text version

  // Connection arrows over the table, as the NSW TrainLink regional
  // timetables draw them. A shared row (Hamilton): straight along it from one
  // train's time to the other's. Arr and dep rows: down from the arriving
  // time into the "Change at" row, across to the other train and down to its
  // departure. A line stops short of any time it would cross and carries on
  // the other side.
  function drawArrows(changes, cols) {
    const scroll = el.table.querySelector(".tt-scroll");
    const table = scroll && scroll.querySelector(".tt");
    if (!table) return;
    for (const x of scroll.querySelectorAll("svg.arrows")) x.remove();
    const col = new Map(cols.map((t, i) => [t, i + 1]));
    const rows = [...table.querySelectorAll("tbody tr")];
    const rowOf = new Map(rows.filter((r) => r.dataset.k).map((r) => [r.dataset.k, r]));
    const base = table.getBoundingClientRect();
    const rel = (r) => ({ l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top });
    const box = (c) => rel(c.getBoundingClientRect());
    const range = document.createRange();
    // the text in a cell, padded, or null
    const text = (c) => {
      if (!c || !c.textContent.trim()) return null;
      range.selectNodeContents(c);
      const r = rel(range.getBoundingClientRect());
      return { l: r.l - 3, r: r.r + 3, t: r.t - 2, b: r.b + 2 };
    };
    // a straight run cut where it crosses text: [[from, to], ...]
    const cut = (a, b, blocks) => {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      let parts = [[lo, hi]];
      for (const [x, y] of blocks) {
        parts = parts.flatMap(([p, q]) => (y <= p || x >= q ? [[p, q]] : [[p, x], [y, q]].filter(([u, v]) => v - u > 2)));
      }
      return a <= b ? parts : parts.reverse().map(([p, q]) => [q, p]);
    };
    const across = (y, x0, x1, ri, cLo, cHi) => {
      const blocks = [];
      for (let c = cLo; c <= cHi; c++) {
        const tb = text(rows[ri].cells[c]);
        if (tb && tb.t < y && tb.b > y) blocks.push([tb.l, tb.r]);
      }
      return cut(x0, x1, blocks).map(([p, q]) => `M${p},${y}H${q}`);
    };
    const down = (x, y0, y1, ci, rLo, rHi) => {
      const blocks = [];
      for (let r = rLo; r <= rHi; r++) {
        const tb = text(rows[r] && rows[r].cells[ci]);
        if (tb && tb.l < x && tb.r > x) blocks.push([tb.t, tb.b]);
      }
      return cut(y0, y1, blocks).map(([p, q]) => `M${x},${p}V${q}`);
    };
    const lines = [], heads = [];
    for (const c of changes) {
      for (const a of c.arrows) {
        const ci = col.get(a.inT), co = col.get(a.outT), ri = rowOf.get(a.inKey), ro = rowOf.get(a.outKey);
        if (!ci || !co || !ri || !ro) continue;
        const iIn = rows.indexOf(ri), iOut = rows.indexOf(ro);
        const s = text(ri.cells[ci]), t = text(ro.cells[co]);
        if (!s || !t) continue;
        const right = co > ci;
        let segs;
        if (iIn === iOut) {
          const y = (box(ri.cells[ci]).t + box(ri.cells[ci]).b) / 2;
          segs = across(y, right ? s.r : s.l, right ? t.l : t.r, iIn, Math.min(ci, co) + 1, Math.max(ci, co) - 1);
        } else {
          const x0 = (s.l + s.r) / 2, x1 = (t.l + t.r) / 2;
          const mid = rows.slice(iIn + 1, iOut).find((r) => r.classList.contains("change"));
          const y = mid ? (box(mid.cells[0]).t + box(mid.cells[0]).b) / 2 : (s.b + t.t) / 2;
          const iy = mid ? rows.indexOf(mid) : iIn;
          segs = [
            ...down(x0, s.b, y, ci, iIn + 1, iy),
            ...across(y, x0, x1, iy, Math.min(ci, co), Math.max(ci, co)).filter(Boolean),
            ...down(x1, y, t.t, co, iy, iOut - 1),
          ];
        }
        if (!segs.length) continue;
        heads.push(segs.pop());
        lines.push(...segs);
      }
    }
    if (!heads.length) return;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "arrows");
    svg.setAttribute("width", table.offsetWidth);
    svg.setAttribute("height", table.offsetHeight);
    svg.innerHTML = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">` +
      `<path d="M0,1L9,5L0,9z"/></marker></defs>` +
      lines.map((d) => `<path d="${d}"/>`).join("") + heads.map((d) => `<path d="${d}" marker-end="url(#ah)"/>`).join("");
    svg.style.left = table.offsetLeft + "px";
    svg.style.top = table.offsetTop + "px";
    scroll.appendChild(svg);
  }
  window.addEventListener("resize", () => state.arrows && state.arrows());

  let renderId = 0;
  async function render() {
    syncUrl();
    // the Other tools work on a whole day: only the date applies
    const tool = el.line.value.startsWith("k:");
    for (const e of [el.dir, el.from, el.to, el.sfrom, el.sto, el.pass, el.plat, el.nonrev, el.run]) e.disabled = tool;
    // a through line names its directions by where trains go (config.js `through`)
    const thr = el.line.value.startsWith("l:") && C.through && C.through[el.line.value.slice(2)];
    el.dir.options[0].text = thr ? thr.labels[0] : "Down";
    el.dir.options[1].text = thr ? thr.labels[1] : "Up";
    const id = ++renderId;
    const codes = selectedLines();
    const day = el.date.value;
    const notes = [];
    if (el.run.value.trim() && !tool) return renderRun(el.run.value.trim().toUpperCase(), day, id);
    if (el.line.value === "k:fleet") return renderFleet(day, id);
    if (el.line.value.startsWith("k:")) return renderKind(el.line.value.slice(2), day, id);
    const missing = codes.filter((c) => !state.index.lines[c].dates[day]);
    if (missing.length === codes.length) {
      el.table.innerHTML = `<div class="empty">${day < state.index.first || day > state.index.last
        ? `The timetable data covers ${state.index.first} to ${state.index.last}.`
        : `No ${esc(codes.join(" or "))} trains on ${esc(day)}.`}</div>`;
      el.note.hidden = true;
      return;
    }
    if (missing.length) notes.push(`No ${missing.join(", ")} trains on this date.`);
    el.table.innerHTML = '<div class="empty">Loading…</div>';
    let files;
    try {
      files = await Promise.all(codes.filter((c) => !missing.includes(c)).map(async (c) =>
        [c, await getJSON(`lines/${encodeURIComponent(c)}/${state.index.lines[c].dates[day]}.json`)]));
    } catch (e) {
      if (id === renderId) el.table.innerHTML = `<div class="empty">Couldn't load the timetable (${esc(e.message)}).</div>`;
      return;
    }
    if (id !== renderId) return;

    const corridor = el.line.value.startsWith("c:") ? C.corridors.find((c) => "c:" + c.id === el.line.value) : null;
    const byName = state.byName;
    // interchanges in view: every line they need is shown
    const dir = el.dir.value;
    // `at` can be a list: whichever is better timed that day (Helensburgh on
    // weekdays, Thirroul at weekends)
    const active = (C.interchanges || []).map((ix, n) => {
      const alts = [].concat((dir === "up" ? ix.atUp : ix.atDown) || ix.at).map((name) => byName.get(name)).filter((x) => x !== undefined);
      return { ix, n, alts, at: alts[0] };
    }).filter(({ ix, at }) => at !== undefined && (ix.lines || []).every((l) => codes.includes(l) && !missing.includes(l)));
    const change = (rows, { ix, n, alts }) => {
      let best = null;
      for (const at of alts) {
        const c = connections(trips, rows, ix, n, at);
        if (!c) continue;
        const w = c.arrows.map((a) => a.mins).sort((x, y) => x - y);
        c.median = w[Math.floor(w.length / 2)];
        if (!best || c.median < best.median) best = c;
      }
      return best;
    };
    const splits = active.map(({ ix, n }) => ({
      ix, n, suffix: `~${n}`,
      own: new Set((ix.split || []).map((name) => byName.get(name))),
      ends: new Set([...(ix.split || []), ...[].concat(ix.at), ix.atUp, ix.atDown].filter(Boolean).map((name) => byName.get(name))),
      skip: ix.express ? new Set(ix.express.map((name) => byName.get(name))) : null,
      locals: ix.express ? new Set((ix.locals || [ix.at]).map((name) => byName.get(name))) : null,
      ids: null,
      side: ix.side ? new Set(ix.side.map((name) => byName.get(name))) : null,
    }));
    const all = [];
    const through = !corridor && C.through && C.through[codes[0]];
    // trains running on through Central Electric under a new run, maybe on
    // another line (a T2 on round the City Circle as a T8 run): in a line's
    // own timetable they join end to end, in a corridor only City Circle laps
    const throughLines = C.throughLines || [];
    let partners = new Map();
    if (codes.some((c) => throughLines.includes(c))) {
      const more = throughLines.filter((c) => !codes.includes(c) && state.index.lines[c] && state.index.lines[c].dates[day]);
      let extra = [];
      try {
        extra = await Promise.all(more.map(async (c) => [c, await getJSON(`lines/${encodeURIComponent(c)}/${state.index.lines[c].dates[day]}.json`)]));
      } catch (e) { extra = []; }
      if (id !== renderId) return;
      for (const [c, f] of [...files, ...extra]) for (const t of f.trips) { if (!partners.has(t.r)) partners.set(t.r, []); partners.get(t.r).push({ ...t, line: c }); }
    }
    for (const [line, f] of files) {
      let list = f.trips.map((t) => ({ ...t, line }));
      if (corridor && C.through && C.through[line]) list = throughHeads(list);
      if (throughLines.includes(line)) list = joinThrough(list, partners, { line, lineView: !corridor });
      if (!corridor && C.rounds && C.rounds[line]) list = joinRounds(list, byName.get(C.rounds[line]));
      for (const t of list) {
        const s = corridor ? clip(t.s, corridor, line) : t.s;
        if (!s) continue;
        const trip = { ...t, s, line };
        // feeders: trains of the feeder lines, or running only on the far
        // side, that start or end at the interchange (one running through is
        // a main-line train)
        for (const sp of splits) {
          if (trip.e) break;
          // express changes: the all-stations trains starting or ending at
          // one of ix.locals (Thirroul, Waterfall) are the feeders
          const ends = sp.skip ? sp.locals.has(s[0][0]) || sp.locals.has(s[s.length - 1][0])
            : sp.ends.has(s[0][0]) || sp.ends.has(s[s.length - 1][0]);
          const feeder = sp.skip ? s.some(([st, , , , flag]) => flag !== "p" && sp.skip.has(st))
            : sp.ix.feeders ? sp.ix.feeders.includes(line)
            : sp.side ? s.every(([st, , , , flag]) => flag === "p" || sp.ends.has(st) || sp.side.has(st)) : false;
          if (ends && feeder) {
            // their own rows at the split stations (Newcastle Interchange)
            trip.split = trip.split || new Map();
            for (const id of sp.own) trip.split.set(id, sp.suffix);
            trip.feeds = trip.feeds || new Set();
            trip.feeds.add(sp.n);
          }
        }
        all.push(trip);
      }
    }
    // non-revenue trains (the option): each one's longest stretch through
    // stations the timetable already has
    const X = state.index.lines.X;
    if (el.nonrev.checked && X && X.dates[day]) {
      const shown = new Set(all.flatMap((t) => t.s.map((x) => x[0])));
      const ecs = await getJSON(`lines/X/${X.dates[day]}.json`);
      if (id !== renderId) return;
      for (const t of ecs.trips) {
        let best = null, cur = null;
        t.s.forEach((x, i) => {
          if (!shown.has(x[0])) { cur = null; return; }
          cur = cur ? [cur[0], i] : [i, i];
          if (!best || cur[1] - cur[0] > best[1] - best[0]) best = [...cur];
        });
        if (best && best[1] > best[0]) all.push({ ...t, s: t.s.slice(best[0], best[1] + 1), line: "X", e: 1 });
      }
    }
    orient(all);
    for (const t of all) if (t.fixDir) t.dir = t.fixDir;   // a City Circle lap goes the way it came in
    const trips = [];
    for (const t of all) {
      if (t.dir !== el.dir.value) continue;
      const stops = keyed(t);
      trips.push({ ...t, stops, byKey: new Map(stops.map((s) => [s.key, s])) });
    }
    if (!trips.length) {
      el.table.innerHTML = '<div class="empty">No trains this way on this date.</div>';
      el.note.hidden = true;
      return;
    }
    sortTrips(trips);
    // stations: every one a train stops at today (or passes, with passing times on)
    const master = stationOrder(trips.filter((t) => !t.e).length ? trips.filter((t) => !t.e) : trips);
    // a change with split stations (Hamilton): the feeders' copies of them on
    // one side of the change station, the main line's on the other, all hard
    // against it: Broadmeadow, Newcastle Interchange (HUN), Hamilton arr,
    // change, Hamilton dep, Newcastle Interchange (CCN), Waratah
    const move = (key, next, after) => {
      if (!master.includes(key) || !master.includes(next) || key === next) return;
      master.splice(master.indexOf(key), 1);
      master.splice(master.indexOf(next) + (after ? 1 : 0), 0, key);
    };
    for (const { ix, n, at } of active) {
      if (!ix.split) continue;
      const mk = `${at}#1`, own = master.filter((k) => k.endsWith(`~${n}`));
      if (!master.includes(mk) || !own.length) continue;
      const before = master.indexOf(own[0]) < master.indexOf(mk);
      for (const k of own) move(k, mk, !before);
      for (const k of own) move(k.replace(/~\d+$/, ""), mk, before);
    }
    const branch = branches(master, trips.filter((t) => !t.e));
    let used = master.filter((k) => trips.some((t) => {
      const s = t.byKey.get(k);
      return s && (s.flag !== "p" || el.pass.checked);
    }));
    // station range: offer every station listed, keep the choice if it's still there
    // keep a station range someone chose, not the ends of another day's list
    // (Sunday's trackwork stopping short shouldn't cut Monday down)
    const prev = [(el.sfrom.selectedIndex > 0 && el.sfrom.value) || params.get("sf"),
                  (el.sto.selectedIndex >= 0 && el.sto.selectedIndex < el.sto.options.length - 1 && el.sto.value) || params.get("st")];
    params.delete("sf"); params.delete("st");
    // the City Circle (Central Electric, round the loop, Central Electric
    // again) is one choice, "City Circle": from its first station, to its last
    const stName = (k) => state.stations[Number(k.split("#")[0])][0];
    const loopNames = new Set(C.cityCircle || []);
    const groups = [];
    for (let i = 0; i < used.length; i++) {
      if (stName(used[i]) === C.throughAt) {
        let j = i + 1;
        while (j < used.length && loopNames.has(stName(used[j]))) j++;
        if (j > i + 1 && j < used.length && stName(used[j]) === C.throughAt) {
          groups.push({ name: "City Circle", first: used[i], last: used[j] });
          i = j;
          continue;
        }
      }
      groups.push({ name: stName(used[i]), first: used[i], last: used[i],
                    again: used.slice(0, i).some((x) => stName(x) === stName(used[i])) });
    }
    const opt = (g, k) => `<option value="${k}">${esc(g.name)}${g.again ? " (again)" : ""}</option>`;
    el.sfrom.innerHTML = groups.map((g) => opt(g, g.first)).join("");
    el.sto.innerHTML = groups.map((g) => opt(g, g.last)).join("");
    const firsts = groups.map((g) => g.first), lasts = groups.map((g) => g.last);
    el.sfrom.value = firsts.includes(prev[0]) ? prev[0] : firsts[0];
    el.sto.value = lasts.includes(prev[1]) ? prev[1] : lasts[lasts.length - 1];
    let a = used.indexOf(el.sfrom.value), b = used.indexOf(el.sto.value);
    if (a > b) [a, b] = [b, a];
    used = used.slice(a, b + 1);
    syncUrl();
    // trains calling within the range, by their first time there
    const lo = Number(el.from.value) * 3600, hi = Number(el.to.value) * 3600;
    const firstTime = (t) => {
      const first = used.map((k) => t.byKey.get(k)).find((s) => s && (s.flag !== "p" || t.e));
      return first ? first.t : null;
    };
    // a secondary train that takes passengers on from a primary one (HUN in
    // the Down direction) goes with the train it connects from
    const follow = new Map();
    for (const a of active) {
      const c = change(used, a);
      if (c && !c.secondaryFirst) for (const [t, m] of c.pairs) if (!follow.has(t)) follow.set(t, m);
    }
    const inRange = trips.filter((t) => {
      const ft = firstTime(follow.get(t) || t);
      return ft !== null && firstTime(t) !== null && ft >= lo && ft < hi;
    });
    used = used.filter((k) => inRange.some((t) => {
      const s = t.byKey.get(k);
      return s && (s.flag !== "p" || el.pass.checked);
    }));
    el.note.textContent = notes.join(" ");
    el.note.hidden = !notes.length;
    const changes = active.map((a) => change(used, a)).filter(Boolean);
    // each secondary train sits next to the one it connects with: before it
    // when it brings passengers in, after it when it takes them on
    let cols = inRange;
    for (const c of changes) {
      const shown = new Set(cols);
      const moved = new Set([...c.pairs].filter(([f, m]) => shown.has(f) && shown.has(m) && f !== m).map(([f]) => f));
      const next = [];
      for (const t of cols) {
        if (moved.has(t)) continue;
        const sec = [...c.pairs].filter(([f, m]) => m === t && moved.has(f)).map(([f]) => f);
        if (c.secondaryFirst) next.push(...sec, t); else next.push(t, ...sec);
      }
      cols = next;
    }
    el.table.innerHTML = inRange.length
      ? table(cols, used, { pass: el.pass.checked, plat: el.plat.checked, changes,
                            throughKey: `${byName.get(C.throughAt)}#1`, arrows: arrowMode, branch }, trips)
      : '<div class="empty">No trains in that range.</div>';
    if (arrowMode && inRange.length) {
      state.arrows = () => drawArrows(changes, cols);
      requestAnimationFrame(state.arrows);
    } else state.arrows = null;
  }

  async function init() {
    try {
      [state.index, state.stations] = await Promise.all([getJSON("index.json"), getJSON("stations.json")]);
    } catch (e) {
      el.table.innerHTML = `<div class="empty">Couldn't load the timetable data (${esc(e.message)}).</div>`;
      return;
    }
    state.byName = new Map(state.stations.map(([n], i) => [n, i]));
    fillOptions();
    const built = new Date(state.index.built);
    // dd/mm/yy
    const dmy = (d) => d.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "2-digit", month: "2-digit", year: "2-digit" });
    const ymd = (s) => dmy(new Date(`${s}T12:00:00+10:00`));
    el.updated.textContent = `Timetable as at ${dmy(built)} for period ${ymd(state.index.first)} - ${ymd(state.index.last)}`;
    for (const e of [el.line, el.dir]) e.addEventListener("change", () => { el.sfrom.value = ""; el.sto.value = ""; el.sfrom.innerHTML = ""; el.sto.innerHTML = ""; render(); });
    for (const e of [el.date, el.from, el.to, el.sfrom, el.sto, el.pass, el.plat, el.nonrev, el.run]) e.addEventListener("change", render);
    // highlight the column under the pointer, as rows are in CSS
    let hovered = -1;
    const mark = (i) => {
      if (i === hovered && (i < 1 || el.table.querySelector(".col-hover"))) return;  // same column, table not redrawn
      for (const c of el.table.querySelectorAll(".col-hover")) c.classList.remove("col-hover");
      hovered = i;
      if (i < 1) return;
      for (const row of el.table.querySelectorAll(".tt tr")) row.cells[i] && row.cells[i].classList.add("col-hover");
    };
    el.table.addEventListener("mouseover", (e) => {
      const c = e.target.closest("td, th");
      mark(c && c.closest(".tt") ? c.cellIndex : -1);
    });
    el.table.addEventListener("mouseleave", () => mark(-1));
    render();
  }

  init();
})();
