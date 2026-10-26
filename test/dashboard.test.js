import { test } from "node:test";
import assert from "node:assert/strict";
import { handle } from "../src/collect.js";
import { QUERIES, build, sql, same, CLIENT } from "../src/dashboard.js";
import VERSION from "../src/version.js";
import DEMO from "../src/demo.js";
import { normPath, siteOf, probeKey } from "../src/rules.js";

const KEY = "s3cret-key";
const get = (path, headers = {}, env = { DASH_KEY: KEY, DASH_DEMO: "1" }) => handle(new Request("https://www.example.com" + path, { headers }), env);
const bearer = { authorization: "Bearer " + KEY };

test("auth: an unset DASH_KEY gives 404 on both routes, also with a key", async () => {
  for (const path of ["/api/t/dash", "/api/t/dash/data", "/api/t/dash?key=" + KEY]) assert.equal((await get(path, bearer, { DASH_DEMO: "1" })).status, 404, path);
});

const isLogin = async (res) => {
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.match(html, /<form method="post" action="\/api\/t\/dash\/login">/);
  assert.ok(!html.includes("<script") && !html.includes("example.com"), "the login page has no data");
  return html;
};
const form = (key, env = { DASH_KEY: KEY, DASH_DEMO: "1" }) =>
  handle(new Request("https://www.example.com/api/t/dash/login", { method: "POST", body: new URLSearchParams({ key }), headers: { "content-type": "application/x-www-form-urlencoded" } }), env);

test("auth: a wrong or missing key gives the login page on /api/t/dash and 404 on the data route", async () => {
  for (const [path, headers] of [
    ["/api/t/dash", {}],
    ["/api/t/dash?key=" + KEY, {}],
    ["/api/t/dash", { authorization: "Bearer wrong" }],
    ["/api/t/dash", { cookie: "dk=%E0%A4%A" }],
  ]) {
    const res = await get(path, headers);
    assert.equal(res.headers.get("set-cookie"), null, path);
    await isLogin(res);
  }
  for (const [path, headers] of [
    ["/api/t/dash/data", {}],
    ["/api/t/dash/data", { cookie: "dk=wrong" }],
    ["/api/t/dash/data?key=" + KEY, {}],
    ["/api/t/dash/data", { cookie: "dk=%" }],
  ]) assert.equal((await get(path, headers)).status, 404, path);
});

test("login: a wrong key gives the same login page with no hint; an unset DASH_KEY gives 404", async () => {
  const good = await isLogin(await get("/api/t/dash"));
  for (const key of ["wrong", "", KEY + "x"]) {
    const res = await form(key);
    assert.equal(res.headers.get("set-cookie"), null, key);
    assert.equal(await isLogin(res), good, key);
  }
  assert.equal((await form(KEY, { DASH_DEMO: "1" })).status, 404);
});

test("login: an endless body gives the login page after a maximum of 4096 bytes, with no throw", async () => {
  let reads = 0;
  const body = new ReadableStream({ pull: (c) => (reads++, c.enqueue(new TextEncoder().encode("key=" + "a".repeat(1020)))) });
  const req = { method: "POST", url: "https://www.example.com/api/t/dash/login", headers: new Headers(), body };
  await isLogin(await handle(req, { DASH_KEY: KEY }));
  assert.ok(reads < 40, String(reads));
});

test("auth: the right key in the login form gives 303 and the dk cookie; the cookie and the bearer give 200", async () => {
  const res = await form(KEY);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/api/t/dash");
  const cookie = res.headers.get("set-cookie");
  assert.equal(cookie, `dk=${KEY}; Max-Age=2592000; Path=/api/t/dash; HttpOnly; Secure; SameSite=Strict`);
  const dk = { cookie: "a=1; " + cookie.split(";")[0] };
  for (const headers of [dk, bearer]) {
    assert.equal((await get("/api/t/dash", headers)).status, 200);
    assert.equal((await get("/api/t/dash/data?kind=pv", headers)).status, 200);
  }
});

test("referrer: the login page and the dashboard page send Referrer-Policy same-origin, thus a POST does not have Origin null", async () => {
  const page = await get("/api/t/dash", {}, { DASH_KEY: KEY });
  await isLogin(page);
  assert.equal(page.headers.get("referrer-policy"), "same-origin");
  const dash = await get("/api/t/dash", { cookie: "dk=" + KEY });
  assert.equal(dash.status, 200);
  assert.equal(dash.headers.get("referrer-policy"), "same-origin");
});

