// Fixture answers for DASH_DEMO=1. They have the same shape as the SQL answers, so the page shows correctly with no binding.
// One path and one element contain markup: the page must show them as text.
const day = (i) => new Date(Date.now() - (6 - i) * 864e5).toISOString().slice(0, 10) + " 00:00:00";
const kn = (...pairs) => pairs.map(([k, n]) => ({ k, n }));
export default {
  sites: { sites: [{ site: "example.com" }, { site: "demo.example.org" }] },
  pv: {
    totals: { pageviews: 4210, visits: 2980, quick_exits: 610, avg_scroll: 5.8, dwell: 197870, avg_dwell: 47 },
    get daily() { return [520, 610, 580, 640, 700, 590, 570].map((n, i) => ({ k: day(i), n })); },
    paths: kn(["/", 1900], ["/pricing", 820], ["/blog/hello", 610], ["/<script>alert(1)</script>", 3]),
    referrers: kn(["direct", 1800], ["internal", 1230], ["ycombinator.com", 640], ["google.com", 540]),
    countries: kn(["US", 2100], ["CA", 610], ["IL", 420], ["JP", 300], ["AU", 210]),
    browsers: kn(["Chrome 130", 2300], ["Safari 18", 1100], ["Firefox 131", 520], ["Edge 130", 290]),
    os: kn(["Windows", 1500], ["macOS", 1200], ["iOS 18", 900], ["Android 15", 610]),
    devices: kn(["l", 2600], ["s", 1300], ["m", 310]),
    scroll: [400, 380, 360, 420, 450, 390, 330, 300, 290, 410, 480].map((n, k) => ({ k, n })),
  },
  cwv: { lcp: { avg: 1840, n: 3900 }, cls: { avg: 62, n: 3900 } },
  clk: {
    rows: [
      { path: "/", el: "main>section:nth-child(2)>a", clicks: 820, rage: 4, dead: 12 },
      { path: "/pricing", el: "main>div>button", clicks: 410, rage: 31, dead: 2 },
      { path: "/", el: "<img src=x onerror=alert(1)>", clicks: 7, rage: 0, dead: 7 },
    ],
  },
  err: { rows: [{ class: "TypeError", script: "/app.js", line: 120, n: 44 }, { class: "Other", script: "inline", line: 3, n: 5 }, { class: "Error", script: "ext", line: 0, n: 9 }] },
  out: { rows: [{ kind: "out", target: "github.com", n: 210 }, { kind: "dl", target: "pdf", n: 64 }] },
};
