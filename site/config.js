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
      stations: ["Central", ...NORTH_SHORE, ...HORNSBY_BEROWRA] },
    { id: "western", name: "Western & Blue Mountains", lines: ["T1", "T5", "BMT", "WST"],
      exclude: [...NORTH_SHORE, ...HORNSBY_BEROWRA, ...T5_SOUTH] },
    { id: "newcastle", name: "Central Coast & Hunter", lines: ["CCN", "HUN", "NRC", "NRW"],
      exclude: [...NORTH_SHORE, ...MAIN_WEST], dropVia: ["Chatswood"] },
    { id: "innerwest", name: "Inner West", lines: ["T2", "T3"] },
    { id: "south", name: "East Hills & Southern Highlands", lines: ["T8", "SHL", "STH"] },
  ],
};