test("siteOf (from src/rules.js) keeps the :<port> part, thus the host rule rejects it, and removes www.", async () => {
  const at = (url, host) => siteOf(new Request(url, { headers: host ? { host } : {} }));
  assert.equal(at("https://www.example.com/x"), "example.com");
  assert.equal(at("https://a.example/x", "evil.example:8443"), "evil.example:8443");
  const rows = [], env = { TELEMETRY: { writeDataPoint: (x) => rows.push(x) } };
  const body = JSON.stringify({ v: 1, f: 1, qb: 0, p: "/", r: "", d: "m", sc: 1, dw: 0, lcp: -1, cls: -1, clk: [], err: [], out: [] });
  for (const url of ["https://evil.example:8443/api/t", "https://evil.example/api/t"]) {
    const req = new Request(url, { method: "POST", body, headers: { "user-agent": "Mozilla/5.0" } });
    Object.defineProperty(req, "cf", { value: { country: "US" } });
    assert.equal((await handle(req, env)).status, 204);
  }
  assert.deepEqual(rows.map((r) => r.indexes[0]), ["evil.example"]);
});

test("same() compares keys", async () => {
  assert.equal(await same("abc", "abc"), true);
  assert.equal(await same("abc", "abd"), false);
  assert.equal(await same("abc", "abcd"), false);
});

test("days must be 1, 7, 30 or 90 and kind must be known", async () => {
  for (const d of ["1", "7", "30", "90"]) assert.equal((await get("/api/t/dash/data?days=" + d, bearer)).status, 200, d);
  for (const q of ["days=2", "days=-1", "days=7.0", "days=", "kind=foo", "kind=__proto__", "site=" + "a".repeat(81)]) assert.equal((await get("/api/t/dash/data?" + q, bearer)).status, 400, q);
});

test("diag: missing or incorrect authentication gives 404 without a query", async () => {
  const ANALYTICS_SQL = { query: () => assert.fail("no query without authentication") };
  for (const headers of [{}, { authorization: "Bearer wrong" }, { cookie: "dk=wrong" }, { cookie: "dk=%" }]) {
    assert.equal((await get("/api/t/dash/data?kind=diag", headers, { DASH_KEY: KEY, ANALYTICS_SQL })).status, 404);
  }
  assert.equal((await get("/api/t/dash/data?kind=diag", bearer, { ANALYTICS_SQL })).status, 404);
});

