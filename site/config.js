// The daily build publishes the timetable data to the `data` branch.
// raw.githubusercontent.com allows cross-origin reads, so the site on
// Cloudflare Pages reads it directly.
window.TT_CONFIG = {
  dataBase: "https://raw.githubusercontent.com/Joey-Hain/timetable/data/",
  repoUrl: "https://github.com/Joey-Hain/timetable",

  // Corridors: lines shown together in one timetable, trains in the order
  // they run. Add or change freely; line codes as in the GTFS.
  corridors: [
    { id: "illawarra", name: "Illawarra & South Coast", lines: ["T4", "SCO"] },
    { id: "northern", name: "Northern via Strathfield", lines: ["T9", "CCN"] },
    { id: "northshore", name: "North Shore", lines: ["T1", "T9"] },
    { id: "newcastle", name: "Central Coast & Hunter", lines: ["CCN", "HUN"] },
    { id: "western", name: "Western & Blue Mountains", lines: ["T1", "BMT"] },
    { id: "innerwest", name: "Inner West", lines: ["T2", "T3"] },
    { id: "south", name: "East Hills & Southern Highlands", lines: ["T8", "SHL"] },
    { id: "cumberland", name: "Parramatta & Cumberland", lines: ["T1", "T2", "T5"] },
  ],
};
