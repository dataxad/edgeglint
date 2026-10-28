import { test } from "node:test";
import assert from "node:assert/strict";
import { collect, handle } from "../src/collect.js";
import { astro, pages } from "../src/adapters.js";
import { normPath, pathOk, hostOk, regDomain, routeMatch, isProbe, domainOf, probeKey, readBody } from "../src/rules.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) MARKERUA7731 Chrome/130.0.0.0 Safari/537.36";
const base = () => ({
  v: 1, f: 1, qb: 1, p: "/blog/post-1", r: "news.example.org", d: "m", sc: 7, dw: 0, lcp: 1200, cls: 40,
  clk: [["main:nth-child(2)>a:nth-child(1)", 2, 0, 1]],
  err: [["TypeError", "/app.js", 10, 4, 1]],
  out: [["github.com", "out", 1], ["pdf", "dl", 2]],
});
const env = () => {
  const rows = [];
  return { rows, TELEMETRY: { writeDataPoint: (p) => rows.push(p) } };
};
const post = (body, headers = {}, url = "https://www.example.com/api/t") =>
  new Request(url, { method: "POST", body: typeof body == "string" ? body : JSON.stringify(body), headers: { "user-agent": UA, "content-type": "text/plain", ...headers } });
const run = async (body, { headers, cf = { country: "US" }, url } = {}) => {
  const e = env(), res = await collect(post(body, headers, url), e, cf);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("cache-control"), "no-store");
  return e.rows;
};

test("a valid payload writes the expected rows", async () => {
  const rows = await run(base());
  assert.deepEqual(rows, [
    { indexes: ["example.com"], blobs: ["pv", "/blog/post-1", "m", "example.org", "US", "Chrome 130", "macOS"], doubles: [1, 7, 1, 0, 1200, 40, 1] },
    { indexes: ["example.com"], blobs: ["clk", "/blog/post-1", "main:nth-child(2)>a:nth-child(1)"], doubles: [2, 0, 1] },
    { indexes: ["example.com"], blobs: ["err", "/blog/post-1", "TypeError", "/app.js"], doubles: [10, 4, 1] },
    { indexes: ["example.com"], blobs: ["out", "/blog/post-1", "out", "github.com"], doubles: [1] },
    { indexes: ["example.com"], blobs: ["out", "/blog/post-1", "dl", "pdf"], doubles: [2] },
  ]);
});

test("referrer class, visit flag and quick exit; double3 is qb for each f", async () => {
  const pv = async (r, qb, f = 1) => (await run({ ...base(), r, qb, f }))[0];
  let row = await pv("www.example.com", 0);
  assert.deepEqual([row.blobs[3], row.doubles[2], row.doubles[6]], ["internal", 0, 0]);
  row = await pv("", 1);
  assert.deepEqual([row.blobs[3], row.doubles[2], row.doubles[6]], ["direct", 1, 1]);
  row = await pv("", 1, 0);
  assert.deepEqual([row.doubles[0], row.doubles[2], row.doubles[6]], [0, 1, 0]);
});

test("A2: a referrer becomes its registrable domain, and a referrer that fails the host rule becomes other", async () => {
  const ref = async (r) => (await run({ ...base(), r }))[0].blobs[3];
  for (const [r, want] of [["news.ycombinator.com", "ycombinator.com"], ["www.google.co.uk", "google.co.uk"], ["a.b.example.com.au", "example.com.au"], ["github.io", "github.io"]]) assert.equal(await ref(r), want, r);
  for (const r of ["other", "192.168.1.5", "[::1]", "a@b.com", "a.com:8080", "A.COM", "localhost", "a.c0m", "a".repeat(77) + ".com", "x.y.z.museumlongerthan24letters"]) assert.equal(await ref(r), "other", r);
});