test("diag: cookie and bearer run all candidates in sequence with no cache", async () => {
  const ds = 'events.analyticsEngine."edgeglint"', w = "WHERE timestamp >= $start AND blob1 = $kind", ws = `${w} AND index1 = $site`;
  const day = "toStartOfInterval(timestamp, INTERVAL '1' DAY)";
  const expected = [
    `SELECT index1 FROM ${ds} ${w} GROUP BY index1 ORDER BY index1 LIMIT 50`,
    `SELECT index1 AS site FROM ${ds} ${w} GROUP BY index1 LIMIT 50`,
    `SELECT index1, count() AS n FROM ${ds} ${w} GROUP BY index1 LIMIT 50`,
    `SELECT index1 AS site, count() AS n FROM ${ds} ${w} GROUP BY index1 ORDER BY n DESC LIMIT 50`,
    `SELECT ${day} AS k, sum(double1) AS n FROM ${ds} ${ws} GROUP BY ${day} ORDER BY ${day}`,
    `SELECT ${day}, sum(double1) AS n FROM ${ds} ${ws} GROUP BY ${day}`,
    `SELECT date_trunc('day', timestamp) AS day, sum(double1) AS n FROM ${ds} ${ws} GROUP BY date_trunc('day', timestamp) ORDER BY day`,
    `SELECT toStartOfDay(timestamp) AS day, sum(double1) AS n FROM ${ds} ${ws} GROUP BY toStartOfDay(timestamp) ORDER BY day`,
    `SELECT toDate(timestamp) AS day, sum(double1) AS n FROM ${ds} ${ws} GROUP BY toDate(timestamp) ORDER BY day`,
    `SELECT blob2 AS k, sum(double1) AS n FROM ${ds} ${ws} GROUP BY blob2 ORDER BY sum(double1) DESC LIMIT 20`,
    `SELECT blob2 AS path, sum(double1) AS n FROM ${ds} ${ws} GROUP BY blob2 ORDER BY n DESC LIMIT 20`,
    `SELECT double2 AS k, count() AS n FROM ${ds} ${ws} AND double1 = 1 GROUP BY double2 ORDER BY double2`,
    `SELECT double2 AS bucket, count() AS n FROM ${ds} ${ws} AND double1 = 1 GROUP BY double2 ORDER BY double2`,
    `SELECT sum(double1) AS pageviews, sum(double7) AS visits, sum(double1 * double2) / sum(double1) AS avg_scroll FROM ${ds} ${ws}`,
    `SELECT index1 AS s FROM ${ds} ${w} GROUP BY index1 LIMIT 50`,
    `SELECT blob2 AS site FROM ${ds} ${ws} GROUP BY blob2 LIMIT 5`,
    `SELECT blob2 AS k FROM ${ds} ${ws} GROUP BY blob2 LIMIT 5`,
    `SELECT blob2 AS kk FROM ${ds} ${ws} GROUP BY blob2 LIMIT 5`,
  ];
  const previousCache = globalThis.caches;
  globalThis.caches = { default: {
    match: () => assert.fail("diag must not read the cache"),
    put: () => assert.fail("diag must not write the cache"),
  } };
  try {
    for (const auth of [bearer, { cookie: "dk=" + KEY }]) {
      const calls = [], error = "Input was invalid: column `site` not found " + "x".repeat(400);
      let active = false;
      const ANALYTICS_SQL = { query: async (q) => {
        assert.equal(active, false);
        active = true;
        calls.push(q);
        await Promise.resolve();
        active = false;
        if (q.query == expected[1]) throw new Error(error);
        return { data: calls.length == 3 ? [] : [{ private: "do not return row data" }, {}] };
      } };
      const before = Date.now();
      const res = await get("/api/t/dash/data?kind=diag&site=ignored.example&days=90", { ...auth, host: "www.owner.example" }, { DASH_KEY: KEY, ANALYTICS_SQL, DASH_DEMO: "1" });
      const after = Date.now();
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("content-type"), "application/json");
      assert.deepEqual(calls.map((q) => q.query), expected);
      const start = calls[0].params.start;
      assert.equal(new Date(start).toISOString(), start);
      assert.ok(Date.parse(start) >= before - 7 * 864e5 && Date.parse(start) <= after - 7 * 864e5);
      for (const q of calls) assert.deepEqual(q.params, { start, site: "owner.example", kind: "pv" });
      assert.deepEqual(await res.json(), { candidates: expected.map((sql, i) => ({
        id: "c" + String(i + 1).padStart(2, "0"), sql, ok: i != 1,
        rows: i == 1 ? null : i == 2 ? 0 : 2, error: i == 1 ? error.slice(0, 300) : null,
      })) });
    }
  } finally {
    if (previousCache === undefined) delete globalThis.caches;
    else globalThis.caches = previousCache;
  }
});

test("the query helper always adds the time bound, and the site filter except for the site list", () => {
  const start = "2026-10-01T00:00:00.000Z";
  for (const kind of Object.keys(QUERIES)) {
    for (const [name, , q] of build({}, kind, "example.com", start)) {
      assert.match(q.query, /^SELECT .* FROM events\.analyticsEngine\."edgeglint" WHERE timestamp >= \$start AND blob1 = \$kind/, name);
      assert.equal(q.params.start, start, name);
      assert.ok(/^(pv|clk|err|out)$/.test(q.params.kind), name);
      assert.doesNotMatch(q.query, /FORMAT|accountTag|zoneTag|example\.com/, name);
      if (kind == "sites") assert.ok(!("site" in q.params) && !q.query.includes("$site"), name);
      else assert.ok(q.params.site == "example.com" && q.query.includes(" AND index1 = $site"), name);
    }
  }
  assert.deepEqual(sql({ DATASET: "x" }, { site: "a.com", start, select: "1" }), { query: 'SELECT 1 FROM events.analyticsEngine."x" WHERE timestamp >= $start AND index1 = $site', params: { start, site: "a.com" } });
});

test("weights: the SQL API weights count, sum and avg", () => {
  const text = (kind) => build({}, kind, "s", "t").map(([, , q]) => q.query).join("\n");
  assert.ok(text("clk").includes("sum(double1) AS clicks"));
  assert.ok(text("err").includes("sum(double3) AS n"));
  assert.ok(text("cwv").includes(" AND double1 = 1 AND double5 >= 0"));
  for (const d of ["double5", "double6"]) {
    assert.ok(text("cwv").includes(` AND double1 = 1 AND ${d} >= 0`));
    assert.ok(text("cwv").includes(`avg(${d}) AS avg, count() AS n`));
  }
  for (const kind of Object.keys(QUERIES)) {
    assert.doesNotMatch(text(kind), /_sample_interval/, kind);
    assert.doesNotMatch(text(kind), /DISTINCT/i, kind);
  }
  assert.match(text("sites"), /SELECT index1 AS site, count\(\) AS n .* GROUP BY index1 ORDER BY n DESC LIMIT 50$/);
});

