// These tests run `dist/tracker.js` with stub browser globals. The stubs let a test flip the visibility, move the clock,
// run the timers, start a DOM change and give performance entries. A static check also examines the code text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { valid, collect } from "../src/collect.js";
import { TAGS, ERRS, DL } from "../src/rules.js";

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const DIST = read("dist/tracker.js");
// The check removes the allowlist strings first. They are tag and class names, not property reads.
const lists = (s) => [TAGS, ERRS, DL].reduce((s, l) => s.replace(l.join(" "), ""), s);
const code = { "src/tracker.js": strip(read("src/tracker.js")), "src/rules.js": lists(strip(read("src/rules.js"))), "dist/tracker.js": lists(DIST) };
const FORBIDDEN = /\b(innerText|textContent|innerHTML|outerHTML|nodeValue|id|className|dataset|getAttribute|href|search|hash|localStorage|sessionStorage)\b/g;

for (const [file, src] of Object.entries(code)) {
  test(`${file} reads no forbidden property`, () => {
    assert.deepEqual(src.match(FORBIDDEN), null);
    if (file == "src/rules.js") return;
    // The check lets one `value` through: the `layout-shift` entry value.
    assert.equal((src.match(/\bvalue\b/g) || []).length, 1);
    // The check lets one `attributes` through: the key in the object that goes to `MutationObserver.observe`.
    assert.equal((src.match(/\battributes\b/g) || []).length, 1);
    assert.match(src, /\battributes(: true \}|:!0\})\)/);
  });
}
test("the one value read is in the layout-shift handler", () => {
  assert.match(code["src/tracker.js"], /win \+= e\.value/);
});
test("dist/tracker.js is at most 3072 bytes gzip -9", () => {
  assert.ok(gzipSync(DIST, { level: 9 }).length <= 3072);
});

const el = (tagName, parentElement, extra = {}) => ({ nodeType: 1, tagName, parentElement, children: [], closest: () => null, ...extra });
const child = (tag, parent, extra) => {
  const c = el(tag, parent, extra);
  parent.children.push(c);
  return c;
};
// This function runs the built tracker. It gives the handlers, the stubs and helpers.
const tracker = ({ pathname = "/pricing", referrer = "https://www.Google.com/search?q=x", types = [], location = {} } = {}) => {
  const on = {}, opts = {}, html = el("HTML"), body = child("BODY", html);
  const t = { on, opts, body, sent: [], fetched: [], timers: [], obs: {}, now: 0, beacon: [] };
  const listen = (k, f, o) => ((on[k] = f), (opts[k] = o));
  const doc = { cookie: "", referrer, body, documentElement: { scrollHeight: 2000 }, visibilityState: "visible", addEventListener: listen };
  const g = {
    navigator: { sendBeacon: (u, b) => (t.sent.push([u, b]), t.beacon.length ? t.beacon.shift() : true) },
    document: doc,
    location: { pathname, hostname: "example.com", origin: "https://example.com", ...location },
    performance: { now: () => t.now },
    setTimeout: (f, ms) => (t.timers.push([t.now + ms, f]), t.timers.at(-1)),
    clearTimeout: (x) => t.timers.includes(x) && t.timers.splice(t.timers.indexOf(x), 1),
    fetch: (u, o) => (t.fetched.push([u, o]), Promise.resolve()),
    MutationObserver: class { constructor(f) { t.mutate = f; } observe(node, o) { t.mo = o; } },
    PerformanceObserver: Object.assign(class {
      constructor(f) { this.f = f; this.q = []; }
      observe({ type }) { t.obs[type] = this; }
      takeRecords() { return this.q.splice(0); }
    }, { supportedEntryTypes: types }),
    window: { innerWidth: 800, innerHeight: 1000, scrollY: 0, addEventListener: listen },
  };
  new Function(...Object.keys(g), DIST)(...Object.values(g));
  return Object.assign(t, {
    doc,
    win: g.window,
    tick: (ms) => {
      t.now += ms;
      for (const x of t.timers.filter(([at]) => at <= t.now)) t.timers.splice(t.timers.indexOf(x), 1), x[1]();
    },
    hide: () => ((doc.visibilityState = "hidden"), on.visibilitychange()),
    show: () => ((doc.visibilityState = "visible"), on.visibilitychange()),
    click: (target) => on.click({ target }),
    beacons: () => t.sent.map(([, b]) => JSON.parse(b)),
  });
};
const page = () => {
  const t = tracker(), main = (child("HEADER", t.body), child("MAIN", t.body)), btn = child("BUTTON", main);
  return { t, btn };
};
const link = (parent, hostname, pathname = "/") => {
  const a = child("A", parent, { hostname, pathname });
  a.closest = () => a;
  return a;
};