test("A2: host rule and registrable domain", () => {
  for (const h of ["a.co", "x-1.example.com", "www.example.co.uk", "xn--bcher-kva.de"]) assert.ok(hostOk(h), h);
  for (const h of ["com", "1.2.3.4", "a.123", "-a.com", "a-.com", "[::1]", "a@b.com", "a.com:80", "a..com", "a.c", "A.com", "a.".repeat(40) + "com"]) assert.ok(!hostOk(h), h);
  assert.deepEqual(["www.example.com", "a.b.example.com", "shop.example.co.uk", "www.co.uk", "www.com", "example.org"].map(regDomain), ["example.com", "example.com", "example.co.uk", "co.uk", "www.com", "example.org"]);
  for (const [h, want] of [["alice.ibm.de", "ibm.de"], ["news.bbc.co.uk", "bbc.co.uk"], ["550e8400-e29b-41d4-a716-446655440000.app.io", "app.io"], ["x.ai", "x.ai"], ["www.example.com", "example.com"]]) assert.equal(regDomain(h), want, h);
});

test("A1: normPath keeps words and short numbers, and replaces ID-like segments", () => {
  for (const [p, want] of [
    ["/", "/"],
    ["/2024/06/12/my-slug", "/2024/06/12/my-slug"],
    ["/Blog/Post-1/", "/blog/post-1"],
    ["/user/12345", "/user/:x"],
    ["/u/550e8400-e29b-41d4-a716-446655440000", "/u/:x"],
    ["/o/deadbeef00", "/o/:x"],
    ["/a/v1-2-3", "/a/:x"],
    ["/a/x@y.com", "/a/:x"],
    ["/a/b_c", "/a/:x"],
    ["/a/" + "z".repeat(41), "/a/:x"],
    ["/a/caf%C3%A9", "/a/:x"],
    ["/reset/alice@example.com/SecretToken", "/reset/:x/:x"],
    ["/About/FAQ", "/about/:x"],
    ["/t/" + "q".repeat(21), "/t/:x"],
    ["/t/" + "q".repeat(20) + "-a", "/t/" + "q".repeat(20) + "-a"],
    ["/1/2/3/4/5/6/7/8/9/10", "/1/2/3/4/5/6/7/8"],
    ["/Deadbeef", "/:x"],
    ["/deadbeef", "/:x"],
    ["/user-1234567", "/:x"],
    ["/id-98765", "/:x"],
    ["/2024/06/12/slug", "/2024/06/12/slug"],
    ["/" + Array(8).fill("z-".repeat(20)).join("/"), "/:long"],
  ]) {
    assert.equal(normPath(p), want, p);
    assert.equal(normPath(want), want, "idempotent " + want);
    assert.ok(pathOk(want), want);
  }
  assert.ok(!pathOk("/deadbeef") && pathOk("/:x"));
});

test("routeMatch: exact paths and prefix patterns, as an array or a comma-separated string", () => {
  assert.equal(routeMatch(undefined), null);
  assert.equal(routeMatch(""), null);
  for (const list of [["/about", "/blog/*"], " /about , /blog/* "]) {
    const ok = routeMatch(list);
    assert.deepEqual(["/about", "/about/x", "/blog", "/blog/a", "/blog/a/b", "/", "/edgeglint-probe/deploy-check"].map(ok), [true, false, false, true, true, false, false]);
  }
});

test("routes: a path or a script path that is not in the list becomes other; env.ROUTES and the option give the same result", async () => {
  const body = { ...base(), p: "/myprivatemessage/alice", err: [["TypeError", "/app.js", 1, 1, 1], ["Error", "/assets/x.js", 1, 1, 1], ["Error", "inline", 1, 1, 1]] };
  // Without a route list, normPath keeps lowercase words. Thus a site must set ROUTES to remove these words.
  let e = env();
  await collect(post(body), e, { country: "US" });
  assert.equal(e.rows[0].blobs[1], "/myprivatemessage/alice");
  for (const [x, opts] of [[{ ROUTES: "/about,/assets/*" }, undefined], [{}, { routes: ["/about", "/assets/*"] }]]) {
    e = { ...env(), ...x };
    await collect(post(body), e, { country: "US" }, opts);
    assert.ok(e.rows.every((r) => r.blobs[1] == "/other"));
    assert.deepEqual(e.rows.filter((r) => r.blobs[0] == "err").map((r) => r.blobs[3]), ["other", "/assets/x.js", "inline"]);
    assert.doesNotMatch(JSON.stringify(e.rows), /myprivatemessage|alice/);
  }
  e = { ...env(), ROUTES: "/myprivatemessage/*" };
  await collect(post(body), e, { country: "US" });
  assert.equal(e.rows[0].blobs[1], "/myprivatemessage/alice");
});