test("dashboard ORDER BY terms use aggregate aliases or function expressions", () => {
  const terms = (text) => {
    const parts = [""];
    let depth = 0;
    for (const c of text) {
      if (c == "(") depth++;
      if (c == ")") depth--;
      if (c == "," && depth == 0) parts.push("");
      else parts[parts.length - 1] += c;
    }
    return parts.map((part) => part.trim());
  };
  const valid = (query) => {
    const order = query.match(/\bORDER BY (.*?)(?: LIMIT\b|$)/i)?.[1];
    if (!order) return true;
    const aliases = new Set(terms(query.match(/^SELECT (.*?) FROM /i)[1]).flatMap((term) =>
      term.match(/^(?:count|countIf|sum|avg)\(.*\) AS (\w+)$/i)?.slice(1) ?? []));
    return terms(order).every((term) => term.includes("(") || aliases.has(term.replace(/\s+(?:ASC|DESC)$/i, "")));
  };
  for (const kind of Object.keys(QUERIES)) {
    for (const [name, , { query }] of build({}, kind, "s", "t")) assert.ok(valid(query), kind + "." + name + ": " + query);
  }
  for (const column of ["index1", "double2"]) {
    for (const term of [column, "k", "n DESC, k ASC"]) {
      assert.equal(valid(`SELECT ${column} AS k, count() AS n FROM events GROUP BY ${column} ORDER BY ${term}`), false, term);
    }
  }
  assert.equal(valid("SELECT index1 AS k, count() AS n FROM events GROUP BY index1 ORDER BY n DESC"), true);
  assert.equal(valid("SELECT index1 AS k FROM events GROUP BY index1 ORDER BY n DESC"), false);
});