test("C1: the first flush has f=1, the next flush has f=0 and only the deltas, and an empty flush is skipped", () => {
  const { t, btn } = page();
  t.tick(7400);
  t.click(btn);
  t.hide();
  t.tick(60000);
  t.show();
  t.tick(5200);
  t.hide();
  t.on.pagehide();
  const [a, b, ...rest] = t.beacons();
  assert.equal(rest.length, 0);
  assert.equal(t.sent[0][0], "https://example.com/api/t");
  // The hide flush adds the waiting button click as not dead.
  // Dwell is in 5 s steps: 7.4 s gives 5, and the remaining 2.4 s with 5.2 s gives 10.
  // The pagehide flush has no new data and a total dwell of 12.6 s (qb 0), thus the tracker skips it.
  assert.deepEqual([a.f, a.qb, a.dw, a.clk, a.r, a.d, a.sc, a.lcp, a.cls], [1, 0, 5, [["main:nth-child(2)>button:nth-child(1)", 1, 0, 0]], "google.com", "m", 5, -1, -1]);
  assert.deepEqual([b.f, b.qb, b.dw, b.clk.length, b.sc], [0, 0, 10, 0, 5]);
  assert.ok(valid(a) && valid(b));
});

test("C5: a click and a hide at once: the hide beacon has the click with dead 0, and no timer adds it again", () => {
  const { t, btn } = page();
  t.click(btn);
  t.hide();
  t.tick(1500);
  assert.equal(t.timers.length, 0);
  t.show();
  t.tick(5000);
  t.hide();
  t.on.pagehide();
  const b = t.beacons();
  assert.deepEqual(b[0].clk, [["main:nth-child(2)>button:nth-child(1)", 1, 0, 0]]);
  assert.ok(b.slice(1).every((x) => x.clk.length == 0));
  assert.ok(b.every(valid));
});

test("C2: quick exit is set at pagehide from the total foreground dwell", () => {
  // The total is less than 5 s. Thus the pagehide flush has qb 1, and the tracker sends it with no other data.
  let { t } = page();
  t.tick(2000);
  t.hide();
  t.on.pagehide();
  assert.deepEqual(t.beacons().map((b) => [b.f, b.qb, b.dw]), [[1, 0, 0], [0, 1, 0]]);
  // 3 s, then 3 s after a hide: 6 s in total, thus qb is 0. The pagehide flush then has no data and is skipped.
  ({ t } = page());
  t.tick(3000);
  t.hide();
  t.tick(60000);
  t.show();
  t.tick(3000);
  t.on.pagehide();
  assert.deepEqual(t.beacons().map((b) => [b.f, b.qb, b.dw]), [[1, 0, 5]]);
  // Only the first pagehide sets qb. After the page comes back from the back/forward cache, a second pagehide sends qb 0.
  ({ t } = page());
  t.tick(1000);
  t.on.pagehide();
  t.on.pageshow({ persisted: true });
  t.tick(1000);
  t.on.pagehide();
  assert.deepEqual(t.beacons().map((b) => [b.f, b.qb]), [[1, 1]]);
});

test("C2: a pagehide with persisted true sends qb 0; a later pagehide uses the total foreground dwell", () => {
  let { t } = page();
  t.tick(1000);
  t.on.pagehide({ persisted: true });
  t.on.pageshow({ persisted: true });
  t.tick(10000);
  t.on.pagehide({ persisted: false });
  // 1 s and 10 s give 11 s in total, thus the second pagehide also sends qb 0.
  assert.deepEqual(t.beacons().map((b) => [b.f, b.qb, b.dw]), [[1, 0, 0], [0, 0, 10]]);
  ({ t } = page());
  t.tick(1000);
  t.on.pagehide({ persisted: false });
  assert.deepEqual(t.beacons().map((b) => [b.f, b.qb]), [[1, 1]]);
});

