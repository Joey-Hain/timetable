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
        .join("");
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
    return trip.s.map(([st, arr, dwell = 0, plat = "", flag = ""], i) => {
      const k = (seen.get(st) || 0) + 1;
      seen.set(st, k);
      const n = trip.dir === "down" ? total.get(st) - k + 1 : k;
      const last = i === trip.s.length - 1;
      // picking up only at the start / setting down only at the end goes without saying
      if ((i === 0 && flag === "u") || (last && flag === "d")) flag = "";
      const base = `${st}#${n}`;
      return { key: base + (split.get(st) || ""), base, st, arr, dep: arr + dwell,
               t: last || flag === "p" ? arr : arr + dwell, plat, flag, last };
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
  function joinThrough(trips, cfg) {
    const at = state.byName.get(cfg.at), via = state.byName.get(cfg.down);
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
      out.push({ ...a, s: [...a.s.slice(0, -1), join, ...b.s.slice(1)], h: finalHead(a, b, cfg), f: b.f, rb: b.r,
                 vote: b.s.some((x) => x[0] === via) ? "down" : "up" });
    }
    for (const t of trips) if (!used.has(t)) out.push(t);
    return out;
  }

  // The headboard a through train shows: its own if that already names where
  // it ends up ("Penrith via Gordon"), otherwise where it ends up via the
  // through station ("Hornsby via Central", not "Central")
  function finalHead(a, b, cfg) {
    const end = state.stations[b.s[b.s.length - 1][0]][0];
    return a.h.startsWith(end) ? a.h : `${end} via ${cfg.via || "Central"}`;
  }

  // In a corridor a through line's trains stay as two runs, but the first
  // shows the headboard of where it ends up
  function throughHeads(trips, cfg) {
    const at = state.byName.get(cfg.at);
    const byRun = new Map(trips.map((t) => [t.r, t]));
    return trips.map((a) => {
      const b = a.f && a.f[1] ? byRun.get(a.f[0]) : null;
      return b && a.s[a.s.length - 1][0] === at && b.s[0][0] === at ? { ...a, h: finalHead(a, b, cfg) } : a;
    });
  }

  // The part of a train's run inside a corridor (see config.js), or null.
  function clip(stops, c) {
    if (!c.stations && !c.exclude) return stops;
    const name = (st) => state.stations[st][0];
    const keep = c.stations ? new Set(c.stations) : null;
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
    const sk = ix.split ? `${mk}~${n}` : mk;
    const mi = rows.indexOf(mk), si = rows.indexOf(sk);
    if (mi < 0 || si < 0) return null;
    let secondaryFirst, isSecondary, after;
    if (ix.split) {
      secondaryFirst = si < mi;
      isSecondary = (t) => t.byKey.has(sk);
      const own = rows.map((k, i) => (k.endsWith(`~${n}`) ? i : -1)).filter((i) => i >= 0);
      after = secondaryFirst ? Math.max(...own) : Math.min(...own) - 1;
    } else {
      // all-stations trains call at some of ix.express, the expresses at none
      const skip = new Set(ix.express.map((name) => state.byName.get(name)));
      const skipRows = rows.map((k, i) => (skip.has(Number(k.split("#")[0])) ? i : -1)).filter((i) => i >= 0);
      if (!skipRows.length) return null;
      secondaryFirst = skipRows[0] < mi;   // the locals have been calling before the change
      // locals that start (or, going the other way, end) at one of ix.locals:
      // an all-stations train through from Sydney isn't part of the change
      const ends = new Set((ix.locals || [ix.at]).map((name) => state.byName.get(name)));
      isSecondary = (t) => t.stops.some((x) => skip.has(x.st) && x.flag !== "p") &&
        ends.has((secondaryFirst ? t.stops[t.stops.length - 1] : t.stops[0]).st);
      after = mi;
    }
    const gap = (ix.minutes ?? 2) * 60, most = (ix.maxMinutes ?? 30) * 60;
    const calls = (t, k) => { const x = t.byKey.get(k); return x && x.flag !== "p" ? x : null; };
    // ix.only: both trains on these lines (no change into a regional train,
    // which has to be booked)
    const ok = (t) => !ix.only || ix.only.includes(t.line);
    // non-revenue trains (specials, charters) take no part in a change
    const prim = trips.filter((t) => !t.e && ok(t) && !isSecondary(t) && calls(t, mk));
    const cells = new Map(), pairs = new Map(), arrows = [], arrowCells = new Map();
    const add = (t, html) => cells.set(t, (cells.get(t) ? cells.get(t) + "<br>" : "") + html);
    for (const t of trips) {
      const s = !t.e && ok(t) && isSecondary(t) && calls(t, sk);
      if (!s) continue;
      // a feeder has to start or end here; one running through is a main-line train
      if (ix.split && !(secondaryFirst ? t.stops[t.stops.length - 1].key === sk || t.stops.slice(-2).some((x) => x.key === sk)
                                       : t.stops[0].key === sk || t.stops.slice(0, 2).some((x) => x.key === sk))) continue;
      let best = null;
      for (const m of prim) {
        const ms = calls(m, mk);
        const wait = secondaryFirst ? ms.dep - s.arr : s.dep - ms.arr;
        if (wait >= gap && wait <= most && (!best || wait < best.wait)) best = { m, wait };
      }
      if (!best) continue;
      pairs.set(t, best.m);
      // each side names the other train and when it's there:
      //   arriving train: "to N418 / dep 06:42, 5 min"
      //   leaving train:  "from V710 / arr 06:38"
      const ms = calls(best.m, mk);
      const mins = Math.round(best.wait / 60);
      const wait = `<span class="work">, ${mins} min</span>`;
      const [inT, inS, outT, outS] = secondaryFirst ? [t, s, best.m, ms] : [best.m, ms, t, s];
      // arrow mode (?arrows=1): a line from the arriving train to the leaving
      // one, as the NSW TrainLink regional timetables draw connections
      arrows.push({ inT, inKey: secondaryFirst ? sk : mk, outT, outKey: secondaryFirst ? mk : sk });
      if (!arrowCells.has(outT)) arrowCells.set(outT, `<span class="work wait">${mins} min</span>`);
      add(inT, `to <b>${esc(outT.r)}</b><br><span class="work">dep ${hhmm(outS.dep)}</span>${wait}`);
      add(outT, `from <b>${esc(inT.r)}</b><br><span class="work">arr ${hhmm(inS.arr)}</span>`);
    }
    if (!pairs.size) return null;
    return { after, cells, pairs, arrows, arrowCells, secondaryFirst, label: `Change at ${state.stations[at][0]}` };
  }

  const KIND = { ecs: "Empty cars", mtpv: "MTPV", special: "Special", charter: "Charter" };
  const KIND_COLOUR = { ecs: "#888888", mtpv: "#8a6a3a", special: "#7a4f9e", charter: "#7a4f9e" };

  function cell(s, opts, t) {
    if (!s) return "<td></td>";
    const title = [`${s.flag === "p" ? "passes" : "arr"} ${hhmmss(s.arr)}`];
    if (s.flag !== "p" && s.dep !== s.arr) title.push(`dep ${hhmmss(s.dep)}`);
    if (s.plat) title.push(`platform ${s.plat}`);
    const attr = ` title="${esc(title.join(", "))}"`;
    // empty runs and MTPV: every timing point; specials and charters as
    // trains, greyed
    if (t && t.e && (s.flag !== "p" || t.c === "ecs" || t.c === "mtpv")) {
      return `<td class="ecs"${attr}>${hhmm(s.t)}${s.flag && s.flag !== "p" ? `<span class="flag">${s.flag}</span>` : ""}</td>`;
    }
    if (s.flag === "p") {
      return opts.pass ? `<td class="pass"${attr}>${hhmm(s.t)}</td>` : `<td class="pass"${attr}>|</td>`;
    }
    const flag = s.flag ? `<span class="flag">${s.flag}</span>` : "";
    const plat = opts.plat && s.plat ? `<span class="plat">${esc(s.plat)}</span>` : "";
    return `<td${attr}>${hhmm(s.t)}${flag}${plat}</td>`;
  }

  function table(trips, master, opts, allTrips) {
    const names = state.stations;
    const lines = state.index.lines;
    const sets = state.index.sets || {};
    // set type number first (8B, not B8, which reads like a line)
    const set = (v) => String(v || "").replace(/^([A-Za-z]+)(\d+)$/, "$2$1");
    const working = (w) => (w ? esc(w[0]) + (w[1] ? "" : '<span class="work"> empty</span>') : "");
    let h = '<div class="tt-scroll"><table class="tt"><thead><tr><th class="stn"></th>';
    h += trips.map((t) =>
      `<th${t.e ? ' class="ecs"' : ""}><span class="head">${esc(t.h)}</span>` +
      `<span class="line" style="background:${esc(t.e ? KIND_COLOUR[t.c] || "#888888" : lines[t.line].colour)}">${esc(t.e ? KIND[t.c] || "Non-revenue" : t.line)}</span>` +
      `<span class="run">${esc(t.r)}</span><span class="set" title="${esc(sets[t.v] || "")}">${esc(set(t.v))}</span>` +
      `</th>`).join("");
    h += '</tr></thead><tbody><tr class="worked"><th class="stn">Formed by</th>' +
      trips.map((t) => `<td>${working(t.b)}</td>`).join("") + "</tr>";
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
      h += `<tr${gap} data-k="${key}"><th class="stn">${esc(names[st][0])}</th>` + trips.map((t) => cell(t.byKey.get(key), opts, t)).join("") + "</tr>";
      // through trains change run number here (T1 at Central Electric)
      if (key === opts.throughKey && trips.some((t) => t.rb)) {
        h += '<tr class="change"><th class="stn">Continues as</th>' + trips.map((t) =>
          `<td>${t.rb && t.byKey.has(key) ? `<b>${esc(t.rb)}</b>` : ""}</td>`).join("") + "</tr>";
      }
      for (const c of opts.changes || []) {
        if (c.after !== i) continue;
        h += `<tr class="change"><th class="stn">${esc(c.label)}</th>` +
          trips.map((t) => `<td>${(opts.arrows ? c.arrowCells : c.cells).get(t) || ""}</td>`).join("") + "</tr>";
      }
    });
    // a regional train cut to this area says where it goes on to or came from
    const beyond = (t) => [t.t && `continues to ${esc(t.t)}`, t.o && `arrives from ${esc(t.o)}`]
      .filter(Boolean).map((x) => `<span class="work">${x}</span>`).join("<br>");
    h += '</tbody><tfoot><tr><th class="stn">Forms</th>' + trips.map((t) =>
      `<td>${[working(t.f), beyond(t)].filter(Boolean).join("<br>")}</td>`).join("") + "</tr></tfoot>";
    return h + "</table></div>";
  }

  // ------------------------------------------------------------ render

  // One run on its own (the Run box): every line that day, non-revenue
  // included, through trains joined, its whole journey
  async function renderRun(run, day, id) {
    const codes = Object.keys(state.index.lines).filter((c) => state.index.lines[c].dates[day]);
    el.table.innerHTML = '<div class="empty">Loading…</div>';
    let found = null;
    try {
      for (const c of codes) {
        const f = await getJSON(`lines/${encodeURIComponent(c)}/${state.index.lines[c].dates[day]}.json`);
        const thr = C.through && C.through[c];
        const t = (thr ? joinThrough(f.trips, thr) : f.trips)
          .find((x) => x.r.toUpperCase() === run || (x.rb || "").toUpperCase() === run);
        if (t) { found = { ...t, line: c, e: c === "X" ? 1 : 0 }; break; }
      }
    } catch (e) {
      if (id === renderId) el.table.innerHTML = `<div class="empty">Couldn't load the timetable (${esc(e.message)}).</div>`;
      return;
    }
    if (id !== renderId) return;
    el.note.hidden = true;
    if (!found) {
      el.table.innerHTML = `<div class="empty">No run ${esc(run)} on ${esc(day)}.</div>`;
      return;
    }
    found.dir = found.d;
    found.stops = keyed(found);
    found.byKey = new Map(found.stops.map((s) => [s.key, s]));
    const rows = found.stops.filter((s) => s.flag !== "p" || el.pass.checked || found.e).map((s) => s.key);
    const thr = C.through && C.through[found.line];
    el.table.innerHTML = table([found], rows, { pass: el.pass.checked, plat: el.plat.checked, changes: [],
      throughKey: thr ? `${state.byName.get(thr.at)}#1` : null }, [found]);
  }

  const arrowMode = params.get("arrows") === "1";

  // Connection arrows over the table: down from below the arriving train's
  // last time to the row the other train leaves from, then across to it
  function drawArrows(changes, cols) {
    const scroll = el.table.querySelector(".tt-scroll");
    const table = scroll && scroll.querySelector(".tt");
    if (!table) return;
    for (const x of scroll.querySelectorAll("svg.arrows")) x.remove();
    const col = new Map(cols.map((t, i) => [t, i + 1]));
    const rows = [...table.querySelectorAll("tbody tr")];
    const rowOf = new Map(rows.filter((r) => r.dataset.k).map((r) => [r.dataset.k, r]));
    const base = table.getBoundingClientRect();
    const box = (c) => { const r = c.getBoundingClientRect(); return { l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top }; };
    let d = "";
    for (const c of changes) {
      for (const a of c.arrows) {
        const ci = col.get(a.inT), co = col.get(a.outT), ri = rowOf.get(a.inKey), ro = rowOf.get(a.outKey);
        if (!ci || !co || !ri || !ro) continue;
        const iIn = rows.indexOf(ri), iOut = rows.indexOf(ro);
        let from = ri;  // a train running on past the change (CCN to Newcastle) starts below its last time
        for (let k = iIn + 1; k < iOut; k++) if (rows[k].dataset.k && rows[k].cells[ci] && rows[k].cells[ci].textContent.trim()) from = rows[k];
        const s = box(from.cells[ci]), t = box(ro.cells[co]);
        const x0 = (s.l + s.r) / 2, tc = (t.l + t.r) / 2, half = 21;
        const x1 = co > ci ? tc - half : tc + half;
        if (iOut > iIn) d += `M${x0},${s.b - 3}V${(t.t + t.b) / 2}H${x1}`;
        else {
          // same row (express and all stations at Thirroul): down into the
          // "Change at" row below, across, and up into the other train
          const under = rows[iOut + 1] && rows[iOut + 1].classList.contains("change") ? box(rows[iOut + 1].cells[0]) : null;
          const y = under ? (under.t + under.b) / 2 : s.b + 6;
          d += `M${x0},${s.b - 3}V${y}H${tc}V${t.b - 3}`;
        }
      }
    }
    if (!d) return;
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "arrows");
    svg.setAttribute("width", table.offsetWidth);
    svg.setAttribute("height", table.offsetHeight);
    svg.innerHTML = `<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
      `<path d="M0,1L9,5L0,9z" fill="currentColor"/></marker></defs>` +
      d.split("M").filter(Boolean).map((p) => `<path d="M${p}" marker-end="url(#ah)"/>`).join("");
    svg.style.left = table.offsetLeft + "px";
    svg.style.top = table.offsetTop + "px";
    scroll.appendChild(svg);
  }
  window.addEventListener("resize", () => state.arrows && state.arrows());

  let renderId = 0;
  async function render() {
    syncUrl();
    // a through line names its directions by where trains go (config.js `through`)
    const thr = el.line.value.startsWith("l:") && C.through && C.through[el.line.value.slice(2)];
    el.dir.options[0].text = thr ? thr.labels[0] : "Down";
    el.dir.options[1].text = thr ? thr.labels[1] : "Up";
    const id = ++renderId;
    const codes = selectedLines();
    const day = el.date.value;
    const notes = [];
    if (el.run.value.trim()) return renderRun(el.run.value.trim().toUpperCase(), day, id);
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
    const active = (C.interchanges || []).map((ix, n) => ({ ix, n, at: byName.get((dir === "up" ? ix.atUp : ix.atDown) || ix.at) }))
      .filter(({ ix, at }) => at !== undefined && (ix.lines || []).every((l) => codes.includes(l) && !missing.includes(l)));
    const splits = active.filter(({ ix }) => ix.split).map(({ ix, n }) => ({
      ix, suffix: `~${n}`,
      ids: new Set(ix.split.map((name) => byName.get(name))),
      side: ix.side ? new Set(ix.side.map((name) => byName.get(name))) : null,
    }));
    const all = [];
    const through = !corridor && C.through && C.through[codes[0]];
    for (const [line, f] of files) {
      const thr = C.through && C.through[line];
      for (const t of (through ? joinThrough(f.trips, through) : thr ? throughHeads(f.trips, thr) : f.trips)) {
        const s = corridor ? clip(t.s, corridor) : t.s;
        if (!s) continue;
        const trip = { ...t, s, line };
        // feeders: trains of the feeder lines, or running only on the far
        // side, that start or end at the interchange (one running through is
        // a main-line train)
        for (const sp of splits) {
          if (trip.e) break;
          const ends = sp.ids.has(s[0][0]) || sp.ids.has(s[s.length - 1][0]);
          const feeder = sp.ix.feeders ? sp.ix.feeders.includes(line)
            : s.every(([st, , , , flag]) => flag === "p" || sp.ids.has(st) || sp.side.has(st));
          if (ends && feeder) {
            trip.split = trip.split || new Map();
            for (const id of sp.ids) trip.split.set(id, sp.suffix);
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
    let used = master.filter((k) => trips.some((t) => {
      const s = t.byKey.get(k);
      return s && (s.flag !== "p" || el.pass.checked);
    }));
    // station range: offer every station listed, keep the choice if it's still there
    const prev = [el.sfrom.value || params.get("sf"), el.sto.value || params.get("st")];
    params.delete("sf"); params.delete("st");
    const opts = used.map((k, i) => `<option value="${k}">${esc(state.stations[Number(k.split("#")[0])][0])}${
      used.slice(0, i).some((x) => x.split("#")[0] === k.split("#")[0]) ? " (again)" : ""}</option>`).join("");
    el.sfrom.innerHTML = opts;
    el.sto.innerHTML = opts;
    el.sfrom.value = used.includes(prev[0]) ? prev[0] : used[0];
    el.sto.value = used.includes(prev[1]) ? prev[1] : used[used.length - 1];
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
    for (const { ix, n, at } of active) {
      const c = connections(trips, used, ix, n, at);
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
    const changes = active.map(({ ix, n, at }) => connections(trips, used, ix, n, at)).filter(Boolean);
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
                            throughKey: through ? `${byName.get(through.at)}#1` : null, arrows: arrowMode }, trips)
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
