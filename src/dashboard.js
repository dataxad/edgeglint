// edgeglint dashboard: the health route, the dashboard page and its JSON data route.
// All queries go through the Analytics SQL binding (`env.ANALYTICS_SQL`). No API token is necessary.
import VERSION from "./version.js";
import DEMO from "./demo.js";
// The collector writes siteOf(request) into index1. The dashboard uses the same function.
import { siteOf, isProbe, probeKey, readBody, PROBE } from "./rules.js";

// This is the one function that adds the time bound and the site condition. All queries come from it.
export const sql = (env, { kind, site, start, select, where = "", tail = "", params = {} }) => ({
  query: `SELECT ${select} FROM events.analyticsEngine."${env.DATASET || "edgeglint"}" WHERE timestamp >= $start${kind ? " AND blob1 = $kind" : ""}${site ? " AND index1 = $site" : ""}${where} ${tail}`.trim(),
  params: { start, ...(kind && { kind }), ...(site && { site }), ...params },
});

// https://developers.cloudflare.com/analytics/sql-api/datasets/ says:
// "Workers Analytics Engine datasets are adaptively sampled. The SQL API applies sample weights to supported aggregates."
// https://developers.cloudflare.com/analytics/sql-api/sql-reference/functions/ names COUNT, SUM and AVG as weighted aggregates.
const N = "count()", sum = (d) => `sum(${d})`;
// A page load writes one pv row for each flush. double1 is 1 only on the first flush, thus PV counts each pageview one time.
// The visit flag (double7) and the quick-exit flag (double3) are 0 on each subsequent flush. double4 is the dwell time since the previous flush.
const PV = sum("double1"), FIRST = " AND double1 = 1";
const top = (col, n = 20, w = N) => ({ select: `${col} AS k, ${w} AS n`, tail: `GROUP BY ${col} ORDER BY ${w} DESC LIMIT ${n}` });
// LCP and CLS: -1 is "unknown", so these queries use only the rows with a value. They use only the first-flush rows, as the scroll queries do.
// https://developers.cloudflare.com/analytics/sql-api/sql-reference/functions/ lists no percentile function that this binding can use; show the average only.
const vital = (d) => ({ one: true, where: `${FIRST} AND ${d} >= 0`, select: `avg(${d}) AS avg, ${N} AS n` });
// Each dashboard data type is a set of named queries. `one` gives the first row, not the list.
// 2026-10-23: ORDER BY must use an aggregate alias or a function expression in full. Do not use aliased grouped columns.
export const QUERIES = {
  // The SQL API cannot do a row-level SELECT DISTINCT. Thus the site list uses GROUP BY.
  sites: { sites: { site: false, select: `index1 AS site, ${N} AS n`, tail: "GROUP BY index1 ORDER BY n DESC LIMIT 50" } },
  pv: {
    // The average scroll uses only the first-flush rows: sum(double1 * double2) / PV.
    totals: { one: true, select: `${PV} AS pageviews, ${sum("double7")} AS visits, ${sum("double3")} AS quick_exits, ${sum("double1 * double2")} / ${PV} AS avg_scroll, ${sum("double4")} AS dwell, ${sum("double4")} / ${PV} AS avg_dwell` },
    daily: { select: `toStartOfInterval(timestamp, INTERVAL '1' DAY) AS k, ${PV} AS n`, tail: "GROUP BY toStartOfInterval(timestamp, INTERVAL '1' DAY) ORDER BY toStartOfInterval(timestamp, INTERVAL '1' DAY)" },
    paths: top("blob2", 20, PV), referrers: top("blob4", 20, PV), countries: top("blob5", 20, PV), browsers: top("blob6", 20, PV), os: top("blob7", 20, PV), devices: top("blob3", 20, PV),
    scroll: { where: FIRST, select: `double2 AS k, ${N} AS n`, tail: "GROUP BY double2" },
  },
  cwv: { lcp: vital("double5"), cls: vital("double6") },
  // ponytail: the top 30 (path, element) pairs of the site, not the top 30 for each path. Upgrade: add a path condition to this query.
  clk: { rows: { select: `blob2 AS path, blob3 AS el, ${sum("double1")} AS clicks, ${sum("double2")} AS rage, ${sum("double3")} AS dead`, tail: "GROUP BY blob2, blob3 ORDER BY sum(double1) DESC LIMIT 30" } },
  err: { rows: { select: `blob3 AS class, blob4 AS script, double1 AS line, ${sum("double3")} AS n`, tail: "GROUP BY blob3, blob4, double1 ORDER BY sum(double3) DESC LIMIT 30" } },
  out: { rows: { select: `blob3 AS kind, blob4 AS target, ${sum("double1")} AS n`, tail: "GROUP BY blob3, blob4 ORDER BY sum(double1) DESC LIMIT 30" } },
};
// The cwv and sites queries read the pv rows.
export const build = (env, kind, site, start) =>
  Object.entries(QUERIES[kind]).map(([name, q]) => [name, q.one, sql(env, { ...q, kind: kind == "clk" || kind == "err" || kind == "out" ? kind : "pv", site: q.site === false ? null : site, start })]);