test("C5: a click before pagehide in 1 s is not dead", () => {
  const { t, btn } = page();
  t.click(btn);
  t.on.pagehide();
  t.tick(2000);
  const b = t.beacons();
  assert.deepEqual(b.map((x) => [x.qb, x.clk]), [[1, [["main:nth-child(2)>button:nth-child(1)", 1, 0, 0]]]]);
  assert.ok(b.every(valid));
});

test("C1: a back/forward cache pageshow continues the page load with no new pageview", () => {
  const { t } = page();
  t.tick(1000);
  t.on.pagehide();
  t.doc.visibilityState = "hidden";
  t.on.visibilitychange();
  t.tick(30000);
  t.doc.visibilityState = "visible";
  t.on.pageshow({ persisted: true });
  t.on.visibilitychange();
  t.tick(4000);
  t.hide();
  // The 1 s gives 0, and the remaining 1 s goes into the next flush: 1 s + 4 s gives 5.
  // The hidden flush after pagehide has no data, thus the tracker skips it. Only the pagehide flush has qb 1.
  assert.deepEqual(t.beacons().map((b) => [b.f, b.dw, b.qb]), [[1, 0, 1], [0, 5, 0]]);
});

test("C1: opt-out at flush time sends nothing", () => {
  const { t, btn } = page();
  t.click(btn);
  t.doc.cookie = "a=1; t=0";
  t.hide();
  assert.equal(t.sent.length, 0);
});

test("C3: when sendBeacon gives false, the tracker uses fetch with keepalive one time", () => {
  const { t, btn } = page();
  t.beacon.push(false);
  t.hide();
  assert.equal(t.fetched.length, 1);
  const [url, o] = t.fetched[0];
  assert.deepEqual([url, o.method, o.keepalive, o.credentials, o.body], ["https://example.com/api/t", "POST", true, "omit", t.sent[0][1]]);
  t.show();
  t.click(btn);
  t.tick(1000);
  t.hide();
  assert.deepEqual([t.sent.length, t.fetched.length], [2, 1]);
});

test("C4: LCP and CLS come from the observers and from takeRecords at flush", () => {
  const t = tracker({ types: ["largest-contentful-paint", "layout-shift"] });
  const lcp = t.obs["largest-contentful-paint"], ls = t.obs["layout-shift"];
  lcp.f({ getEntries: () => [{ startTime: 1234.4 }] });
  ls.f({ getEntries: () => [{ startTime: 100, value: 0.05 }, { startTime: 400, value: 0.5, hadRecentInput: true }] });
  lcp.q.push({ startTime: 2000 });
  ls.q.push({ startTime: 300, value: 0.02 });
  t.hide();
  assert.deepEqual([t.beacons()[0].lcp, t.beacons()[0].cls], [2000, 70]);
  const u = tracker();
  u.hide();
  assert.deepEqual([u.beacons()[0].lcp, u.beacons()[0].cls], [-1, -1]);
});

test("C5: dead clicks need no DOM change in 1 s; an attribute change counts; a link click is never dead", () => {
  const { t, btn } = page();
  assert.deepEqual(t.mo, { childList: true, subtree: true, characterData: true, attributes: true });
  assert.equal(t.opts.click.capture, true);
  t.click(btn);
  t.tick(1000);
  t.click(btn);
  t.tick(500);
  t.mutate([{ type: "attributes" }]);
  t.tick(500);
  link(btn.parentElement, "example.com", "/about");
  t.click(btn.parentElement.children.at(-1));
  t.tick(1000);
  t.hide();
  const clk = Object.fromEntries(t.beacons()[0].clk.map(([p, ...n]) => [p, n]));
  assert.deepEqual(clk, { "main:nth-child(2)>button:nth-child(1)": [2, 0, 1], "main:nth-child(2)>a:nth-child(2)": [1, 0, 0] });
});

test("C5: rage is 3 clicks on one path in 1 s, not 3 clicks at 0, 990 and 1980 ms", () => {
  const { t, btn } = page(), slow = child("DIV", btn.parentElement);
  for (const ms of [0, 400, 500]) t.tick(ms), t.click(btn);
  for (const ms of [0, 990, 990]) t.tick(ms), t.click(slow);
  // Wait for more than the 1 s window. Thus the timers add the clicks, not the flush.
  t.tick(1000);
  assert.equal(t.timers.length, 0);
  t.hide();
  assert.deepEqual(t.beacons()[0].clk.map((c) => c[2]), [1, 0]);
});