test("all dashboard and health queries use listed functions and column expressions", async () => {
  // https://developers.cloudflare.com/analytics/sql-api/sql-reference/functions/ (fetch date: 2026-10-23).
  // Allowlist: count, sum, avg, countIf, toStartOfInterval.
  const allowed = new Set(["count", "sum", "avg", "countif", "tostartofinterval"]);
  const queries = Object.keys(QUERIES).flatMap((kind) => build({}, kind, "s", "t").map(([name, , q]) => [kind + "." + name, q]));
  const ANALYTICS_SQL = { query: async (q) => (queries.push(["health", q]), { data: [] }) };
  for (const path of ["/api/t/health", "/api/t/health?p=/edgeglint-probe/abc123"]) {
    assert.equal((await get(path, {}, { ANALYTICS_SQL })).status, 200);
  }
  assert.equal(queries.filter(([name]) => name == "health").length, 2);
  for (const [name, { query }] of queries) {
    assert.equal(query.match(/\bSELECT\b/gi)?.length, 1, name);
    assert.doesNotMatch(query, /;|\bDISTINCT\b/i, name);
    assert.doesNotMatch(query, /_sample_interval/i, name);
    for (const [, fn] of query.matchAll(/\b([a-z][a-z0-9_]*)\s*\(/gi)) assert.ok(allowed.has(fn.toLowerCase()), `${name}: ${fn}`);
    const aliases = new Set([...query.matchAll(/\bAS (\w+)/g)].map(([, alias]) => alias));
    for (const [, type, clause] of query.matchAll(/(GROUP BY|ORDER BY) (.*?)(?= GROUP BY| ORDER BY| LIMIT|$)/g)) {
      const expression = clause.replace(/'[^']*'/g, "");
      for (const [token, word] of expression.matchAll(/\b([a-z_][a-z0-9_]*)\b\s*\(?/gi)) {
        if (token.trimEnd().endsWith("(")) assert.ok(allowed.has(word.toLowerCase()), `${name}: ${word}`);
        else if (type != "ORDER BY" || !aliases.has(word)) assert.match(word, /^(?:index1|(?:blob|double)(?:[1-9]|1[0-9]|20)|timestamp|INTERVAL|DAY|ASC|DESC)$/i, `${name}: ${clause}`);
      }
    }
  }
});

test("C2: pv counts use double1, visits double7, quick exits double3, dwell double4, and scroll only the first-flush rows", () => {
  const q = Object.fromEntries(build({}, "pv", "s", "t").map(([name, , x]) => [name, x.query]));
  const PV = "sum(double1)";
  for (const part of [`${PV} AS pageviews`, "sum(double7) AS visits", "sum(double3) AS quick_exits", "sum(double4) AS dwell", `sum(double4) / ${PV} AS avg_dwell`, `sum(double1 * double2) / ${PV} AS avg_scroll`]) assert.ok(q.totals.includes(part), part);
  assert.ok(q.daily.includes(`${PV} AS n`));
  const day = "toStartOfInterval(timestamp, INTERVAL '1' DAY)";
  assert.ok(q.daily.includes(`${day} AS k`));
  assert.ok(q.daily.endsWith(`GROUP BY ${day} ORDER BY ${day}`));
  for (const [name, col] of [["paths", "blob2"], ["referrers", "blob4"], ["countries", "blob5"], ["browsers", "blob6"], ["os", "blob7"], ["devices", "blob3"]]) {
    assert.ok(q[name].includes(`${col} AS k, ${PV} AS n`), name);
    assert.ok(q[name].endsWith(`GROUP BY ${col} ORDER BY ${PV} DESC LIMIT 20`), name);
  }
  assert.match(q.scroll, / AND double1 = 1 GROUP BY double2$/);
  assert.equal(DEMO.pv.totals.avg_dwell, Math.round(DEMO.pv.totals.dwell / DEMO.pv.totals.pageviews));
});

test("the data route maps the SQL rows", async () => {
  const calls = [];
  const ANALYTICS_SQL = { query: async (q) => (calls.push(q), { data: [{ k: "/", n: "5", pageviews: "5", avg_scroll: "4.5" }], rows: 1 }) };
  const res = await get("/api/t/dash/data?kind=pv&days=30&site=a.com", bearer, { DASH_KEY: KEY, ANALYTICS_SQL });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.totals, { pageviews: "5", visits: 0, quick_exits: 0, avg_scroll: "4.5", dwell: 0, avg_dwell: null });
  assert.deepEqual(body.paths, [{ k: "/", n: "5", pageviews: "5", avg_scroll: "4.5" }]);
  assert.equal(calls.length, Object.keys(QUERIES.pv).length);
  assert.ok(calls.every((q) => q.params.site == "a.com" && Date.now() - Date.parse(q.params.start) - 30 * 864e5 < 6e4));
  const err = Object.assign(new Error("x"), { retryable: true });
  const bad = await get("/api/t/dash/data?kind=clk", bearer, { DASH_KEY: KEY, ANALYTICS_SQL: { query: async () => { throw err; } } });
  assert.equal(bad.status, 503);
  assert.deepEqual(await bad.json(), { error: "query failed", retryable: true, detail: "x" });
});

test("the server sorts scroll buckets numerically and keeps the other row lists in SQL sequence", async () => {
  const input = [{ k: "100", n: "3" }, { k: 2, n: "7" }, { k: "10", n: "4" }, { k: 0, n: "1" }];
  for (const scroll of [input, []]) {
    const ANALYTICS_SQL = { query: async ({ query }) => ({ data: query.endsWith("GROUP BY double2") ? [...scroll] : [...input] }) };
    const res = await get("/api/t/dash/data?kind=pv", bearer, { DASH_KEY: KEY, ANALYTICS_SQL });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.scroll, scroll.length ? [input[3], input[1], input[2], input[0]] : []);
    assert.deepEqual(body.paths, input);
  }
});

test("the sites response keeps the site field and the SQL sequence", async () => {
  const sites = [{ site: "z.example", n: "10" }, { site: "a.example", n: "2" }];
  const ANALYTICS_SQL = { query: async () => ({ data: sites }) };
  const res = await get("/api/t/dash/data?kind=sites", bearer, { DASH_KEY: KEY, ANALYTICS_SQL });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { sites });
});

test("SQL error detail needs cookie or bearer auth and has a 500-character limit", async () => {
  const store = new Map();
  globalThis.caches = { default: { match: async (k) => store.get(k)?.clone(), put: async (k, r) => void store.set(k, r) } };
  let calls = 0;
  try {
    for (const error of [new Error("Unknown SQL function"), new Error("x".repeat(501)), { message: 42 }, "SQL error"]) {
      const env = { DASH_KEY: KEY, ANALYTICS_SQL: { query: async () => { calls++; throw error; } } };
      for (const headers of [{}, { cookie: "dk=wrong" }, { authorization: "Bearer wrong" }]) {
        const before = calls;
        const res = await get("/api/t/dash/data?kind=sites", headers, env);
        assert.equal(res.status, 404);
        assert.equal(await res.text(), "Not found");
        assert.equal(calls, before);
      }
      for (const headers of [bearer, { cookie: "dk=" + KEY }]) {
        for (const kind of ["pv", "cwv", "sites"]) {
          const res = await get("/api/t/dash/data?kind=" + kind, headers, env);
          assert.equal(res.status, 503);
          assert.equal(res.headers.get("cache-control"), "no-store");
          assert.deepEqual(await res.json(), { error: "query failed", retryable: false, detail: String(error.message ?? error).slice(0, 500) });
        }
      }
      for (const headers of [{}, bearer]) {
        const res = await get("/api/t/health", headers, env);
        assert.equal(res.status, 503);
        assert.deepEqual(await res.json(), { error: "query failed", retryable: false });
      }
    }
    assert.equal(store.size, 0);
  } finally {
    delete globalThis.caches;
  }
});

