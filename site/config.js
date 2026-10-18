// The daily build publishes the timetable data to the `data` branch.
// raw.githubusercontent.com allows cross-origin reads, so the site on
// Cloudflare Pages reads it directly.
const NORTH_SHORE = ["Town Hall", "Wynyard", "Milsons Point", "North Sydney", "Waverton", "Wollstonecraft",
  "St Leonards", "Artarmon", "Chatswood", "Roseville", "Lindfield", "Killara", "Gordon", "Pymble",
  "Turramurra", "Warrawee", "Wahroonga", "Waitara"];
const HORNSBY_BEROWRA = ["Hornsby", "Asquith", "Mount Colah", "Mount Kuring-gai", "Berowra"];
const HUNTER = ["Waratah", "Warabrook", "Sandgate", "Hexham", "Tarro", "Beresfield", "Thornton", "Metford",
  "Victoria Street", "East Maitland", "High Street", "Maitland", "Telarah", "Mindaribba", "Paterson",
  "Martins Creek", "Hilldale", "Wallarobba", "Wirragulla", "Dungog", "Lochinvar", "Greta", "Branxton",
  "Singleton", "Muswellbrook", "Aberdeen", "Scone"];
const MAIN_WEST = ["Lidcombe", "Auburn", "Clyde", "Granville", "Harris Park", "Parramatta", "Westmead",
  "Wentworthville", "Pendle Hill", "Toongabbie", "Seven Hills", "Blacktown"];
// T1 and Blue Mountains trains in the Inner West corridor: Central to Parramatta
const WEST_INNER = ["Central Electric", "Sydney Terminal", "Redfern", "Macdonaldtown", "Newtown", "Stanmore", "Petersham",
  "Lewisham", "Summer Hill", "Ashfield", "Croydon", "Burwood", "Strathfield", "Homebush", "Flemington", "Lidcombe",
  "Auburn", "Clyde", "Granville", "Harris Park", "Parramatta"];
const T5_SOUTH = ["Macarthur", "Campbelltown", "Merrylands", "Guildford", "Yennora", "Fairfield", "Canley Vale", "Cabramatta",
  "Warwick Farm", "Liverpool", "Casula", "Glenfield", "Edmondson Park", "Leppington"];