test("C5: a text node target uses its parent, a body click is skipped, and a custom tag becomes other", () => {
  const { t, btn } = page(), w = child("MY-WIDGET", btn);
  t.click({ nodeType: 3, parentElement: w });
  t.click(t.body);
  t.tick(1000);
  t.hide();
  assert.deepEqual(t.beacons()[0].clk, [["main:nth-child(2)>button:nth-child(1)>other:nth-child(1)", 1, 0, 1]]);
});

test("A2: outbound links send the registrable domain, and the server applies its rules again; dl needs a known extension", async () => {
  const { t, btn } = page(), m = btn.parentElement;
  for (const [h, p] of [["docs.github.com", "/x"], ["www.example.com", "/files/Report.PDF"], ["example.com", "/notes.txt"], ["example.com", "/about"], ["", "/"], ["192.168.0.1", "/"]]) t.click(link(m, h, p));
  t.hide();
  const b = t.beacons()[0];
  assert.deepEqual(b.out, [["github.com", "out", 1], ["pdf", "dl", 1], ["0.1", "out", 1]]);
  const rows = [], req = new Request("https://example.com/api/t", { method: "POST", body: t.sent[0][1], headers: { "user-agent": "Mozilla/5.0" } });
  await collect(req, { TELEMETRY: { writeDataPoint: (x) => rows.push(x) } }, { country: "US" });
  assert.deepEqual(rows.filter((r) => r.blobs[0] == "out").map((r) => r.blobs[3]), ["github.com", "pdf"]);
});

test("A1 and A3: the path is normalized, and the error class, script, line and column follow the rules", () => {
  const t = tracker({ pathname: "/User/12345/" });
  const fire = (name, filename, lineno = 1, colno = 1) => t.on.error({ error: name && { name }, filename, lineno, colno });
  fire("TypeError", "https://example.com/assets/App.js?v=1", -5, 5e6);
  fire("CANARYError", "https://example.com/pricing");
  fire(null, "https://cdn.example.net/x.js");
  fire("ChunkLoadError", "https://example.com/_astro/page.3f9a8b7c1d.mjs");
  t.hide();
  const b = t.beacons()[0];
  assert.equal(b.p, "/user/:x");
  assert.deepEqual(b.err, [["TypeError", "/assets/app.js", 0, 1e6, 1], ["Other", "inline", 1, 1, 1], ["Other", "ext", 1, 1, 1], ["ChunkLoadError", "/:x/:x.mjs", 1, 1, 1]]);
  assert.ok(valid(b), JSON.stringify(b));
});

test("A1: a reset link with an email and a letter-only token sends and writes no token", async () => {
  const t = tracker({ pathname: "/reset/alice@example.com/SecretToken" });
  t.hide();
  assert.equal(t.beacons()[0].p, "/reset/:x/:x");
  const rows = [], req = new Request("https://example.com/api/t", { method: "POST", body: t.sent[0][1], headers: { "user-agent": "Mozilla/5.0" } });
  await collect(req, { TELEMETRY: { writeDataPoint: (x) => rows.push(x) } }, { country: "US" });
  assert.equal(rows[0].blobs[1], "/reset/:x/:x");
  assert.doesNotMatch(JSON.stringify(rows), /secret|alice/i);
});

test("the worst-case body is below the 16 KB server limit and passes the schema", () => {
  const t = tracker({ pathname: "/" + Array(8).fill("z-".repeat(12)).join("/") });
  for (let i = 0; i < 60; i++) {
    let p = t.body;
    for (let k = 0; k < 12; k++) {
      const c = el("TEXTAREA", p);
      p.children = Array(k == 11 ? 900 + i : 998).fill(null).concat(c);
      p = c;
    }
    t.click(p);
  }
  t.tick(1000);
  for (let i = 0; i < 25; i++) t.on.error({ error: { name: "QuotaExceededError" }, filename: "https://example.com/" + Array(8).fill("z-".repeat(12)).join("/") + ".mjs", lineno: 999999 - i, colno: 999999 });
  for (let i = 0; i < 40; i++) t.click(link(t.body, `${"h".repeat(70)}${i + 10}.example`));
  t.hide();
  const b = t.beacons()[0];
  assert.deepEqual([b.clk.length, b.err.length, b.out.length], [50, 20, 30]);
  assert.ok(b.clk.every(([p]) => p.length > 100));
  assert.ok(t.sent[0][1].length <= 16384, String(t.sent[0][1].length));
  assert.ok(valid(b));
});