test("probe: only /edgeglint-probe/<token> stays outside the route list as its probeKey path, and never as a script path", async () => {
  assert.deepEqual(["/edgeglint-probe/abc123", "/edgeglint-probe/ab12", "/edgeglint-probe/abc123/x", "/edgeglint-probe/deploy-check", "/x/edgeglint-probe/abc123"].map(isProbe), [true, false, false, false, false]);
  const page = async (p, err = []) => { const e = { ...env(), ROUTES: "/" }; await collect(post({ ...base(), p, err }), e, { country: "US" }); return e.rows; };
  assert.equal((await page("/edgeglint-probe/alice/private-message"))[0].blobs[1], "/other");
  assert.equal((await page("/edgeglint-probe/abc123"))[0].blobs[1], await probeKey("abc123"));
  // A name as the token: the stored path has 12 hex characters of SHA-256 and not the name.
  const rows = await page("/edgeglint-probe/alicesmith");
  assert.match(rows[0].blobs[1], /^\/edgeglint-probe\/[0-9a-f]{12}$/);
  assert.equal(rows[0].blobs[1], await probeKey("alicesmith"));
  assert.doesNotMatch(JSON.stringify(rows), /alicesmith/);
  assert.equal((await page("/", [["Error", "/edgeglint-probe/x.js", 1, 1, 1]])).find((r) => r.blobs[0] == "err").blobs[3], "other");
});

test("domainOf: a domain with an ID-like part becomes other, and its out item is dropped", async () => {
  const U = "550e8400-e29b-41d4-a716-446655440000.com";
  assert.deepEqual([U, "ibm.de", "bbc.co.uk", "news.ycombinator.com", "a1b2c3d4e5f6a7b8.io", "abcdefghijklmnopqrstu.com"].map(domainOf), ["", "ibm.de", "bbc.co.uk", "ycombinator.com", "", ""]);
  const rows = await run({ ...base(), r: U, out: [[U, "out", 1], ["ibm.de", "out", 1], ["bbc.co.uk", "out", 1], ["news.ycombinator.com", "out", 1]] });
  assert.equal(rows[0].blobs[3], "other");
  assert.deepEqual(rows.filter((r) => r.blobs[0] == "out").map((r) => r.blobs[3]), ["ibm.de", "bbc.co.uk", "ycombinator.com"]);
});

test("SITES: a site that is not in the list writes nothing", async () => {
  const n = async (SITES, url) => { const e = { ...env(), SITES }; await collect(post(base(), {}, url), e, { country: "US" }); return e.rows.length; };
  assert.equal(await n("example.com, shop.example.org", "https://www.example.com/api/t"), 5);
  assert.equal(await n("example.com", "https://EXAMPLE.com/api/t"), 5);
  assert.equal(await n("example.com", "https://evil.example/api/t"), 0);
  assert.equal(await n(undefined, "https://evil.example/api/t"), 5);
});

test("browser and OS major versions, and the User-Agent never appears in a write", async () => {
  const cases = [
    [UA, "Chrome 130", "macOS"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1 MARKERUA7731", "Safari 18", "iOS 18"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0 MARKERUA7731", "Firefox 131", "Windows"],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Edg/130.0 MARKERUA7731", "Edge 130", "Android 15"],
    ["Mozilla/5.0 (X11; Linux x86_64) MARKERUA7731", "other", "Linux"],
    ["MARKERUA7731", "other", "other"],
  ];
  for (const [ua, browser, os] of cases) {
    const rows = await run(base(), { headers: { "user-agent": ua } });
    assert.deepEqual(rows[0].blobs.slice(5), [browser, os], ua);
    assert.ok(!JSON.stringify(rows).includes("MARKERUA"), ua);
  }
});