const json = (body, status = 200, cache = "no-store") =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": cache, "X-Content-Type-Options": "nosniff" } });
const notFound = () => new Response("Not found", { status: 404 });
const ago = (ms) => new Date(Date.now() - ms).toISOString();
// Before the first write, there is no dataset. Then the query gives no rows and the route records nothing. Other errors go up.
const rows = async (env, q) => {
  try {
    return (await env.ANALYTICS_SQL.query(q)).data;
  } catch (e) {
    if (/(dataset|table).*(n[o']t exist|not found)/i.test(e?.message)) return [];
    throw e;
  }
};
// An aggregate query with no GROUP BY gives one row of nulls when the query finds no rows. A missing dataset gives no row.
// Then a total or a count becomes 0, and an average becomes null. The page shows null as "-".
const AVG = /^(avg|avg_\w+)$/;
const fill = (q, row = {}) => Object.fromEntries([...q.query.matchAll(/ AS (\w+)/g)].map(([, k]) => [k, row[k] == null || isNaN(row[k]) ? (AVG.test(k) ? null : 0) : row[k]]));

// Workers Free lets a Worker do 10,000 read queries each day. Each answer stays in caches.default for 60 s; the key is the URL.
// caches.default does not keep an answer that has `private`. Thus the cache keeps the answer with `max-age=60`.
// The browser gets the Cache-Control value in the `browser` argument.
// Node has no `caches`, so most tests run without the cache.
// The key is a canonical URL from the validated values only. Thus an unknown query parameter cannot go around the cache.
const cached = async (key, ctx, make, browser = "max-age=60") => {
  const cache = globalThis.caches?.default;
  let res = await cache?.match(key);
  if (!res) {
    res = await make();
    // make() gives null or a status that is not 200. Then the cache does not keep it.
    if (res?.status != 200) return res;
    if (cache) {
      const put = cache.put(key, new Response(res.clone().body, { headers: { ...Object.fromEntries(res.headers), "cache-control": "max-age=60" } }));
      ctx?.waitUntil ? ctx.waitUntil(put) : await put;
    }
  }
  res = new Response(res.body, res);
  res.headers.set("Cache-Control", browser);
  return res;
};
const fail = (e, detail = false) => json({ error: "query failed", retryable: !!e?.retryable, ...(detail && { detail: String(e?.message ?? e ?? "").slice(0, 500) }) }, 503);

// The canonical cache key has the scheme and host of the request URL, the route and the validated values.
const keyOf = (request, route, params) => `${new URL(request.url).origin}${route}?${new URLSearchParams(params)}`;
// The rate limiter key is the client IP, as in the collector. The Worker does not write or keep it.
const limited = async (request, env) => env.LIMITER && !(await env.LIMITER.limit({ key: request.headers.get("cf-connecting-ip") || "" })).success;

// GET /api/t/health?p=/edgeglint-probe/<token>. Public. It shows no personal data: two counts for the site of the request.
// The route uses p only when p obeys `isProbe`. It queries the probeKey path of the token, as the collector writes it.
// One SQL statement gives the two counts. countIf is a weighted aggregate, as count() is.
// The route counts the rows of the health check path only when PROBE_LIMITER lets it, with the key `"probe"`.
// Pages has no rate limiter binding. Without PROBE_LIMITER, the cache lets one query for each token in 60 s.
// When PROBE_LIMITER refuses, the route gives the cached answer with no p, and `probe` is null.
const health = async (request, env, ctx) => {
  const raw = new URL(request.url).searchParams.get("p"), site = siteOf(request);
  if (await limited(request, env)) return json({ error: "too many requests" }, 429);
  const one = (p) => cached(keyOf(request, "/api/t/health", { site, p }), ctx, async () => {
    if (!env.ANALYTICS_SQL) return json({ points_last_hour: null, reason: "no ANALYTICS_SQL binding" }, 200, "max-age=60");
    if (p && env.PROBE_LIMITER && !(await env.PROBE_LIMITER.limit({ key: "probe" })).success) return null;
    try {
      const pv = p ? `, countIf(blob1 = 'pv' AND blob2 = $path) AS pv` : "";
      const [r] = await rows(env, sql(env, { site, start: ago(36e5), select: `${N} AS n${pv}`, params: p ? { path: p } : {} }));
      return json({ points_last_hour: Number(r?.n ?? 0), probe: p ? { path: p, pv_rows: Number(r?.pv ?? 0) } : null }, 200, "max-age=60");
    } catch (e) {
      return fail(e);
    }
  });
  return (isProbe(raw) && (await one(await probeKey(raw.slice(PROBE.length))))) || one("");
};

// Compare the SHA-256 hashes. Thus the key length and the first different byte do not change the time.
const digest = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
export const same = async (a, b) => {
  const [x, y] = await Promise.all([digest(String(a)), digest(String(b))]);
  return x.reduce((d, v, i) => d | (v ^ y[i]), 0) == 0;
};
// An incorrect cookie (for example `dk=%`) gives "". Thus the route gives 404, not a URIError.
const decode = (s) => { try { return decodeURIComponent(s); } catch { return ""; } };
const given = (h) => h.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ?? decode(h.get("cookie")?.match(/(?:^|;\s*)dk=([^;]*)/)?.[1] ?? "");
// An incorrect or missing key gives 404, the same as an unset DASH_KEY. Thus nobody can find the route.
const authed = async (request, env) => !!env.DASH_KEY && (await same(given(request.headers), env.DASH_KEY));

const diagnostic = async (request, env) => {
  const ds = 'events.analyticsEngine."edgeglint"', w = "WHERE timestamp >= $start AND blob1 = $kind", ws = `${w} AND index1 = $site`;
  const params = { start: ago(7 * 864e5), site: siteOf(request), kind: "pv" };
  const queries = [
    ["c01", `SELECT index1 FROM ${ds} ${w} GROUP BY index1 ORDER BY index1 LIMIT 50`],
    ["c02", `SELECT index1 AS site FROM ${ds} ${w} GROUP BY index1 LIMIT 50`],
    ["c03", `SELECT index1, count() AS n FROM ${ds} ${w} GROUP BY index1 LIMIT 50`],
    ["c04", `SELECT index1 AS site, count() AS n FROM ${ds} ${w} GROUP BY index1 ORDER BY n DESC LIMIT 50`],
    ["c05", `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY) AS k, sum(double1) AS n FROM ${ds} ${ws} GROUP BY toStartOfInterval(timestamp, INTERVAL '1' DAY) ORDER BY toStartOfInterval(timestamp, INTERVAL '1' DAY)`],
    ["c06", `SELECT toStartOfInterval(timestamp, INTERVAL '1' DAY), sum(double1) AS n FROM ${ds} ${ws} GROUP BY toStartOfInterval(timestamp, INTERVAL '1' DAY)`],
    ["c07", `SELECT date_trunc('day', timestamp) AS day, sum(double1) AS n FROM ${ds} ${ws} GROUP BY date_trunc('day', timestamp) ORDER BY day`],
    ["c08", `SELECT toStartOfDay(timestamp) AS day, sum(double1) AS n FROM ${ds} ${ws} GROUP BY toStartOfDay(timestamp) ORDER BY day`],
    ["c09", `SELECT toDate(timestamp) AS day, sum(double1) AS n FROM ${ds} ${ws} GROUP BY toDate(timestamp) ORDER BY day`],
    ["c10", `SELECT blob2 AS k, sum(double1) AS n FROM ${ds} ${ws} GROUP BY blob2 ORDER BY sum(double1) DESC LIMIT 20`],
    ["c11", `SELECT blob2 AS path, sum(double1) AS n FROM ${ds} ${ws} GROUP BY blob2 ORDER BY n DESC LIMIT 20`],
    ["c12", `SELECT double2 AS k, count() AS n FROM ${ds} ${ws} AND double1 = 1 GROUP BY double2 ORDER BY double2`],
    ["c13", `SELECT double2 AS bucket, count() AS n FROM ${ds} ${ws} AND double1 = 1 GROUP BY double2 ORDER BY double2`],
    ["c14", `SELECT sum(double1) AS pageviews, sum(double7) AS visits, sum(double1 * double2) / sum(double1) AS avg_scroll FROM ${ds} ${ws}`],
    ["c15", `SELECT index1 AS s FROM ${ds} ${w} GROUP BY index1 LIMIT 50`],
    ["c16", `SELECT blob2 AS site FROM ${ds} ${ws} GROUP BY blob2 LIMIT 5`],
    ["c17", `SELECT blob2 AS k FROM ${ds} ${ws} GROUP BY blob2 LIMIT 5`],
    ["c18", `SELECT blob2 AS kk FROM ${ds} ${ws} GROUP BY blob2 LIMIT 5`],
  ];
  const candidates = [];
  for (const [id, query] of queries) {
    try {
      const result = await env.ANALYTICS_SQL.query({ query, params });
      candidates.push({ id, sql: query, ok: true, rows: result.data.length, error: null });
    } catch (e) {
      candidates.push({ id, sql: query, ok: false, rows: null, error: String(e?.message ?? e ?? "").slice(0, 300) });
    }
  }
  return json({ candidates });
};

const DAYS = new Set(["1", "7", "30", "90"]);
const data = async (request, env, ctx) => {
  if (!(await authed(request, env))) return notFound();
  const u = new URL(request.url).searchParams, kind = u.get("kind") ?? "pv", days = u.get("days") ?? "7", site = u.get("site") || siteOf(request);
  if (kind == "diag") return diagnostic(request, env);
  if (!Object.hasOwn(QUERIES, kind) || !DAYS.has(days) || site.length > 80) return json({ error: "kind, days (1, 7, 30, 90) or site is not valid" }, 400);
  if (env.DASH_DEMO == "1") return json(DEMO[kind]);
  if (!env.ANALYTICS_SQL) return json({ error: "no ANALYTICS_SQL binding" }, 503);
  return cached(keyOf(request, "/api/t/dash/data", { host: siteOf(request), site, kind, days }), ctx, async () => {
    try {
      const out = {};
      await Promise.all(build(env, kind, site, ago(days * 864e5)).map(async ([name, one, q]) => {
        const result = await rows(env, q);
        out[name] = one ? fill(q, result[0]) : name == "scroll" ? result.sort((a, b) => a.k - b.k) : result;
      }));
      return json(out, 200, "max-age=60");
    } catch (e) {
      return fail(e, true);
    }
  }, "private, max-age=60");
};

// The login page has no data. An incorrect key gives the same page with status 200 and no hint.
// Referrer-Policy is same-origin. With no-referrer, the browser sends Origin null on the login POST, and the Astro CSRF check gives 403.
const login = () =>
  new Response(LOGIN, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'", "Referrer-Policy": "same-origin" },
  });
// POST /api/t/dash/login has the field `key` in an application/x-www-form-urlencoded body. The key is not in a URL. Thus the Worker request records do not show it.
const signin = async (request, env) => {
  if (!env.DASH_KEY) return notFound();
  // The route reads a maximum of 4096 bytes of the body. A larger body gives the login page, and the route does not parse it.
  const body = await readBody(request, 4096);
  if (body == null || !(await same(new URLSearchParams(body).get("key") ?? "", env.DASH_KEY))) return login();
  const cookie = `dk=${encodeURIComponent(env.DASH_KEY)}; Max-Age=2592000; Path=/api/t/dash; HttpOnly; Secure; SameSite=Strict`;
  return new Response(null, { status: 303, headers: { Location: "/api/t/dash", "Set-Cookie": cookie, "Cache-Control": "no-store" } });
};

const dash = async (request, env) => {
  if (!env.DASH_KEY) return notFound();
  if (!(await authed(request, env))) return login();
  // ponytail: a nonce CSP lets the inline style and script operate. A stricter CSP header from the site can stop the page.
  // Upgrade: send the script and the style from their own routes with `'self'`.
  const nonce = crypto.randomUUID();
  return new Response(page(nonce, env.DASH_DEMO == "1"), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      // same-origin, not no-referrer: the comment above login() gives the cause (Astro CSRF 403).
      "Referrer-Policy": "same-origin",
    },
  });
};