test("health with a fake binding, the /edgeglint-probe/ restriction and no binding", async () => {
  const calls = [];
  const ANALYTICS_SQL = { query: async (q) => (calls.push(q), { data: [{ n: "17", ...(q.params.path && { pv: 2 }) }] }) };
  // The collector accepts only a normalized path. Thus the probe path must be normalized.
  assert.equal(normPath("/edgeglint-probe/abc123"), "/edgeglint-probe/abc123");
  let res = await get("/api/t/health?p=/edgeglint-probe/abc123", {}, { ANALYTICS_SQL });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "max-age=60");
  assert.deepEqual(await res.json(), { points_last_hour: 17, probe: { path: await probeKey("abc123"), pv_rows: 2 } });
  // One SQL statement gives the two counts.
  assert.deepEqual(calls.map((q) => q.params), [{ start: calls[0].params.start, site: "example.com", path: await probeKey("abc123") }]);
  assert.match(calls[0].query, /^SELECT count\(\) AS n, countIf\(blob1 = 'pv' AND blob2 = \$path\) AS pv FROM /);
  assert.ok(Date.now() - Date.parse(calls[0].params.start) - 36e5 < 6e4);
  // A name as the token: the query uses the probeKey path, not the name.
  calls.length = 0;
  await get("/api/t/health?p=/edgeglint-probe/alicesmith", {}, { ANALYTICS_SQL });
  assert.equal(calls[0].params.path, await probeKey("alicesmith"));
  assert.doesNotMatch(JSON.stringify(calls), /alicesmith/);
  for (const p of ["/pricing", "/x/edgeglint-probe/1", "", "/edgeglint-probe/abc", "/edgeglint-probe/abc123/x", "/edgeglint-probe/Deadbeef", "/edgeglint-probe/a?b", "/edgeglint-probe/" + "a-".repeat(100)]) {
    calls.length = 0;
    res = await get("/api/t/health?p=" + p, {}, { ANALYTICS_SQL });
    assert.deepEqual(await res.json(), { points_last_hour: 17, probe: null }, p);
    assert.equal(calls.length, 1, p);
  }
  res = await get("/api/t/health", {}, {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { points_last_hour: null, reason: "no ANALYTICS_SQL binding" });
});

test("health: PROBE_LIMITER refuses, accepts, or is absent", async () => {
  const store = new Map(), calls = [], limit = [];
  globalThis.caches = { default: { match: async (k) => store.get(k)?.clone(), put: async (k, r) => void store.set(k, r) } };
  const ANALYTICS_SQL = { query: async (q) => (calls.push(q), { data: [{ n: 9, ...(q.params.path && { pv: 1 }) }] }) };
  const lim = (success) => ({ limit: async (o) => (limit.push(o), { success }) });
  const health = async (p, env) => (await get("/api/t/health?p=" + p, {}, { ANALYTICS_SQL, ...env })).json();
  try {
    // Refuses: `probe` is null, no query with p runs, and `points_last_hour` comes from the query with no p.
    assert.deepEqual(await health("/edgeglint-probe/aaa111", { PROBE_LIMITER: lim(false) }), { points_last_hour: 9, probe: null });
    assert.deepEqual([limit, calls.map((q) => q.params.path)], [[{ key: "probe" }], [undefined]]);
    // The next refusal uses the cached answer with no p. It makes no query.
    assert.deepEqual(await health("/edgeglint-probe/aaa111", { PROBE_LIMITER: lim(false) }), { points_last_hour: 9, probe: null });
    assert.equal(calls.length, 1);
    // Accepts: one query gives the two counts.
    assert.deepEqual(await health("/edgeglint-probe/bbb222", { PROBE_LIMITER: lim(true) }), { points_last_hour: 9, probe: { path: await probeKey("bbb222"), pv_rows: 1 } });
    assert.equal(calls.at(-1).params.path, await probeKey("bbb222"));
    // No binding: the query runs, and the cache lets one query for each token in 60 s.
    calls.length = 0;
    for (let i = 0; i < 3; i++) assert.deepEqual(await health("/edgeglint-probe/ccc333", {}), { points_last_hour: 9, probe: { path: await probeKey("ccc333"), pv_rows: 1 } });
    assert.equal(calls.length, 1);
  } finally {
    delete globalThis.caches;
  }
});