const long = (n) => "/" + "a".repeat(n - 1);
const reject = [
  ["v is not 1", { v: 2 }],
  ["p has no leading slash", { p: "blog" }],
  ["p has a query string", { p: "/a?q=1" }],
  ["p has a fragment", { p: "/a#x" }],
  ["p is longer than 200", { p: long(201) }],
  ["p is not normalized: an ID segment", { p: "/user/12345" }],
  ["p is not normalized: uppercase", { p: "/Blog" }],
  ["p is not normalized: a trailing slash", { p: "/blog/" }],
  ["r is longer than 255", { r: "a".repeat(252) + ".com" }],
  ["f is not 0 or 1", { f: 2 }],
  ["qb is not 0 or 1", { qb: 2 }],
  ["qb is missing", { qb: undefined }],
  ["d is not s, m or l", { d: "xl" }],
  ["sc is above 10", { sc: 11 }],
  ["sc is not an integer", { sc: 1.5 }],
  ["sc is a string", { sc: "1" }],
  ["dw is negative", { dw: -1 }],
  ["dw is above 86400", { dw: 86401 }],
  ["dw is not a multiple of 5", { dw: 3 }],
  ["lcp is not a multiple of 100", { lcp: 1250 }],
  ["cls is not a multiple of 10", { cls: 45 }],
  ["lcp is below -1", { lcp: -2 }],
  ["lcp is above 60000", { lcp: 60001 }],
  ["cls is above 100000", { cls: 100001 }],
  ["clk is not an array", { clk: {} }],
  ["clk has more than 100 items", { clk: Array.from({ length: 101 }, (_, i) => [`div:nth-child(${i + 1})`, 1, 0, 0]) }],
  ["clk path has an id", { clk: [["div#main", 1, 0, 0]] }],
  ["clk path has an unknown tag", { clk: [["my-widget", 1, 0, 0]] }],
  ["clk path has a tag that is not in the list", { clk: [["marquee", 1, 0, 0]] }],
  ["clk nth-child is 0", { clk: [["div:nth-child(0)", 1, 0, 0]] }],
  ["clk nth-child is 1000", { clk: [["div:nth-child(1000)", 1, 0, 0]] }],
  ["clk count is 0", { clk: [["a", 0, 0, 0]] }],
  ["clk rage is more than clicks", { clk: [["a", 1, 2, 0]] }],
  ["clk dead is more than clicks", { clk: [["a", 1, 0, 2]] }],
  ["clk path has a class", { clk: [["div.btn", 1, 0, 0]] }],
  ["clk path is longer than 120", { clk: [[Array(12).fill("section:nth-child(100)").join(">"), 1, 0, 0]] }],
  ["clk path has more than 12 steps", { clk: [[Array(13).fill("a").join(">"), 1, 0, 0]] }],
  ["clk count is above 10000", { clk: [["a", 10001, 0, 0]] }],
  ["clk tuple is short", { clk: [["a", 1, 0]] }],
  ["err has more than 20 items", { err: Array.from({ length: 21 }, (_, i) => ["Error", "ext", i, 0, 1]) }],
  ["err class has a space", { err: [["Type Error", "ext", 1, 1, 1]] }],
  ["err class is not in the allowlist", { err: [["MyCustomError", "ext", 1, 1, 1]] }],
  ["err script is a full URL", { err: [["Error", "https://cdn.x.com/a.js", 1, 1, 1]] }],
  ["err script has no .js extension", { err: [["Error", "/app", 1, 1, 1]] }],
  ["err script path is not normalized", { err: [["Error", "/assets/app-3f9a8b7c1d.js", 1, 1, 1]] }],
  ["err count is 0", { err: [["Error", "ext", 1, 1, 0]] }],
  ["err line is above 1000000", { err: [["Error", "ext", 1000001, 1, 1]] }],
  ["err col is negative", { err: [["Error", "ext", 1, -1, 1]] }],
  ["err count is above 10000", { err: [["Error", "ext", 1, 1, 10001]] }],
  ["out has more than 50 items", { out: Array.from({ length: 51 }, (_, i) => [`h${i}.com`, "out", 1]) }],
  ["out kind is unknown", { out: [["a.com", "link", 1]] }],
  ["out dl target is not an extension", { out: [["a.b", "dl", 1]] }],
  ["out dl target is not in the list", { out: [["txt", "dl", 1]] }],
  ["out count is 0", { out: [["a.com", "out", 0]] }],
  ["out count is above 10000", { out: [["a.com", "out", 10001]] }],
  ["an extra key", { x: 1 }],
  ["a missing key", { cls: undefined }],
];
for (const [name, patch] of reject) {
  test(`schema rejects: ${name}`, async () => assert.equal((await run({ ...base(), ...patch })).length, 0));
}
test("schema rejects: body is not JSON, is an array, or is above 16 KB", async () => {
  assert.equal((await run("{nope")).length, 0);
  assert.equal((await run("[1]")).length, 0);
  assert.equal((await run(JSON.stringify(base()) + " ".repeat(16384))).length, 0);
});