export const dashRoutes = { "GET /api/t/health": health, "GET /api/t/dash": dash, "POST /api/t/dash/login": signin, "GET /api/t/dash/data": data };

// The client script puts each data value into the DOM with textContent or setAttribute. It does not use innerHTML.
// A string keeps bundle helpers out of the client script.
export const CLIENT = `(() => {
  const $ = (tag, parent, text) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = String(text);
    parent?.append(e);
    return e;
  };
  const svg = (tag, attrs, parent) => {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent?.append(e);
    return e;
  };
  // null gives "-". The function multiplies by m only a number.
  const fmt = (n, d = 0, m = 1) => (n == null || n === "" || isNaN(n) ? "-" : (Number(n) * m).toLocaleString(undefined, { maximumFractionDigits: d }));
  const main = document.getElementById("main"), site = document.getElementById("site"), days = document.getElementById("days");
  let loadId = 0;
  const get = (kind) => fetch(\`/api/t/dash/data?kind=\${kind}&days=\${days.value}&site=\${encodeURIComponent(site.value)}\`).then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))));
  const section = (title, wide = false) => {
    const s = $("section", main);
    if (wide) s.className = "wide";
    $("h2", s, title);
    return s;
  };
  // One horizontal bar for each row: the name, an SVG bar, the value and an optional note.
  const bars = (title, list, label, value = (r) => r.n, note) => {
    const s = section(title);
    if (!list.length) return $("p", s, "No reports in this range.").className = "empty";
    const max = Math.max(...list.map((r) => Number(value(r)))) || 1;
    for (const r of list) {
      const row = $("div", s);
      row.className = "bar";
      $("span", row, label(r)).title = label(r);
      const g = svg("svg", { viewBox: "0 0 100 10", preserveAspectRatio: "none", "aria-hidden": "true" }, row);
      svg("rect", { width: (100 * Number(value(r))) / max, height: 10, rx: 1 }, g);
      $("b", row, fmt(value(r)) + (note ? " " + note(r) : ""));
    }
  };
  const columns = (title, list) => {
    const s = section(title, true);
    if (!list.length) return $("p", s, "No pageviews in this range.").className = "empty";
    if (list.length == 1) {
      $("strong", s, fmt(list[0].n) + " pageviews").className = "single-value";
      $("p", s, String(list[0].k).slice(0, 10) + " · One day has data. Select a longer range to see a trend.").className = "dim";
      return;
    }
    const max = Math.max(...list.map((r) => Number(r.n))) || 1, w = 100 / list.length;
    const g = svg("svg", { viewBox: "0 0 100 40", preserveAspectRatio: "none", class: "cols", role: "img" }, s);
    list.forEach((r, i) => {
      const h = (40 * Number(r.n)) / max;
      svg("title", {}, svg("rect", { x: i * w + w * 0.1, y: 40 - h, width: w * 0.8, height: h }, g)).textContent = \`\${String(r.k).slice(0, 10)}: \${fmt(r.n)}\`;
    });
    $("p", s, \`\${String(list[0].k).slice(0, 10)} to \${String(list.at(-1).k).slice(0, 10)}\`).className = "dim";
  };
  const tiles = (title, pairs) => {
    const s = section(title, true), box = $("div", s);
    box.className = "tiles";
    for (const [k, v] of pairs) {
      const t = $("div", box);
      $("small", t, k);
      $("strong", t, v);
    }
  };
  const withUnit = (n, unit, d = 0, m = 1) => { const value = fmt(n, d, m); return value == "-" ? value : value + unit; };
  const devices = { s: "Phone", m: "Tablet", l: "Desktop" };
  const load = async () => {
    const id = ++loadId;
    main.replaceChildren($("p", null, "Loading..."));
    try {
      const [pv, cwv, clk, err, out] = await Promise.all(["pv", "cwv", "clk", "err", "out"].map(get));
      if (id != loadId) return;
      main.replaceChildren();
      const t = pv.totals;
      tiles("At a glance", [["Pageviews", fmt(t.pageviews)], ["Visits", fmt(t.visits)], ["Quick exits", fmt(t.quick_exits)], ["Average scroll", withUnit(t.avg_scroll, " %", 0, 10)], ["Average dwell", withUnit(t.avg_dwell, " s")]]);
      if (!Number(t.pageviews) && !clk.rows.length && !err.rows.length && !out.rows.length) {
        const s = section("No measurements yet", true);
        $("p", s, "Try another site or date range. Privacy and country rules can also stop collection.").className = "empty";
        return;
      }
      columns("Pageviews by day", pv.daily);
      for (const [title, key] of [["Top pages", "paths"], ["Referrers", "referrers"], ["Countries", "countries"], ["Browsers", "browsers"], ["Operating systems", "os"], ["Devices", "devices"]]) bars(title, pv[key], (r) => key == "devices" ? (devices[r.k] || r.k) : r.k);
      bars("Scroll depth (pageviews by maximum depth)", pv.scroll, (r) => fmt(r.k * 10) + " %");
      tiles("Core Web Vitals · measured rows only", [["LCP average", withUnit(cwv.lcp.avg, " ms")], ["CLS average", fmt(cwv.cls.avg, 3, 1e-3)]]);
      bars("Clicks by element", clk.rows, (r) => \`\${r.path} \${r.el}\`, (r) => r.clicks, (r) => \`(rage \${fmt(r.rage)}, dead \${fmt(r.dead)})\`);
      bars("Errors", err.rows, (r) => \`\${r.class} \${r.script}:\${r.line}\`);
      bars("Outbound links and downloads", out.rows, (r) => \`\${r.kind == "dl" ? "." : ""}\${r.target}\`);
    } catch (e) {
      if (id != loadId) return;
      main.replaceChildren($("p", null, "Cannot load the data: " + e.message));
    }
  };
  days.onchange = site.onchange = load;
  get("sites")
    .then((d) => d.sites.map((r) => r.site))
    .catch(() => [])
    .then((list) => {
      for (const s of list.length ? list : [location.hostname.replace(/^www\\./, "")]) $("option", site, s).value = s;
      load();
    });
})();`;