test("demo page: version footer, nonce CSP, and no fixture markup in the HTML", async () => {
  const res = await get("/api/t/dash", bearer);
  const html = await res.text();
  assert.ok(html.includes(`edgeglint v${VERSION.version} ${VERSION.sha}`));
  assert.doesNotMatch(html, /p75/);
  assert.match(VERSION.version, /^\d+\.\d+\.\d+$/);
  const nonce = res.headers.get("content-security-policy").match(/script-src 'nonce-([0-9a-f-]+)'/)[1];
  assert.ok(html.includes(`<script nonce="${nonce}">`));
  assert.ok(!html.includes("alert(1)") && !html.includes("onerror"));
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(html));
  const data = await (await get("/api/t/dash/data?kind=pv", bearer)).json();
  assert.ok(data.paths.some((r) => r.k.includes("<script>")), "the fixture has markup");
});

test("cache: the stored copy is not private, the browser copy is private, and a hit makes no query", async () => {
  const store = new Map(), puts = [];
  globalThis.caches = { default: {
    match: async (k) => store.get(k)?.clone(),
    // caches.default does not keep a `private` answer.
    put: async (k, r) => { if (/private/.test(r.headers.get("cache-control"))) throw new Error("private"); puts.push(r.headers.get("cache-control")); store.set(k, r); },
  } };
  try {
    let n = 0;
    const env = { DASH_KEY: KEY, ANALYTICS_SQL: { query: async () => (n++, { data: [{ n: 1 }] }) } };
    for (let i = 0; i < 2; i++) {
      const res = await get("/api/t/dash/data?kind=cwv&site=a.com", bearer, env);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("cache-control"), "private, max-age=60");
      assert.deepEqual((await res.json()).lcp, { avg: null, n: 1 });
    }
    assert.equal(n, Object.keys(QUERIES.cwv).length);
    assert.deepEqual(puts, ["max-age=60"]);
    const h = await get("/api/t/health", {}, { ANALYTICS_SQL: env.ANALYTICS_SQL });
    assert.equal(h.headers.get("cache-control"), "max-age=60");
  } finally {
    delete globalThis.caches;
  }
});

test("health: the cache key has only the site and the validated p; LIMITER can refuse", async () => {
  const keys = [];
  globalThis.caches = { default: { match: async (k) => void keys.push(k), put: async () => {} } };
  try {
    const env = { ANALYTICS_SQL: { query: async () => ({ data: [{ n: 1 }] }) } };
    for (const q of ["?p=/edgeglint-probe/abc123&x=1", "?x=2&p=/edgeglint-probe/abc123", "?p=/pricing&z=3", "?y=1"]) await get("/api/t/health" + q, {}, env);
    const health = "https://www.example.com/api/t/health?site=example.com&p=";
    assert.deepEqual(keys, [health + encodeURIComponent(await probeKey("abc123")), health + encodeURIComponent(await probeKey("abc123")), health, health]);
    keys.length = 0;
    await get("/api/t/dash/data?kind=pv&days=7&zz=1", bearer, { ...env, DASH_KEY: KEY });
    assert.deepEqual(keys, ["https://www.example.com/api/t/dash/data?host=example.com&site=example.com&kind=pv&days=7"]);
    const limit = [];
    const res = await get("/api/t/health", { "cf-connecting-ip": "203.0.113.9" }, { ...env, LIMITER: { limit: async (o) => (limit.push(o), { success: false }) } });
    assert.equal(res.status, 429);
    assert.deepEqual(limit, [{ key: "203.0.113.9" }]);
  } finally {
    delete globalThis.caches;
  }
});

test("0 rows: a row of nulls gives 0 for totals and null for averages", async () => {
  const ANALYTICS_SQL = { query: async (q) => ({ data: q.query.includes("GROUP BY") ? [] : [Object.fromEntries([...q.query.matchAll(/ AS (\w+)/g)].map(([, k]) => [k, k == "avg_dwell" ? "nan" : null]))] }) };
  const pv = await (await get("/api/t/dash/data?kind=pv", bearer, { DASH_KEY: KEY, ANALYTICS_SQL })).json();
  assert.deepEqual(pv.totals, { pageviews: 0, visits: 0, quick_exits: 0, avg_scroll: null, dwell: 0, avg_dwell: null });
  const cwv = await (await get("/api/t/dash/data?kind=cwv", bearer, { DASH_KEY: KEY, ANALYTICS_SQL })).json();
  assert.deepEqual(cwv, { lcp: { avg: null, n: 0 }, cls: { avg: null, n: 0 } });
});