test("GPC, DNT and the t=0 cookie skip the write", async () => {
  for (const headers of [{ "sec-gpc": "1" }, { dnt: "1" }, { cookie: "a=1; t=0" }]) assert.equal((await run(base(), { headers })).length, 0);
  assert.equal((await run(base(), { headers: { cookie: "t=01" } })).length, 5);
});

test("bots skip the write", async () => {
  assert.equal((await run(base(), { cf: { country: "US", verifiedBotCategory: "Search Engine Crawler" } })).length, 0);
  for (const ua of ["Googlebot/2.1", "HeadlessChrome/130", "Chrome-Lighthouse", "facebookexternalhit preview", "node-fetch"]) assert.equal((await run(base(), { headers: { "user-agent": ua } })).length, 0, ua);
});

test("B: the geo gate is fail-closed", async () => {
  const n = async (cf) => (await run(base(), { cf })).length;
  for (const c of ["DE", "FR", "GB", "CH", "NO", "IS", "LI", "GF", "GP", "MQ", "RE", "YT", "MF", "BL", "PM", "AX", "GI", "GG", "JE", "IM", "XX", "T1", "de", "us", "USA", "", 1]) assert.equal(await n({ country: c }), 0, String(c));
  for (const cf of [null, {}]) assert.equal(await n(cf), 0, String(cf));
  const e = env();
  await collect(post(base()), e);
  assert.equal(e.rows.length, 0, "a request with no cf");
  for (const c of ["US", "IL", "JP"]) assert.equal(await n({ country: c }), 5, c);
  assert.equal((await run(base(), { cf: { country: "IL" } }))[0].blobs[4], "IL");
});

test("C2: a row with f=0 writes double1 = 0, no visit and no quick exit, and the dwell delta", async () => {
  const [row] = await run({ ...base(), f: 0, qb: 0, r: "", dw: 5, clk: [], err: [], out: [] });
  assert.deepEqual(row.doubles, [0, 7, 0, 5, 1200, 40, 0]);
  assert.equal((await run({ ...base(), r: "" }))[0].doubles[6], 1);
});

test("A5: the Host header must pass the host rule; a port is rejected and www. goes", async () => {
  for (const url of ["https://localhost/api/t", "https://127.0.0.1/api/t", "https://[::1]/api/t", "https://example/api/t"]) assert.equal((await run(base(), { url })).length, 0, url);
  for (const url of ["https://evil.example:8443/api/t", "https://www.shop.example.com:8443/api/t"]) assert.equal((await run(base(), { url })).length, 0, url);
  assert.equal((await run(base(), { headers: { host: "evil.example:8443" } })).length, 0);
  const rows = await run(base(), { url: "https://www.shop.example.com/api/t" });
  assert.equal(rows[0].indexes[0], "shop.example.com");
});

test("A5: a version of more than 3 digits writes other", async () => {
  const v = "1".repeat(30);
  const rows = await run(base(), { headers: { "user-agent": `Mozilla/5.0 (Linux; Android ${v}) Chrome/${v}.0` } });
  assert.deepEqual(rows[0].blobs.slice(5), ["other", "other"]);
});

test("A2: an out host that fails the host rule is dropped, and a good one becomes its registrable domain", async () => {
  const rows = await run({ ...base(), out: [["1.2.3.4", "out", 1], ["a.com/x", "out", 1], ["docs.github.com", "out", 2], ["pdf", "dl", 1]] });
  assert.deepEqual(rows.filter((r) => r.blobs[0] == "out").map((r) => r.blobs.slice(2).concat(r.doubles)), [["out", "github.com", 2], ["dl", "pdf", 1]]);
});

test("A3 and A4: allowed classes, scripts and tags pass", async () => {
  const rows = await run({
    ...base(),
    clk: [["other:nth-child(999)>svg>button:nth-child(1)", 3, 3, 3]],
    err: [["Other", "inline", 0, 0, 1], ["ChunkLoadError", "/assets/:x.mjs", 1, 1, 1], ["DOMException", "/.cjs", 1, 1, 1]],
  });
  assert.equal(rows.length, 7);
});