const LOGIN = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>edgeglint</title></head>
<body><h1>edgeglint</h1><form method="post" action="/api/t/dash/login"><label>Key <input type="password" name="key" autocomplete="current-password" required></label> <button>Open</button></form></body></html>`;

// The version and the SHA come from src/version.js, which scripts/build.js writes. They are not data from the dataset.
const page = (nonce, demo) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Overview · edgeglint</title>
<style nonce="${nonce}">
:root{color-scheme:dark;--bg:#181818;--fg:#fff;--dim:#9b9b9b;--line:#313131;--bar:#7aa2f7;--card:#1f1f1f;--tile:#272727}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,sans-serif;font-variant-numeric:tabular-nums}
header,main,footer{max-width:1200px;margin:0 auto;padding-left:24px;padding-right:24px}
header{padding-top:32px;padding-bottom:32px;display:flex;align-items:end;justify-content:space-between;gap:24px;border-bottom:1px solid var(--line)}
.brand{font-size:14px;font-weight:700;letter-spacing:-.02em}.brand i{color:var(--bar);font-style:normal}
h1{font-size:30px;line-height:36px;letter-spacing:-.03em;margin:24px 0 4px}header p{margin:0;color:var(--dim)}
.controls{display:flex;gap:12px;align-items:end}.controls label{display:grid;gap:4px;color:var(--dim);font-size:12px}
select{font:500 14px system-ui,sans-serif;padding:8px 12px;min-width:96px;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:8px}
select:focus-visible{outline:2px solid var(--bar);outline-offset:2px}.demo{display:inline-block;margin-left:12px;padding:2px 8px;border:1px solid var(--line);border-radius:4px;color:var(--dim);font-size:12px;font-weight:500;vertical-align:middle}
main{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;padding-top:24px;padding-bottom:48px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px;min-width:0}.wide{grid-column:1/-1}
h2{font-size:18px;line-height:28px;letter-spacing:-.01em;margin:0 0 16px}
.bar{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,2fr) auto;gap:12px;align-items:center;min-height:32px;border-top:1px solid var(--line)}
.bar span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bar svg{width:100%;height:8px;background:var(--tile);border-radius:4px}.bar rect{fill:var(--bar)}.bar b{font-weight:600}
.cols{width:100%;height:160px}.cols rect{fill:var(--bar)}.dim,.empty,footer{color:var(--dim)}.empty{margin:0}.single-value{display:block;font-size:24px;margin:8px 0}
.tiles{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.tiles div{background:var(--tile);padding:16px;border-radius:8px;min-width:0}
.tiles small{display:block;color:var(--dim);font-size:12px}.tiles strong{display:block;margin-top:8px;font-size:24px;line-height:32px;letter-spacing:-.02em}
footer{padding-top:0;padding-bottom:32px;font-size:12px}
@media(max-width:720px){header{display:block;padding:24px 16px}.controls{margin-top:24px}.controls label{flex:1}select{width:100%}main{display:block;padding:16px}.wide{grid-column:auto}section{margin-bottom:16px;padding:16px}.tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.bar{grid-template-columns:minmax(0,1fr) 80px auto}footer{padding:0 16px 24px}}
</style></head><body>
<header><div><div class="brand">edgeglint<i>●</i>${demo ? '<span class="demo">Demo data</span>' : ''}</div><h1>Site overview</h1><p>Page activity, engagement, and quality in one view.</p></div>
<div class="controls"><label>Site<select id="site"></select></label>
<label>Last days<select id="days"><option>1</option><option selected>7</option><option>30</option><option>90</option></select></label></div></header>
<main id="main" aria-live="polite"></main>
<footer>edgeglint v${VERSION.version} ${VERSION.sha}</footer>
<script nonce="${nonce}">${CLIENT}</script>
</body></html>`;