test("D2 canary: no marker from the DOM, the error, the referrer or the location reaches the beacon", () => {
  const M = "CANARY7731";
  const marks = { id: M, className: M, textContent: M, innerText: M, innerHTML: M, outerHTML: `<b>${M}</b>`, value: M, nodeValue: M, href: `https://x.com/?${M}`, dataset: { m: M }, attributes: [{ name: "data-m", value: M }], getAttribute: () => M, title: M, name: M };
  const t = tracker({
    pathname: `/a/${M}_x`,
    referrer: `https://u:${M}@ref.example.org/p?q=${M}#${M}`,
    location: { href: `https://u:${M}@example.com/a?${M}#${M}`, search: `?${M}`, hash: `#${M}` },
  });
  let p = t.body;
  for (const tag of ["MAIN", "SECTION", "A", `X-${M}`, "SPAN"]) p = child(tag, p, { ...marks });
  const a = p.parentElement.parentElement;
  Object.assign(a, { hostname: "example.com", pathname: `/f/${M}.pdf` });
  p.closest = () => a;
  t.click(p);
  t.click({ ...marks, nodeType: 3, parentElement: p });
  const error = Object.assign(new Error(M), { stack: `${M} at ${M}` });
  t.on.error({ error, message: M, filename: `https://example.com/app.js?${M}#${M}`, lineno: 1, colno: 1 });
  t.hide();
  const body = t.sent[0][1];
  assert.ok(body.includes("pdf") && body.includes("other"), body);
  assert.doesNotMatch(body, new RegExp(M, "i"));
  assert.ok(valid(JSON.parse(body)), body);
});

test("D2 canary: the referrer and the outbound host go only as their registrable domains", async () => {
  const t = tracker({ referrer: "https://alice-secret.example.com/x" });
  t.click(link(t.body, "bob-private.example.org"));
  t.hide();
  const body = t.sent[0][1];
  assert.doesNotMatch(body, /alice-secret|bob-private/);
  assert.deepEqual([JSON.parse(body).r, JSON.parse(body).out], ["example.com", [["example.org", "out", 1]]]);
  const rows = [];
  await collect(new Request("https://shop.example.net/api/t", { method: "POST", body, headers: { "user-agent": "Mozilla/5.0" } }), { TELEMETRY: { writeDataPoint: (x) => rows.push(x) } }, { country: "US" });
  assert.equal(rows[0].blobs[3], "example.com");
  assert.doesNotMatch(JSON.stringify(rows), /alice-secret|bob-private/);
});

test("each count stops at 10000, and LCP and CLS go to their steps", () => {
  const t = tracker({ types: ["largest-contentful-paint", "layout-shift"] });
  const main = child("MAIN", t.body), a = link(main, "github.com");
  for (let i = 0; i < 10005; i++) t.click(a), t.on.error({ error: { name: "Error" }, filename: "", lineno: 1, colno: 1 });
  t.obs["largest-contentful-paint"].f({ getEntries: () => [{ startTime: 1249 }] });
  t.obs["layout-shift"].f({ getEntries: () => [{ startTime: 100, value: 0.1149 }] });
  t.hide();
  const b = t.beacons()[0];
  assert.deepEqual([b.clk[0][1], b.err[0][4], b.out[0][2], b.lcp, b.cls], [1e4, 1e4, 1e4, 1200, 110]);
  assert.ok(valid(b));
});
test("CLS stops at 100000, and collect accepts the beacon", async () => {
  const t = tracker({ types: ["layout-shift"] });
  t.obs["layout-shift"].f({ getEntries: () => Array.from({ length: 101 }, () => ({ startTime: 100, value: 1 })) });
  t.hide();
  const b = t.beacons()[0], rows = [];
  assert.equal(b.cls, 1e5);
  await collect(new Request("https://example.com/api/t", { method: "POST", body: JSON.stringify(b) }), { TELEMETRY: { writeDataPoint: (x) => rows.push(x) } }, { country: "US" });
  assert.equal(rows[0]?.doubles[5], 1e5);
});