test("caps: 100 clk, 20 err and 50 out make 171 writes", async () => {
  const rows = await run({
    ...base(),
    clk: Array.from({ length: 100 }, (_, i) => [`div:nth-child(${i + 1})`, 1, 0, 0]),
    err: Array.from({ length: 20 }, (_, i) => ["Error", "ext", i, 0, 1]),
    out: Array.from({ length: 50 }, (_, i) => [`h${i}.com`, "out", 1]),
  });
  assert.equal(rows.length, 171);
});

// A Request in Node has no `cf`. This function adds it.
const withCf = (req, country = "US") => Object.defineProperty(req, "cf", { value: country && { country } });
test("router: tracker, beacon, opt-out and 404", async () => {
  const e = env(), req = (path, init, country) => withCf(new Request("https://example.com" + path, init), country);
  let res = await handle(req("/api/t.js"), e);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/javascript");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.ok((await res.text()).length > 100);
  for (const country of ["DE", "XX", null]) {
    res = await handle(req("/api/t.js", {}, country), e);
    assert.equal(await res.text(), "//", String(country));
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  res = await handle(req("/api/t", { method: "POST", body: JSON.stringify(base()), headers: { "user-agent": UA } }), e);
  assert.equal(res.status, 204);
  assert.equal(e.rows.length, 5);
  res = await handle(req("/api/t?optout=1"), e);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("set-cookie"), "t=0; Max-Age=34214400; SameSite=Lax; Path=/");
  for (const [path, method] of [["/api/t", "GET"], ["/api/t/dash", "GET"], ["/", "GET"], ["/api/t.js", "POST"]]) assert.equal((await handle(req(path, { method }), e)).status, 404, path);
});

test("with no request.cf, the CF-IPCountry header gives the country; request.cf wins over the header", async () => {
  const call = async (path, h, cf) => {
    const e = env(), init = path == "/api/t" ? { method: "POST", body: JSON.stringify(base()), headers: { "user-agent": UA, ...h } } : { headers: h };
    const r = new Request("https://example.com" + path, init);
    if (cf) withCf(r, cf);
    const res = await handle(r, e);
    return path == "/api/t" ? e.rows.length : await res.text();
  };
  for (const [h, cf, rows, live] of [[{ "cf-ipcountry": "US" }, null, 5, true], [{ "cf-ipcountry": "DE" }, null, 0, false], [{}, null, 0, false], [{ "cf-ipcountry": "US" }, "DE", 0, false], [{ "cf-ipcountry": "DE" }, "US", 5, true]]) {
    const tag = JSON.stringify([h, cf]);
    assert.equal(await call("/api/t", h, cf), rows, tag);
    const js = await call("/api/t.js", h, cf);
    assert.equal(js.length > 100, live, tag);
    if (!live) assert.equal(js, "//", tag);
  }
});

test("collect stops to read a body after 16 KB", async () => {
  let pulls = 0;
  const body = new ReadableStream({ pull: (c) => { pulls++; c.enqueue(new Uint8Array(1024).fill(32)); } });
  const e = env(), res = await collect(new Request("https://example.com/api/t", { method: "POST", body, duplex: "half" }), e, { country: "US" });
  assert.equal(res.status, 204);
  assert.equal(e.rows.length, 0);
  assert.ok(pulls < 40, String(pulls));
});

test("COLLECT=off: the tracker is empty and the beacon writes nothing", async () => {
  const e = { ...env(), COLLECT: "off" }, req = (path, init) => withCf(new Request("https://example.com" + path, init));
  assert.equal(await (await handle(req("/api/t.js"), e)).text(), "//");
  const res = await handle(req("/api/t", { method: "POST", body: JSON.stringify(base()), headers: { "user-agent": UA } }), e);
  assert.equal(res.status, 204);
  assert.equal(e.rows.length, 0);
  assert.ok((await (await handle(req("/api/t.js"), { ...e, COLLECT: "on" })).text()).length > 100);
});