// A fake DOM for the client script. It records each text and attribute, and it throws on innerHTML.
const fakeDom = (data) => {
  const all = [];
  const node = (tag) => {
    const e = { tag, children: [], attrs: {}, textContent: "", value: "", className: "", title: "" };
    Object.defineProperty(e, "innerHTML", { set: () => { throw new Error("innerHTML"); } });
    e.append = (c) => e.children.push(c);
    e.replaceChildren = (...c) => (e.children = c);
    e.setAttribute = (k, v) => (e.attrs[k] = String(v));
    all.push(e);
    return e;
  };
  const ids = { main: node("main"), site: node("select"), days: Object.assign(node("select"), { value: "7" }) };
  const document = { createElement: node, createElementNS: (ns, tag) => node(tag), getElementById: (id) => ids[id] };
  const fetch = async (u) => ({ ok: true, json: async () => data[new URL(u, "https://x.test").searchParams.get("kind")] });
  return { all, ids, globals: { document, fetch, location: { hostname: "example.com" } } };
};
const run = async (data) => {
  const dom = fakeDom(data), g = dom.globals;
  new Function(...Object.keys(g), CLIENT)(...Object.values(g));
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return dom;
};
const texts = (dom) => dom.all.map((e) => e.textContent);

test("XSS: the client puts the fixture markup into the DOM as text only", async () => {
  const dom = await run(DEMO);
  assert.ok(texts(dom).includes("/<script>alert(1)</script>"));
  assert.ok(texts(dom).some((t) => t.includes("<img src=x onerror=alert(1)>")));
  assert.ok(dom.all.every((e) => Object.values(e.attrs).every((v) => !v.includes("<"))));
  assert.ok(!dom.ids.main.children.some((c) => /Cannot load/.test(c.textContent)));
});

test("zero rows: the client shows - for a null average and does not multiply null", async () => {
  const empty = { ...DEMO, pv: { ...DEMO.pv, totals: { pageviews: 0, visits: 0, quick_exits: 0, avg_scroll: null, dwell: 0, avg_dwell: null } }, cwv: { lcp: { avg: null, n: 0 }, cls: { avg: null, n: 0 } } };
  const tiles = (await run(empty)).all.filter((e) => e.tag == "strong").map((e) => e.textContent);
  assert.deepEqual(tiles, ["0", "0", "0", "- %", "- s", "- ms", "-"]);
});

test("a dataset that does not exist yet gives zeros and nulls; another SQL error gives 503", async () => {
  const throws = (message) => ({ query: async () => { throw Object.assign(new Error(message), { retryable: false }); } });
  for (const message of ['Dataset "edgeglint" does not exist', "Table events.analyticsEngine.edgeglint doesn't exist", "table not found"]) {
    const ANALYTICS_SQL = throws(message);
    let res = await get("/api/t/health?p=/edgeglint-probe/abc123", {}, { ANALYTICS_SQL });
    assert.equal(res.status, 200, message);
    assert.deepEqual(await res.json(), { points_last_hour: 0, probe: { path: await probeKey("abc123"), pv_rows: 0 } });
    res = await get("/api/t/dash/data?kind=pv", bearer, { DASH_KEY: KEY, ANALYTICS_SQL });
    const pv = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(pv.totals, { pageviews: 0, visits: 0, quick_exits: 0, avg_scroll: null, dwell: 0, avg_dwell: null });
    assert.deepEqual([pv.daily, pv.paths, pv.scroll], [[], [], []]);
    res = await get("/api/t/dash/data?kind=cwv", bearer, { DASH_KEY: KEY, ANALYTICS_SQL });
    assert.deepEqual(await res.json(), { lcp: { avg: null, n: 0 }, cls: { avg: null, n: 0 } });
  }
  const ANALYTICS_SQL = throws("syntax error");
  let res = await get("/api/t/health", {}, { ANALYTICS_SQL });
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: "query failed", retryable: false });
  res = await get("/api/t/dash/data?kind=sites", bearer, { DASH_KEY: KEY, ANALYTICS_SQL });
  assert.equal(res.status, 503);
});