test("an SVG a element (no string hostname) does not stop the click handler and gives no out item", () => {
  const { t, btn } = page();
  btn.closest = () => ({ href: { baseVal: "x" } });
  t.click(btn);
  t.hide();
  const b = t.beacons()[0];
  assert.deepEqual([b.clk.length, b.out], [1, []]);
});

test("README.md and docs/research.md give the 3,072-byte budget and the quick-exit rule", () => {
  for (const f of ["README.md", "docs/research.md"]) assert.match(read(f), /at most 3,072 bytes gzip/, f);
  assert.doesNotMatch(read("README.md"), /3 KB/);
  assert.match(read("docs/research.md"), /quick exit means total foreground dwell less than 5 s, set at pagehide/);
  // The SQL binding applies sample weights. The docs must not give manual weights.
  assert.doesNotMatch(read("docs/research.md"), /sum\(_sample_interval\)|\* _sample_interval/);
  assert.doesNotMatch(read("docs/research.md"), /2\.5 s|__probe/);
});


test("later maxima replace earlier snapshots after tab switches without another pageview", async () => {
  const t = tracker({ types: ["largest-contentful-paint", "layout-shift"] });
  const lcp = t.obs["largest-contentful-paint"], cls = t.obs["layout-shift"];
  t.hide(); // LCP is unknown, but CLS is a measured zero.
  t.show();
  t.win.scrollY = 600;
  t.on.scroll();
  lcp.q.push({ startTime: 1200 });
  cls.q.push({ startTime: 100, value: 0.05 });
  t.hide(); // No dwell, clicks or errors: maxima alone must cause a flush.
  t.show();
  t.win.scrollY = 1000;
  t.on.scroll();
  lcp.q.push({ startTime: 2100 });
  cls.q.push({ startTime: 200, value: 0.04 });
  t.on.pagehide({ persisted: true });
  t.on.pageshow({ persisted: true });
  t.hide(); // No repeated correction after a back/forward cache restore.
  assert.deepEqual(t.beacons().map(({ f, sc, lcp, cls, prev }) => [f, sc, lcp, cls, prev]), [
    [1, 5, -1, 0, undefined], [0, 8, 1200, 50, [5, -1, 0]], [0, 10, 2100, 90, [8, 1200, 50]],
  ]);
  const rows = [];
  for (const b of t.beacons()) {
    assert.ok(valid(b));
    await collect(new Request("https://example.com/api/t", { method: "POST", body: JSON.stringify(b) }),
      { TELEMETRY: { writeDataPoint: (x) => rows.push(x) } }, { country: "US" });
  }
  assert.equal(rows.reduce((n, { doubles: d }) => n + d[0], 0), 1);
  const weight = (d) => d[0] + (d[7] || 0);
  const buckets = new Map();
  for (const { doubles: d } of rows) buckets.set(d[1], (buckets.get(d[1]) || 0) + weight(d));
  assert.deepEqual([...buckets], [[5, 0], [8, 0], [10, 1]]);
  for (const [i, expected] of [[4, 2100], [5, 90]]) {
    const measured = rows.map((r) => r.doubles).filter((d) => d[i] >= 0);
    const count = measured.reduce((n, d) => n + weight(d), 0);
    assert.equal(count, 1);
    assert.equal(measured.reduce((n, d) => n + weight(d) * d[i], 0) / count, expected);
  }
  assert.equal(rows.reduce((n, { doubles: d }) => n + d[1] * weight(d), 0), 10);
});

test("unchanged or unsupported maxima add no corrections to a dwell flush", async () => {
  const t = tracker();
  t.hide();
  t.show();
  t.tick(5000);
  t.hide();
  const rows = [];
  for (const b of t.beacons()) await collect(new Request("https://example.com/api/t", { method: "POST", body: JSON.stringify(b) }),
    { TELEMETRY: { writeDataPoint: (x) => rows.push(x) } }, { country: "US" });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].doubles[7], 0);
  assert.deepEqual(rows.map((r) => r.doubles.slice(4, 6)), [[-1, -1], [-1, -1]]);
});
