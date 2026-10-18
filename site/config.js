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
const T5_SOUTH = ["Macarthur", "Campbelltown", "Merrylands", "Guildford", "Yennora", "Fairfield", "Canley Vale", "Cabramatta",
  "Warwick Farm", "Liverpool", "Casula", "Glenfield", "Edmondson Park", "Leppington"];

window.TT_CONFIG = {
  dataBase: "https://raw.githubusercontent.com/Joey-Hain/timetable/data/",
  repoUrl: "https://github.com/Joey-Hain/timetable",

  // Corridors: lines shown together in one timetable, trains in the order
  // they run. Line codes as in the GTFS.
  //   stations: only these stations (a list), or
  //   exclude:  every station but these
  //   dropVia:  leave out trains that run through one of these stations
  //             between two that are shown (CCN via the North Shore in the
  //             Northern corridor). Otherwise a train that leaves the corridor
  //             and comes back shows for its longest stretch in it.
  corridors: [
    { id: "illawarra", name: "Illawarra & South Coast", lines: ["T4", "SCO"] },
    { id: "northern", name: "Northern via Strathfield", lines: ["T9", "CCN", "NRC", "NRW"],
      exclude: [...NORTH_SHORE, ...MAIN_WEST, ...HUNTER], dropVia: ["Chatswood"] },
    { id: "northshore", name: "North Shore", lines: ["T1", "T9", "CCN"],
      stations: ["Central Electric", "Sydney Terminal", ...NORTH_SHORE, ...HORNSBY_BEROWRA] },
    { id: "western", name: "Western & Blue Mountains", lines: ["T1", "T5", "BMT", "WST"],
      exclude: [...NORTH_SHORE, ...HORNSBY_BEROWRA, ...T5_SOUTH] },
    { id: "newcastle", name: "Central Coast & Hunter", lines: ["CCN", "HUN", "NRC", "NRW"],
      exclude: [...NORTH_SHORE, ...MAIN_WEST], dropVia: ["Chatswood"] },
    { id: "innerwest", name: "Inner West & Bankstown", lines: ["T2", "T3", "T6", "T7"] },
    { id: "south", name: "East Hills & Southern Highlands", lines: ["T8", "SHL", "STH"] },
  ],

  // Timed changes, wherever every one of `lines` (if given) is in the
  // timetable, a line on its own or a corridor, and there's a train to change
  // between. The change station gets an arr row, a "Change at" row and a dep
  // row (a through train has times in both). Each secondary train (a feeder)
  // pairs with the first primary train it meets, allowing `minutes` (default
  // 2) to change and waiting at most `maxMinutes` (default 30). `atUp` /
  // `atDown` move the change for one direction (SHL: Campbelltown going
  // south, Macarthur going north).
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
  //   only:    both trains must be on these lines (no change to a booked
  //            regional train)
  interchanges: [
    { at: "Hamilton", lines: ["HUN", "CCN"], feeders: ["HUN"], split: ["Newcastle Interchange"] },
    { at: "Thirroul", lines: ["SCO"], locals: ["Thirroul", "Waterfall"],
      express: ["Bulli", "Woonona", "Bellambi", "Corrimal", "Towradgi", "Fairy Meadow"] },
    { at: "Kiama", lines: ["SCO"], side: ["Gerringong", "Berry", "Bomaderry (Nowra)"] },
    { at: "Campbelltown", atUp: "Macarthur", lines: ["SHL", "T8"], feeders: ["SHL"] },
    { at: "Moss Vale", lines: ["SHL"], only: ["SHL"],
      side: ["Exeter", "Bundanoon", "Penrose", "Wingello", "Tallong", "Marulan", "Goulburn"] },
    { at: "Lithgow", lines: ["BMT"], only: ["BMT"], side: ["Rydal", "Tarana", "Bathurst"] },
    { at: "Lidcombe", feeders: ["T6", "T7"] },
  ],

  // Branch lines: listed straight after the junction (before it coming in)
  // and indented, the main line carrying on after them.
  branches: [
    { at: "Sutherland", stations: ["Kirrawee", "Gymea", "Miranda", "Caringbah", "Woolooware", "Cronulla"] },
    { at: "Coniston", stations: ["Lysaghts", "Cringila", "Port Kembla North", "Port Kembla"] },
    { at: "Blacktown", stations: ["Marayong", "Quakers Hill", "Schofields", "Riverstone", "Vineyard", "Mulgrave",
                                  "Windsor", "Clarendon", "East Richmond", "Richmond"] },
    { at: "Glenfield", stations: ["Edmondson Park", "Leppington"] },
  ],

  // Lines whose trains run through Central from one half to the other under a
  // new run number (T1 Western <-> North Shore). A line on its own shows each
  // train end to end, the new run marked at `at`; `down` is a station only the
  // second half passes, naming that way, and `labels` the two directions.
  through: {
    T1: { at: "Central Electric", down: "Wynyard", labels: ["Western to North Shore", "North Shore to Western"] },
    T9: { at: "Central Electric", down: "Wynyard", labels: ["Hornsby to Gordon", "Gordon to Hornsby"] },
  },
};
