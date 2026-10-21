// Graph: a train graph (time across, track distance down) for a line or
// corridor on one day, along one continuous route the user picks: top and
// bottom stations, optionally via a third. Same data as the timetable; track
// distances from track.json (the build measures them along the route shapes).
(() => {
  const C = window.TT_CONFIG;
  const $ = (id) => document.getElementById(id);
  const el = {
    line: $("line"), date: $("date"), sfrom: $("sfrom"), sto: $("sto"), via: $("via"),
    dir: $("dir"), from: $("from"), to: $("to"), nonrev: $("nonrev"), note: $("note"), graph: $("graph"), updated: $("updated"),
  };
  const state = { index: null, stations: null, track: {}, files: new Map(), view: null };
  const params = new URLSearchParams(location.search);
  const CENTRAL = [-33.8832, 151.2065];
  const KIND_COLOUR = { ecs: "#888888", mtpv: "#8a6a3a", special: "#7a4f9e", charter: "#7a4f9e" };
  const KIND = { ecs: "Empty cars", mtpv: "Goods / test", special: "Special", charter: "Charter" };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const hhmm = (t) => `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}`;
  const hhmmss = (t) => t % 60 ? `${hhmm(t)}½` : hhmm(t);

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
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  }
  function crow(a, b) {   // metres, straight line
    const r = Math.PI / 180, la1 = a[0] * r, la2 = b[0] * r;
    return 6371000 * Math.hypot((b[1] - a[1]) * r * Math.cos((la1 + la2) / 2), la2 - la1);
  }
  const name = (i) => state.stations[i][0];

  // ------------------------------------------------------------ options

  function fillOptions() {
    const lines = state.index.lines;
    const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
    const groups = { suburban: [], intercity: [], regional: [] };
    for (const code of Object.keys(lines).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
      if (lines[code].network === "nonrev") continue;
      (groups[lines[code].network] || groups.suburban).push(code);
    }
    const label = (c) => { const n = lines[c].name || c; return n.startsWith(c) ? n : `${c} ${n}`; };
    el.line.innerHTML =
      `<optgroup label="Corridors">${C.corridors.filter((c) => c.lines.some((l) => lines[l])).map((c) => opt("c:" + c.id, c.name)).join("")}</optgroup>` +
      [["suburban", "Sydney Trains"], ["intercity", "Intercity"], ["regional", "Regional"]].filter(([k]) => groups[k].length)
        .map(([k, l]) => `<optgroup label="${l}">${groups[k].map((c) => opt("l:" + c, label(c))).join("")}</optgroup>`).join("");
    const hl = (h) => `${pad(h)}:00`;
    el.from.innerHTML = [...Array(24).keys()].map((h) => opt(h, hl(h))).join("");
    el.to.innerHTML = [...Array(28).keys()].map((h) => h + 1).map((h) => opt(h, h === 28 ? "End of service" : hl(h))).join("");
    el.from.value = "7"; el.to.value = "10";
    el.date.min = state.index.first; el.date.max = state.index.last;
    const today = sydneyToday();
    el.date.value = today >= state.index.first && today <= state.index.last ? today : state.index.first;
    for (const [k, e] of [["l", el.line], ["d", el.date], ["dir", el.dir], ["from", el.from], ["to", el.to]]) {
      const v = params.get(k);
      if (v && e === el.date) { if (v >= state.index.first && v <= state.index.last) e.value = v; }
      else if (v && [...e.options].some((o) => o.value === v)) e.value = v;
    }
    el.nonrev.checked = params.get("nr") === "1";
    if (!el.line.value) el.line.selectedIndex = 0;
  }
  function selectedLines() {
    const [kind, id] = el.line.value.split(":");
    return kind === "c" ? C.corridors.find((c) => c.id === id).lines.filter((l) => state.index.lines[l]) : [id];
  }
  function syncUrl() {
    const p = new URLSearchParams();
    p.set("l", el.line.value); p.set("d", el.date.value);
    if (el.sfrom.value) p.set("sf", name(+el.sfrom.value));
    if (el.sto.value) p.set("st", name(+el.sto.value));
    if (el.via.value) p.set("via", name(+el.via.value));
    p.set("dir", el.dir.value);
    p.set("from", el.from.value); p.set("to", el.to.value);
    if (el.nonrev.checked) p.set("nr", "1");
    history.replaceState(null, "", "?" + p.toString());
  }

  // ------------------------------------------------------------ the network the trains use

  function edgeLength(a, b) {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    return state.track[k] || crow(state.stations[a].slice(1), state.stations[b].slice(1)) * 1.1;
  }
  // stations next to each other in some train's stops, without "skip" edges:
  // an express that lists only the ends of a stretch (the East Hills fast
  // lines) would otherwise give a route that leaves out the stations between
  function network(trips) {
    const adj = new Map();
    const add = (a, b) => {
      if (a === b) return;
      if (!adj.has(a)) adj.set(a, new Map());
      if (!adj.has(b)) adj.set(b, new Map());
      const w = edgeLength(a, b);
      adj.get(a).set(b, w); adj.get(b).set(a, w);
    };
    const uses = new Map();
    for (const t of trips) for (let i = 1; i < t.s.length; i++) {
      const a = t.s[i - 1][0], b = t.s[i][0];
      add(a, b);
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      uses.set(k, (uses.get(k) || 0) + 1);
    }
    const edges = [];
    for (const [a, m] of adj) for (const [b, w] of m) if (a < b) edges.push([a, b, w]);
    for (const [a, b, w] of edges) {
      const alt = shortest(adj, a, b, [a, b], w * 1.04 + 300);
      if (alt && alt.path.length > 2) { adj.get(a).delete(b); adj.get(b).delete(a); }
    }
    // routes keep to the way most trains go: a little-used stretch counts
    // longer (T8 by the Airport, not the few trains via Sydenham)
    for (const [a, m] of adj) for (const [b, w] of m) m.set(b, w * (1 + 4 / (uses.get(a < b ? `${a},${b}` : `${b},${a}`) || 1)));
    return adj;
  }
  function shortest(adj, from, to, skip, limit = Infinity) {
    const dist = new Map([[from, 0]]), prev = new Map(), done = new Set();
    for (;;) {
      let u = null, du = Infinity;
      for (const [k, d] of dist) if (!done.has(k) && d < du) { u = k; du = d; }
      if (u === null || du > limit) return null;
      if (u === to) break;
      done.add(u);
      for (const [v, w] of adj.get(u) || []) {
        if (skip && u === skip[0] && v === skip[1]) continue;
        if (skip && u === skip[1] && v === skip[0]) continue;
        const nd = du + w;
        if (nd < (dist.has(v) ? dist.get(v) : Infinity)) { dist.set(v, nd); prev.set(v, u); }
      }
    }
    const path = [to];
    while (path[path.length - 1] !== from) path.push(prev.get(path[path.length - 1]));
    return { path: path.reverse(), length: dist.get(to) };
  }

  function fillStations(adj, trips) {
    const ids = [...adj.keys()].sort((a, b) => name(a).localeCompare(name(b)));
    const opts = ids.map((i) => `<option value="${i}">${esc(name(i))}</option>`).join("");
    const keep = [el.sfrom.value, el.sto.value, el.via.value];
    el.sfrom.innerHTML = opts; el.sto.innerHTML = opts;
    el.via.innerHTML = `<option value="">None</option>` + opts;
    const byName = (n) => ids.find((i) => name(i) === n);
    const pick = (e, v, p) => {
      const i = v !== "" && adj.has(+v) ? +v : byName(params.get(p));
      if (i !== undefined) e.value = String(i);
      return i !== undefined;
    };
    let ok = pick(el.sfrom, keep[0], "sf") & pick(el.sto, keep[1], "st");
    pick(el.via, keep[2], "via") || (el.via.value = "");
    for (const k of ["sf", "st", "via"]) params.delete(k);   // the address only counts on arrival
    if (!ok) {
      // the commonest pair of ends among the day's trains, the end nearer Sydney on top
      const n = new Map();
      const [kind, id] = el.line.value.split(":");
      const c = kind === "c" ? C.corridors.find((x) => x.id === id) : null;
      const inView = (i) => !c || (c.stations ? c.stations.includes(name(i)) : !(c.exclude || []).includes(name(i)));
      for (const t of trips) {
        // the ends of its stretch in the corridor
        const s = t.s.filter((x) => inView(x[0]));
        if (s.length < 2) continue;
        const a = s[0][0], b = s[s.length - 1][0];
        if (!adj.has(a) || !adj.has(b) || a === b) continue;
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        n.set(k, (n.get(k) || 0) + t.s.length);
      }
      const best = [...n].sort((x, y) => y[1] - x[1])[0];
      if (best) {
        let [a, b] = best[0].split(",").map(Number);
        if (crow(state.stations[a].slice(1), CENTRAL) > crow(state.stations[b].slice(1), CENTRAL)) [a, b] = [b, a];
        el.sfrom.value = String(a); el.sto.value = String(b);
      }
    }
  }

  // ------------------------------------------------------------ drawing

  function plotRoute(adj) {
    const a = +el.sfrom.value, b = +el.sto.value, v = el.via.value === "" ? null : +el.via.value;
    if (a === b) return null;
    const legs = v === null || v === a || v === b ? [[a, b]] : [[a, v], [v, b]];
    let path = [];
    for (const [x, y] of legs) {
      const r = shortest(adj, x, y);
      if (!r) return null;
      path = path.length ? path.concat(r.path.slice(1)) : r.path;
    }
    const seen = new Set();
    if (path.some((s) => seen.has(s) || !seen.add(s))) return null;   // goes back over itself
    const km = [0];
    for (let i = 1; i < path.length; i++) km.push(km[i - 1] + edgeLength(path[i - 1], path[i]) / 1000);
    // up = towards Sydney: towards whichever end of the route is nearer Central
    const upTop = crow(state.stations[path[0]].slice(1), CENTRAL) <= crow(state.stations[path[path.length - 1]].slice(1), CENTRAL);
    return { path, km, at: new Map(path.map((s, i) => [s, i])), upTop };
  }

  // each train's runs along the route in the direction shown: [[time, km],
  // ...]; a run breaks where the train leaves the route or turns back
  function runsOf(t, route) {
    const out = [];
    let cur = [], last = -1, way = 0;
    const flush = () => {
      if (cur.length > 1 && way) {
        const up = (way < 0) === route.upTop;   // km falls going towards the top
        if (up === (el.dir.value === "up")) out.push(cur);
      }
      cur = []; last = -1; way = 0;
    };
    const n = t.s.length;
    t.s.forEach((s, k) => {
      const i = route.at.get(s[0]);
      if (i === undefined) { flush(); return; }
      if (last >= 0 && i === last) flush();
      if (last >= 0) {
        const w = Math.sign(i - last);
        if (way && w !== way) {   // turns back: start again from here
          const keep = cur[cur.length - 1];
          flush(); cur.push(keep);
        }
        way = w;
      }
      // a train waiting to start, or standing after it ends, isn't drawn
      const arr = k === 0 ? s[1] + (s[2] || 0) : s[1], dep = k === n - 1 ? s[1] : s[1] + (s[2] || 0);
      cur.push([arr, route.km[i]]);
      if (dep !== arr) cur.push([dep, route.km[i]]);
      last = i;
    });
    flush();
    return out;
  }

  function draw(route, trips) {
    const t0 = +el.from.value * 3600, t1 = +el.to.value * 3600;
    const total = route.km[route.km.length - 1];
    const wrapW = Math.max(320, el.graph.clientWidth || 900);
    const mobile = wrapW < 700;
    const LABEL = mobile ? 96 : 150, TOP = 30, BOT = 30;
    const minutes = (t1 - t0) / 60;
    const W = Math.max(wrapW - LABEL - 2, minutes * (mobile ? 5 : 8));
    const H = Math.round(Math.min(2200, Math.max(520, total * (mobile ? 16 : 22)))) + TOP + BOT;
    const x = (t) => (t - t0) / (t1 - t0) * W;
    const y = (km) => TOP + km / total * (H - TOP - BOT);

    el.graph.innerHTML = `<div class="gr-scroll"><div class="gr-labels" style="width:${LABEL}px;height:${H}px"></div>` +
      `<div class="gr-plot"><canvas class="gr-base"></canvas><canvas class="gr-over"></canvas></div><div class="gr-tip" hidden></div></div>`;
    const labels = el.graph.querySelector(".gr-labels"), plot = el.graph.querySelector(".gr-plot");
    const base = el.graph.querySelector(".gr-base"), over = el.graph.querySelector(".gr-over"), tip = el.graph.querySelector(".gr-tip");
    const dpr = window.devicePixelRatio || 1;
    for (const c of [base, over]) {
      c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
      c.style.width = W + "px"; c.style.height = H + "px";
    }
    plot.style.width = W + "px"; plot.style.height = H + "px";
    const g = base.getContext("2d");
    g.scale(dpr, dpr);
    g.font = "11px Helvetica, Arial, sans-serif";

    // stations: a rule each, names on the left (skipping any that would crowd)
    let lastY = -99, html = "";
    route.path.forEach((s, i) => {
      const yy = y(route.km[i]);
      g.strokeStyle = "#e3e3e3"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, Math.round(yy) + 0.5); g.lineTo(W, Math.round(yy) + 0.5); g.stroke();
      const end = i === 0 || i === route.path.length - 1;
      if (yy - lastY >= 13 || end) {
        html += `<span style="top:${yy}px"${end ? ' class="end"' : ""}>${esc(name(s))}</span>`;
        lastY = yy;
      }
    });
    labels.innerHTML = html;
    // time: a light rule every 10 minutes, darker every hour, times every 30
    for (let t = Math.ceil(t0 / 600) * 600; t <= t1; t += 600) {
      const xx = Math.round(x(t)) + 0.5, hour = t % 3600 === 0, half = t % 1800 === 0;
      g.strokeStyle = hour ? "#9a9a9a" : half ? "#cfcfcf" : "#ececec"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(xx, TOP - 4); g.lineTo(xx, H - BOT + 4); g.stroke();
      if (half && (minutes <= 300 || hour)) {
        g.fillStyle = "#555"; g.textAlign = xx < 20 ? "left" : xx > W - 20 ? "right" : "center";
        g.fillText(hhmm(t), xx, TOP - 10); g.fillText(hhmm(t), xx, H - BOT + 18);
      }
    }

    // trains: non-revenue first, intercity on top, slightly heavier
    const segs = [];
    const order = [...trips].sort((p, q) => (p.kind ? 0 : 1) - (q.kind ? 0 : 1) || (p.wide ? 1 : 0) - (q.wide ? 1 : 0));
    for (const t of order) {
      for (const run of runsOf(t, route)) {
        if (run[run.length - 1][0] < t0 || run[0][0] > t1) continue;
        g.strokeStyle = t.colour; g.lineWidth = t.wide ? 1.9 : 1.4;
        g.setLineDash(t.kind ? [4, 3] : []);
        g.beginPath();
        run.forEach(([tt, km], k) => (k ? g.lineTo : g.moveTo).call(g, x(tt), y(km)));
        g.stroke();
        for (let k = 1; k < run.length; k++) segs.push([x(run[k - 1][0]), y(run[k - 1][1]), x(run[k][0]), y(run[k][1]), t, run]);
      }
    }
    g.setLineDash([]);
    if (!segs.length) {
      el.note.hidden = false;
      el.note.textContent = "No trains on this route in these hours.";
    }

    // pointer: the nearest train lights up, with its run and times
    const o = over.getContext("2d");
    o.scale(dpr, dpr);
    let hot = null;
    const near = (px, py) => {
      let best = null, bd = 8;
      for (const s of segs) {
        const [x1, y1, x2, y2] = s;
        if (px < Math.min(x1, x2) - 8 || px > Math.max(x1, x2) + 8 || py < Math.min(y1, y2) - 8 || py > Math.max(y1, y2) + 8) continue;
        const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
        const f = l2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2)) : 0;
        const d = Math.hypot(px - x1 - dx * f, py - y1 - dy * f);
        if (d < bd) { bd = d; best = s; }
      }
      return best;
    };
    const show = (s, px, py) => {
      o.clearRect(0, 0, W, H);
      if (!s) { tip.hidden = true; plot.style.cursor = ""; hot = null; return; }
      hot = s[4];
      o.strokeStyle = hot.colour; o.lineWidth = 3.5; o.setLineDash(hot.kind ? [4, 3] : []);
      for (const run of runsOf(hot, route)) {
        o.beginPath();
        run.forEach(([tt, km], k) => (k ? o.lineTo : o.moveTo).call(o, x(tt), y(km)));
        o.stroke();
      }
      const first = hot.s.find((st) => route.at.has(st[0])), lastS = [...hot.s].reverse().find((st) => route.at.has(st[0]));
      const kind = hot.kind ? KIND[hot.kind] || "Non-revenue" : hot.line;
      tip.innerHTML = `<b>${esc(hot.r)}</b> <span class="gr-line" style="background:${esc(hot.colour)}">${esc(kind)}</span><br>` +
        `${esc(hot.h)}<br><span class="gr-muted">${esc(name(first[0]))} ${hhmmss(first[1] + (first[2] || 0))} to ${esc(name(lastS[0]))} ${hhmmss(lastS[1])}</span>`;
      tip.hidden = false;
      const box = el.graph.querySelector(".gr-scroll");
      const left = LABEL + px - box.scrollLeft + 14;
      tip.style.left = Math.min(left, box.clientWidth - tip.offsetWidth - 6) + "px";
      tip.style.top = (py + 14 - box.scrollTop) + "px";
      plot.style.cursor = hot.kind ? "" : "pointer";
    };
    over.addEventListener("mousemove", (e) => {
      const r = over.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      show(near(px, py), px, py);
    });
    over.addEventListener("mouseleave", () => show(null));
    over.addEventListener("click", (e) => {
      const r = over.getBoundingClientRect();
      const s = near(e.clientX - r.left, e.clientY - r.top);
      if (s && !s[4].kind) location.href = `/?l=l:${encodeURIComponent(s[4].line)}&d=${el.date.value}&run=${encodeURIComponent(s[4].r)}`;
      else if (s) show(s, e.clientX - r.left, e.clientY - r.top);
    });
    // scroll so the first trains are in view
    const box = el.graph.querySelector(".gr-scroll");
    const firstX = segs.length ? Math.min(...segs.map((s) => Math.min(s[0], s[2]))) : 0;
    if (firstX > box.clientWidth / 2) box.scrollLeft = firstX - 40;
  }

  // ------------------------------------------------------------ rendering

  let busy = 0;
  async function render(newLine) {
    const ticket = ++busy;
    el.note.hidden = true;
    const day = el.date.value;
    const codes = selectedLines();
    const lines = state.index.lines;
    const load = async (c) => lines[c] && lines[c].dates[day] ? (await getJSON(`lines/${encodeURIComponent(c)}/${lines[c].dates[day]}.json`)).trips : [];
    let trips = [];
    try {
      const all = await Promise.all(codes.map(load));
      codes.forEach((c, i) => {
        const wide = lines[c].network !== "suburban";
        for (const t of all[i]) trips.push({ ...t, line: c, colour: lines[c].colour, wide });
      });
    } catch (e) {
      el.note.hidden = false; el.note.textContent = "Couldn't load the timetable."; return;
    }
    if (ticket !== busy) return;
    if (!trips.length) {
      el.graph.innerHTML = `<div class="empty">No trains on this day.</div>`; syncUrl(); return;
    }
    const adj = network(trips);
    if (newLine) { el.sfrom.value = ""; el.sto.value = ""; el.via.value = ""; }
    fillStations(adj, trips);
    if (el.nonrev.checked && lines.X && lines.X.dates[day]) {
      const x = await load("X");
      for (const t of x) trips.push({ ...t, line: "X", kind: t.c, colour: KIND_COLOUR[t.c] || "#888888", wide: false });
    }
    if (ticket !== busy) return;
    const route = plotRoute(adj);
    syncUrl();
    if (!route) {
      el.graph.innerHTML = `<div class="empty">Those stations aren't on one route. Try a different via station.</div>`;
      return;
    }
    draw(route, trips);
  }

  async function init() {
    try {
      [state.index, state.stations] = await Promise.all([getJSON("index.json"), getJSON("stations.json")]);
      state.track = await getJSON("track.json").catch(() => ({}));
    } catch (e) {
      el.graph.innerHTML = `<div class="empty">Couldn't load the timetable.</div>`; return;
    }
    fillOptions();
    const built = new Date(state.index.built);
    const dmy = (d) => d.toLocaleDateString("en-AU", { timeZone: "Australia/Sydney", day: "2-digit", month: "2-digit", year: "2-digit" });
    const ymd = (s) => dmy(new Date(`${s}T12:00:00+10:00`));
    el.updated.textContent = `Timetable as at ${dmy(built)} for period ${ymd(state.index.first)} - ${ymd(state.index.last)}`;
    el.line.addEventListener("change", () => render(true));
    for (const e of [el.date, el.sfrom, el.sto, el.dir, el.via, el.from, el.to, el.nonrev]) e.addEventListener("change", () => render(false));
    const more = $("more"), tools = more.closest(".tools");
    more.addEventListener("click", () => {
      tools.classList.toggle("open");
      more.setAttribute("aria-expanded", tools.classList.contains("open"));
    });
    let w = el.graph.clientWidth;
    window.addEventListener("resize", () => { if (Math.abs(el.graph.clientWidth - w) > 40) { w = el.graph.clientWidth; render(false); } });
    render(false);
  }
  init();
})();