window.TT_CONFIG = {
  dataBase: "https://raw.githubusercontent.com/Joey-Hain/timetable/data/",
  repoUrl: "https://github.com/Joey-Hain/timetable",

  // Corridors: lines shown together in one timetable, trains in the order
  // they run. Line codes as in the GTFS.
  //   stations: only these stations (a list), or
  //   exclude:  every station but these
  //   lineStations: a line's own stations, for a line only partly in it
  //   need:     only trains whose stretch takes in one of these
  //   dropVia:  leave out trains that run through one of these stations
  //             between two that are shown (CCN via the North Shore in the
  //             Northern corridor). Otherwise a train that leaves the corridor
  //             and comes back shows for its longest stretch in it.
  corridors: [
    { id: "illawarra", name: "Illawarra & South Coast", lines: ["T4", "SCO"] },
    { id: "northern", name: "Northern via Strathfield", lines: ["T9", "CCN", "NRC", "NRW"],
      exclude: [...NORTH_SHORE, ...MAIN_WEST, ...HUNTER], dropVia: ["Chatswood"] },
    { id: "northshore", name: "North Shore", lines: ["T1", "T9", "CCN"],
      stations: ["Central Electric", "Sydney Terminal", ...NORTH_SHORE, ...HORNSBY_BEROWRA],
      need: NORTH_SHORE.filter((n) => n !== "Town Hall" && n !== "Wynyard") },
    { id: "western", name: "Western & Blue Mountains", lines: ["T1", "T5", "BMT", "WST"],
      exclude: [...NORTH_SHORE, ...HORNSBY_BEROWRA, ...T5_SOUTH] },
    { id: "newcastle", name: "Central Coast & Hunter", lines: ["CCN", "HUN", "NRC", "NRW"],
      exclude: [...NORTH_SHORE, ...MAIN_WEST], dropVia: ["Chatswood"] },
    { id: "innerwest", name: "Inner West & Old South", lines: ["T2", "T3", "T6", "T1", "BMT"],
      lineStations: { T1: WEST_INNER, BMT: WEST_INNER } },
    { id: "south", name: "East Hills & Southern Highlands", lines: ["T8", "SHL", "STH"] },
  ],

  // Timed changes, wherever every one of `lines` (if given) is in the
  // timetable, a line on its own or a corridor, and there's a train to change
  // between. The change station gets an arr row, a "Change at" row and a dep
  // row (a through train has times in both). Each secondary train (a feeder)
  // pairs with the first primary train it meets, allowing `minutes` (default
  // 2) to change and waiting at most `maxMinutes` (default 30). `atUp` /
  // `atDown` move the change for one direction (SHL: Campbelltown going
  // south, Macarthur going north); a list picks whichever of its stations
  // has the shorter waits that day (Helensburgh weekdays, Thirroul weekends).
  //   feeders: lines whose trains starting or ending at the change are the
  //            secondary ones (HUN at Hamilton)
  //   side:    or: trains running only on these stations and the change one
  //            (the Bomaderry shuttle at Kiama)
  //   express: or: the all-stations trains of an express / all-stations
  //            change, calling at some of these stations where the expresses
  //            call at none, starting or ending at one of `locals`
  //   split:   stations the feeders get rows of their own at, either side of
  //            the change: Broadmeadow, Newcastle Interchange (HUN), Hamilton
  //            arr / change / dep, Newcastle Interchange (CCN), Waratah
  //   perLine: the best change from (or to) each other line, not just the
  //            soonest (T6 at Lidcombe)
  //   only:    both trains must be on these lines (no change to a booked
  //            regional train)
  interchanges: [
    { at: "Hamilton", lines: ["HUN", "CCN"], feeders: ["HUN"], split: ["Newcastle Interchange"] },
    { at: ["Helensburgh", "Thirroul"], lines: ["SCO"], locals: ["Thirroul", "Waterfall"],
      express: ["Bulli", "Woonona", "Bellambi", "Corrimal", "Towradgi", "Fairy Meadow"] },
    { at: "Kiama", lines: ["SCO"], side: ["Gerringong", "Berry", "Bomaderry (Nowra)"] },
    { at: "Campbelltown", atUp: "Macarthur", lines: ["SHL", "T8"], feeders: ["SHL"] },
    { at: "Moss Vale", lines: ["SHL"], only: ["SHL"],
      side: ["Exeter", "Bundanoon", "Penrose", "Wingello", "Tallong", "Marulan", "Goulburn"] },
    { at: "Lithgow", lines: ["BMT"], only: ["BMT"], side: ["Rydal", "Tarana", "Bathurst"] },
    { at: "Lidcombe", feeders: ["T6", "T7"], perLine: true },
  ],

  // Branch lines: listed straight after the junction (before it coming in)
  // and indented, the main line carrying on after them. `views`: only in
  // these timetables.
  branches: [
    { at: "Sutherland", stations: ["Kirrawee", "Gymea", "Miranda", "Caringbah", "Woolooware", "Cronulla"] },
    { at: "Coniston", stations: ["Lysaghts", "Cringila", "Port Kembla North", "Port Kembla"] },
    { at: "Blacktown", stations: ["Marayong", "Quakers Hill", "Schofields", "Riverstone", "Vineyard", "Mulgrave",
                                  "Windsor", "Clarendon", "East Richmond", "Richmond"] },
    { at: "Glenfield", stations: ["Edmondson Park", "Leppington"] },
    { at: "Regents Park", stations: ["Birrong", "Yagoona", "Bankstown"] },
    // T8 via Sydenham, against the Airport line
    { at: "Central Electric", stations: ["Redfern", "Erskineville", "St Peters", "Sydenham"], views: ["l:T8", "c:south"] },
    { at: "Lidcombe", stations: ["Olympic Park"] },
    // the Eastern Suburbs Railway off Redfern, in the corridor only (T4 on its
    // own runs Bondi Junction to Waterfall)
    { at: "Redfern", stations: ["Bondi Junction", "Edgecliff", "Kings Cross", "Martin Place", "Town Hall", "Central ESR"],
      views: ["c:illawarra"] },
    { at: "Maitland", stations: ["Telarah", "Mindaribba", "Paterson", "Martins Creek", "Hilldale", "Wallarobba",
                                 "Wirragulla", "Dungog"] },
  ],

  // Stations always indented in a timetable, all their rows
  indent: { "c:newcastle": ["Newcastle Interchange", "Hamilton"] },

  // Lines whose trains run through Central from one half to the other under a
  // new run number (T1 Western <-> North Shore). A line on its own shows each
  // train end to end, the new run marked at `at`; `down` is a station only the
  // second half passes, naming that way, and `labels` the two directions.
  through: {
    T1: { down: "Wynyard", labels: ["Western to North Shore", "North Shore to Western"] },
    T9: { down: "Wynyard", labels: ["Hornsby to Gordon", "Gordon to Hornsby"] },
  },
  // Where trains run on under a new run number, and the lines that do: in a
  // line's own timetable a train is one column end to end (T9 on as T1, CCN
  // via the North Shore on as T1 to Blacktown); everywhere a lap of the City
  // Circle joins the train it follows. "Continues as" gives the new run, with
  // the new line or CC when that changes.
  // A shuttle's round trip shown as one service in its own timetable, with
  // "Continues as" at the far end (T7 Lidcombe - Olympic Park - Lidcombe)
  rounds: { T7: "Olympic Park" },
  // stations every corridor shares in the city: a train only touching these
  // (an empty run Redfern - Central) doesn't belong in a corridor
  cityCore: ["Central Electric", "Sydney Terminal", "Central ESR", "Redfern", "Town Hall", "Wynyard",
             "Circular Quay", "St James", "Museum"],
  throughAt: "Central Electric",
  throughLines: ["T1", "T2", "T3", "T8", "T9", "CCN"],
  cityCircle: ["Town Hall", "Wynyard", "Circular Quay", "St James", "Museum"],
};
