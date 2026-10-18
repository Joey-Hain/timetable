// Timetable: builds a classic station-by-train grid for a line or corridor on
// one day from the data the daily build publishes (see tools/build.py).
(() => {
  const C = window.TT_CONFIG;
  const $ = (id) => document.getElementById(id);
  const el = {
    line: $("line"), date: $("date"), dir: $("dir"), from: $("from"), to: $("to"),
    sfrom: $("sfrom"), sto: $("sto"),
    pass: $("pass"), plat: $("plat"), note: $("note"), table: $("table"), updated: $("updated"),
  };
  const state = { index: null, stations: null, files: new Map() };
  const params = new URLSearchParams(location.search);

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (t) => `${pad(Math.floor(t / 3600) % 24)}:${pad(Math.floor(t / 60) % 60)}`;
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
      (groups[lines[code].network] || groups.suburban).push(code);
    }
    const corridors = C.corridors.filter((c) => c.lines.some((l) => lines[l]));
    const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
    el.line.innerHTML =
      `<optgroup label="Corridors">${corridors.map((c) => opt("c:" + c.id, `${c.name} (${c.lines.join(" + ")})`)).join("")}</optgroup>` +
      [["suburban", "Sydney Trains"], ["intercity", "Intercity"], ["regional", "Regional"]]
        .filter(([k]) => groups[k].length)
        .map(([k, label]) => `<optgroup label="${label}">${groups[k].map((c) => opt("l:" + c, lineLabel(c))).join("")}</optgroup>`)
        .join("");
    const hours = [];
    for (let h = 0; h <= 28; h++) hours.push(h);
    const hl = (h) => (h >= 24 ? `${pad(h - 24)}:00 next day` : `${pad(h)}:00`);
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
    history.replaceState(null, "", "?" + p.toString());
  }

  // ------------------------------------------------------------ building the grid

  // A trip's stops keyed by station and visit number (City Circle trains pass
  // Central twice), with the time shown: departure, or arrival at the end.
  function keyed(trip) {
    const seen = new Map();
    return trip.s.map(([st, arr, dwell = 0, plat = "", flag = ""], i) => {
      const n = (seen.get(st) || 0) + 1;
      seen.set(st, n);
      const last = i === trip.s.length - 1;
      // picking up only at the start / setting down only at the end goes without saying
      if ((i === 0 && flag === "u") || (last && flag === "d")) flag = "";
      return { key: `${st}#${n}`, st, arr, dep: arr + dwell, t: last || flag === "p" ? arr : arr + dwell, plat, flag, last };
    });
  }

  // Merge every stopping pattern into one station order. Longest patterns go
  // first; a station not yet listed goes straight after the one before it, so
  // a branch stays together (Cronulla stations follow Sutherland).
  function stationOrder(trips) {
    const seqs = new Map();
    for (const t of trips) {
      const k = t.stops.map((s) => s.key).join(",");
      seqs.set(k, (seqs.get(k) || 0) + 1);
    }
    const order = [...seqs.entries()]
      .map(([k, n]) => [k.split(","), n])
      .sort((a, b) => b[0].length - a[0].length || b[1] - a[1]);
    const master = [];
    for (const [seq] of order) {
      let anchor = -1;
      let pending = [];
      for (const key of seq) {
        let i = master.indexOf(key);
        if (i >= 0) {
          if (pending.length) {
            master.splice(i, 0, ...pending);
            i += pending.length;
            pending = [];
          }
          anchor = i;
        } else if (anchor < 0) {
          pending.push(key);
        } else {
          master.splice(++anchor, 0, key);
        }
      }
      if (pending.length) master.push(...pending);
    }
    return master;
  }

  // Split trains into the two directions by the order they visit stations,
  // not by where they start and end, so through trains (T1 Emu Plains -
  // Berowra) and corridors line up. The longest train sets the order; others
  // follow or oppose it at the stations they share, passing it on to stations
  // the first one never reaches. The side most trains call "up" (towards
  // Central) is Up.
  function orient(trips) {
    if (!trips.length) return;
    const rank = new Map();
    const seed = trips.reduce((a, b) => (b.s.length > a.s.length ? b : a));
    seed.s.forEach(([st], i) => { if (!rank.has(st)) rank.set(st, i); });
    const sign = new Map([[seed, 1]]);
    for (let pass = 0; pass < 6; pass++) {
      let changed = false;
      for (const t of trips) {
        if (sign.has(t)) continue;
        const shared = t.s.filter(([st]) => rank.has(st));
        if (shared.length < 2) continue;
        const a = rank.get(shared[0][0]), b = rank.get(shared[shared.length - 1][0]);
        if (a === b) continue;
        const sg = b > a ? 1 : -1;
        sign.set(t, sg);
        changed = true;
        // stations only this train reaches get ranks between its neighbours
        let last = null;
        t.s.forEach(([st], i) => {
          if (rank.has(st)) { last = rank.get(st); return; }
          const r = last === null ? rank.get(shared[0][0]) - sg * (t.s.length - i) * 1e-3
            : last + sg * 1e-3;
          rank.set(st, r);
          last = r;
        });
      }
      if (!changed) break;
    }
    let upVotes = 0;
    for (const t of trips) if (sign.has(t)) upVotes += (t.d === "up" ? 1 : -1) * sign.get(t);
    const upSign = upVotes >= 0 ? 1 : -1;
    for (const t of trips) t.dir = sign.has(t) ? (sign.get(t) === upSign ? "up" : "down") : t.d;
  }

  // Order trains as they run: by their time at the busiest station, or for a
  // train that doesn't call there, by its time somewhere it shares with other
  // trains plus their usual running time from there.
  function sortTrips(trips) {
    const count = new Map();
    for (const t of trips) for (const s of t.stops) count.set(s.key, (count.get(s.key) || 0) + 1);
    let ref = null;
    for (const [k, n] of count) if (!ref || n > count.get(ref)) ref = k;
    const diffs = new Map();
    for (const t of trips) {
      const r = t.byKey.get(ref);
      if (!r) continue;
      for (const s of t.stops) {
        if (!diffs.has(s.key)) diffs.set(s.key, []);
        diffs.get(s.key).push(r.t - s.t);
      }
    }
    const median = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
    for (const t of trips) {
      const r = t.byKey.get(ref);
      if (r) { t.ref = r.t; continue; }
      let best = null;
      for (const s of t.stops) {
        const d = diffs.get(s.key);
        if (d && (!best || d.length > diffs.get(best.key).length)) best = s;
      }
      t.ref = best ? best.t + median(diffs.get(best.key)) : t.stops[0].t;
    }
    trips.sort((a, b) => a.ref - b.ref || a.line.localeCompare(b.line));
  }

  function cell(s, opts) {
    if (!s) return "<td></td>";
    const title = [`${s.flag === "p" ? "passes" : "arr"} ${hhmmss(s.arr)}`];
    if (s.flag !== "p" && s.dep !== s.arr) title.push(`dep ${hhmmss(s.dep)}`);
    if (s.plat) title.push(`platform ${s.plat}`);
    const attr = ` title="${esc(title.join(" · "))}"`;
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
    const working = (w, word) => (w ? `<span class="work">${word} ${esc(w[0])}${w[1] ? "" : " (empty)"}</span>` : "");
    let h = '<div class="tt-scroll"><table class="tt"><thead><tr><th class="stn"></th>';
    h += trips.map((t) =>
      `<th><span class="head">${esc(t.h)}</span>` +
      `<span class="line" style="background:${esc(lines[t.line].colour)}">${esc(t.line)}</span>` +
      `<span class="run">${esc(t.r)}</span><span class="set" title="${esc(sets[t.v] || "")}">${esc(set(t.v))}</span>` +
      `${working(t.b, "from")}</th>`).join("");
    h += "</tr></thead><tbody>";
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
      h += `<tr${gap}><th class="stn">${esc(names[st][0])}</th>` + trips.map((t) => cell(t.byKey.get(key), opts)).join("") + "</tr>";
    });
    h += '</tbody><tfoot><tr><th class="stn">Forms</th>' + trips.map((t) =>
      `<td>${t.f ? esc(t.f[0]) + (t.f[1] ? "" : '<span class="work"> empty</span>') : ""}</td>`).join("") + "</tr></tfoot>";
    return h + "</table></div>";
  }

  // ------------------------------------------------------------ render

  let renderId = 0;
  async function render() {
    syncUrl();
    const id = ++renderId;
    const codes = selectedLines();
    const day = el.date.value;
    const notes = [];
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

    const all = [];
    for (const [line, f] of files) for (const t of f.trips) all.push({ ...t, line });
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
    const master = stationOrder(trips);
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
    const inRange = trips.filter((t) => {
      const first = used.map((k) => t.byKey.get(k)).find((s) => s && s.flag !== "p");
      return first && first.t >= lo && first.t < hi;
    });
    used = used.filter((k) => inRange.some((t) => {
      const s = t.byKey.get(k);
      return s && (s.flag !== "p" || el.pass.checked);
    }));
    notes.unshift(`${inRange.length} trains${inRange.length !== trips.length ? ` of ${trips.length}` : ""}, ${used.length} stations.`);
    el.note.textContent = notes.join(" ");
    el.note.hidden = false;
    el.table.innerHTML = inRange.length
      ? table(inRange, used, { pass: el.pass.checked, plat: el.plat.checked }, trips)
      : '<div class="empty">No trains in that range.</div>';
  }

  async function init() {
    try {
      [state.index, state.stations] = await Promise.all([getJSON("index.json"), getJSON("stations.json")]);
    } catch (e) {
      el.table.innerHTML = `<div class="empty">Couldn't load the timetable data (${esc(e.message)}).</div>`;
      return;
    }
    fillOptions();
    const built = new Date(state.index.built);
    el.updated.textContent = ` · timetable downloaded ${built.toLocaleString("en-AU", { timeZone: "Australia/Sydney", dateStyle: "medium", timeStyle: "short", hour12: false })}, covers ${state.index.first} to ${state.index.last}`;
    for (const e of [el.line, el.dir]) e.addEventListener("change", () => { el.sfrom.value = ""; el.sto.value = ""; el.sfrom.innerHTML = ""; el.sto.innerHTML = ""; render(); });
    for (const e of [el.date, el.from, el.to, el.sfrom, el.sto, el.pass, el.plat]) e.addEventListener("change", render);
    render();
  }

  init();
})();