test("LIMITER: the key is the client IP, a refusal writes nothing, and the IP is not written", async () => {
  const keys = [], e = (success) => ({ ...env(), LIMITER: { limit: async (o) => (keys.push(o), { success }) } });
  const headers = { "cf-connecting-ip": "203.0.113.77" };
  let x = e(false), res = await collect(post(base(), headers), x, { country: "US" });
  assert.equal(res.status, 204);
  assert.equal(x.rows.length, 0);
  x = e(true);
  await collect(post(base(), headers), x, { country: "US" });
  assert.equal(x.rows.length, 5);
  assert.ok(!JSON.stringify(x.rows).includes("203.0.113"));
  assert.deepEqual(keys, [{ key: "203.0.113.77" }, { key: "203.0.113.77" }]);
});

test("a new clone can deploy: predeploy and predev build first; logs hide query strings; the README has the setup", async () => {
  const { readFileSync } = await import("node:fs");
  const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
  const { scripts } = JSON.parse(read("package.json"));
  assert.deepEqual([scripts.predeploy, scripts.predev], ["npm run build", "npm run build"]);
  const w = read("wrangler.jsonc");
  assert.match(w, /"observability": \{ "enabled": true, "logs": \{ "invocation_logs": true \}, "redact_query_string": true \}/);
  assert.ok(w.includes('{ "name": "PROBE_LIMITER", "namespace_id": "1002", "simple": { "limit": 5, "period": 60 } }'));
  const md = read("README.md");
  for (const s of ["`SITES`", "`ROUTES`", "/api/t/dash/login", "/edgeglint-probe/", "`npm install`, `npm run deploy` and `npx wrangler secret put DASH_KEY`", "maximum-value corrections", "_sample_interval", "`PROBE_LIMITER`", "Pages has no rate limiter binding"]) assert.ok(md.includes(s), s);
  assert.doesNotMatch(md, /\?key=|__probe/);
});

test("worker.js exports a fetch handler", async () => {
  const { default: worker } = await import("../src/worker.js");
  assert.equal((await worker.fetch(new Request("https://example.com/nope"), {}, {})).status, 404);
});

test("buckets: dw 86400, lcp 60000, cls 100000 and -1 pass", async () => {
  assert.equal((await run({ ...base(), dw: 86400, lcp: 6e4, cls: 1e5 })).length, 5);
  assert.equal((await run({ ...base(), lcp: -1, cls: -1 })).length, 5);
});

test("a beacon as text/plain;charset=UTF-8 (the sendBeacon string type) or application/json is written", async () => {
  for (const type of ["text/plain;charset=UTF-8", "application/json"]) assert.equal((await run(base(), { headers: { "content-type": type } })).length, 5, type);
});

test("with no TELEMETRY binding, collect sends 204 and writes nothing", async () => {
  const res = await collect(post(base()), {}, { country: "US" });
  assert.equal(res.status, 204);
});

test("the Astro and Pages adapters send the request to handle", async () => {
  for (const call of [(request, env) => astro({ request, locals: { runtime: { env } } }), (request, env) => pages({ request, env, waitUntil() {} })]) {
    const e = env();
    assert.equal((await call(withCf(post(base())), e)).status, 204);
    assert.equal(e.rows.length, 5);
    assert.equal((await call(withCf(new Request("https://example.com/api/t.js")), e)).status, 200);
  }
});

test("readBody stops after max bytes of an endless stream", async () => {
  let reads = 0;
  const body = new ReadableStream({ pull: (c) => (reads++, c.enqueue(new Uint8Array(1024))) });
  assert.equal(await readBody({ body }, 4096), null);
  assert.ok(reads < 40, String(reads));
  assert.equal(await readBody(new Request("https://x.com", { method: "POST", body: "key=a" }), 4096), "key=a");
});


test("previous maxima use the same ranges and steps, and cannot exceed the current maxima", async () => {
  const b = { ...base(), f: 0, prev: [5, 1000, 20] };
  assert.equal((await run(b)).filter((r) => r.blobs[0] == "pv").length, 2);
  for (const prev of [null, [], [5, 1000], [5, 1000, 20, 0], [-1, 1000, 20], [11, 1000, 20],
    ["5", 1000, 20], [5, 1101, 20], [5, 1000, 21], [5, -2, 20], [8, 1000, 20], [5, 1300, 20], [5, 1000, 50]]) {
    assert.deepEqual(await run({ ...b, prev }), [], JSON.stringify(prev));
  }
  assert.deepEqual(await run({ ...b, f: 1 }), []);
  assert.deepEqual(await run({ ...b, extra: 1 }), []);
});
