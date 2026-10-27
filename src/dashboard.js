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
  const $ = (tag, parent, text, cls) => {
    const e = document.createElement(tag);
    if (text != null) e.textContent = String(text);
    if (cls) e.className = cls;
    parent?.append(e);
    return e;
  };
  const svg = (tag, attrs, parent) => {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent?.append(e);
    return e;
  };
  const fmt = (n, d = 0, m = 1) => n == null || n === "" || isNaN(n) ? "-" : (Number(n) * m).toLocaleString(undefined, { maximumFractionDigits: d });
  const main = document.getElementById("main"), site = document.getElementById("site"), days = document.getElementById("days");
  let loadId = 0;
  const get = (kind) => fetch(\`/api/t/dash/data?kind=\${kind}&days=\${days.value}&site=\${encodeURIComponent(site.value)}\`).then((r) => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)));
  const card = (title, cls = "") => {
    const s = $("section", main, null, "card " + cls);
    $("h2", s, title);
    return s;
  };
  let tipId = 0;
  const tip = (parent, detail) => {
    parent.tabIndex = 0;
    const e = $("span", parent, detail, "tip");
    e.id = "tip-" + ++tipId;
    parent.setAttribute("aria-describedby", e.id);
  };
  const metric = (parent, name, value, detail) => {
    const e = $("div", parent, null, "metric");
    $("small", e, name);
    $("strong", e, value);
    tip(e, detail);
  };
  const rows = (parent, list, label, value = (r) => r.n, limit = 3, detail) => {
    if (!list.length) return $("p", parent, "No reports in this range.", "empty");
    const max = Math.max(1, ...list.map((r) => Number(value(r)) || 0));
    for (const r of list.slice(0, limit)) {
      const e = $("div", parent, null, "rank");
      $("span", e, label(r), "rank-label");
      const track = $("span", e, null, "track");
      const fill = $("span", track, null, "fill");
      fill.style.width = Math.max(2, 100 * (Number(value(r)) || 0) / max) + "%";
      $("b", e, fmt(value(r)));
      tip(e, detail ? detail(r) : \`\${label(r)}: \${fmt(value(r))}\`);
    }
    if (list.length > limit) {
      const more = $("button", parent, \`+\${list.length - limit} more\`, "more");
      more.type = "button";
      tip(more, list.slice(limit).map((r) => detail ? detail(r) : \`\${label(r)}: \${fmt(value(r))}\`).join(" · "));
    }
  };
  const group = (parent, title, list, label, limit = 3, value, detail) => {
    const e = $("div", parent, null, "group");
    $("h3", e, title);
    rows(e, list, label, value, limit, detail);
  };
  const trend = (parent, list) => {
    if (!list.length) return $("p", parent, "No pageviews in this range.", "empty");
    const total = list.reduce((n, r) => n + Number(r.n || 0), 0);
    $("strong", parent, fmt(total), "trend-total");
    $("span", parent, " pageviews in selected days", "trend-caption");
    if (list.length == 1) return $("p", parent, \`\${String(list[0].k).slice(0, 10)} · Select more days to see a trend.\`, "empty");
    const width = 620, height = 130, pad = 10;
    const max = Math.max(1, ...list.map((r) => Number(r.n) || 0));
    const pts = list.map((r, i) => [pad + i * (width - pad * 2) / (list.length - 1), height - pad - (Number(r.n) || 0) / max * (height - pad * 2)]);
    const plot = $("div", parent, null, "trend-plot");
    const g = svg("svg", { viewBox: \`0 0 \${width} \${height}\`, class: "trend", preserveAspectRatio: "none", role: "img", "aria-label": \`Pageviews by day from \${String(list[0].k).slice(0, 10)} to \${String(list.at(-1).k).slice(0, 10)}\` }, plot);
    svg("line", { x1: pad, y1: height - pad, x2: width - pad, y2: height - pad, class: "axis" }, g);
    svg("polygon", { points: \`\${pad},\${height - pad} \${pts.map((p) => p.join(",")).join(" ")} \${width - pad},\${height - pad}\`, class: "area" }, g);
    svg("polyline", { points: pts.map((p) => p.join(",")).join(" "), class: "line" }, g);
    const marks = $("div", plot, null, "trend-marks");
    list.forEach((r, i) => {
      const e = $("button", marks, null, "mark");
      e.type = "button";
      e.style.left = \`\${pts[i][0] / width * 100}%\`;
      e.style.top = \`\${pts[i][1] / height * 100}%\`;
      const detail = \`\${String(r.k).slice(0, 10)}: \${fmt(r.n)} pageviews\`;
      e.setAttribute("aria-label", detail);
      tip(e, detail);
    });
    const axis = $("div", parent, null, "trend-axis");
    $("span", axis, String(list[0].k).slice(0, 10));
    $("span", axis, String(list.at(-1).k).slice(0, 10));
  };
  const devices = { s: "<600 px", m: "600–1023 px", l: "≥1024 px" };
  const load = async () => {
    const id = ++loadId;
    main.replaceChildren($("p", null, "Loading…"));
    try {
      const [pv, cwv, clk, err, out] = await Promise.all(["pv", "cwv", "clk", "err", "out"].map(get));
      if (id != loadId) return;
      main.replaceChildren();
      const t = pv.totals;
      const kpis = $("div", main, null, "kpis");
      metric(kpis, "Pageviews", fmt(t.pageviews), "Pageviews count each page load once.");
      metric(kpis, "Visits", fmt(t.visits), "Visits counted by the first pageview flush.");
      metric(kpis, "Quick exits", fmt(t.quick_exits), "Visits that left quickly.");
      metric(kpis, "Avg scroll", t.avg_scroll == null ? "-" : fmt(t.avg_scroll, 0, 10) + "%", "Average maximum scroll depth on measured pageviews.");
      metric(kpis, "Avg dwell", t.avg_dwell == null ? "-" : fmt(t.avg_dwell) + "s", "Average time spent on a pageview.");
      if (!Number(t.pageviews) && !clk.rows.length && !err.rows.length && !out.rows.length) {
        const s = card("No measurements yet", "wide");
        $("p", s, "Try another site or date range. Privacy and country rules can also stop collection.", "empty");
        return;
      }
      const activity = card("Activity", "activity");
      trend(activity, pv.daily);
      const content = card("Content & sources", "content");
      group(content, "Top pages", pv.paths, (r) => r.k, 2);
      group(content, "Referrers", pv.referrers, (r) => r.k, 2);
      const audience = card("Audience mix", "audience");
      group(audience, "Countries", pv.countries, (r) => r.k);
      group(audience, "Browsers", pv.browsers, (r) => r.k);
      group(audience, "Operating systems", pv.os, (r) => r.k);
      group(audience, "Viewport width", pv.devices, (r) => devices[r.k] || r.k);
      const engagement = card("Engagement", "engagement");
      group(engagement, "Scroll depth", pv.scroll, (r) => fmt(r.k * 10) + "%", 4, (r) => r.n, (r) => \`\${fmt(r.k * 10)}% depth: \${fmt(r.n)} pageviews\`);
      group(engagement, "Clicks by element", clk.rows, (r) => r.path + " " + r.el, 3, (r) => r.clicks, (r) => \`\${r.path} \${r.el}: \${fmt(r.clicks)} clicks, \${fmt(r.rage)} rage, \${fmt(r.dead)} dead\`);
      const quality = card("Quality & exits", "quality");
      const vitals = $("div", quality, null, "vitals");
      metric(vitals, "LCP average", cwv.lcp.avg == null ? "-" : fmt(cwv.lcp.avg) + "ms", \`Average of \${fmt(cwv.lcp.n)} measured LCP rows.\`);
      metric(vitals, "CLS average", cwv.cls.avg == null ? "-" : fmt(cwv.cls.avg, 3, 1e-3), \`Average of \${fmt(cwv.cls.n)} measured CLS rows.\`);
      group(quality, "Errors", err.rows, (r) => r.class + " " + r.script + ":" + r.line);
      group(quality, "Outbound & downloads", out.rows, (r) => \`\${r.kind == "dl" ? "." : ""}\${r.target}\`);
    } catch (e) {
      if (id != loadId) return;
      main.replaceChildren($("p", null, "Cannot load the data: " + e.message));
    }
  };
  days.onchange = site.onchange = load;
  get("sites").then((d) => d.sites.map((r) => r.site)).catch(() => []).then((list) => {
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
:root{color-scheme:dark;--bg:#121721;--fg:#edf4ff;--dim:#9aaac1;--line:#2a3850;--blue:#62a9ff;--mint:#53dcc4;--card:#1b2637;--tile:#223149}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% -10%,#213d61 0%,transparent 35%),var(--bg);color:var(--fg);font:13px/1.4 system-ui,sans-serif;font-variant-numeric:tabular-nums}
header,main,footer{max-width:1440px;margin:0 auto;padding-left:24px;padding-right:24px}
header{min-height:86px;display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line)}
.brand{font-size:13px;font-weight:750;letter-spacing:.04em;text-transform:uppercase}.brand i{color:var(--mint);font-style:normal;margin-left:4px}
h1{font-size:23px;line-height:1.1;letter-spacing:-.03em;margin:4px 0 0}header p{margin:0;color:var(--dim);font-size:12px}
.controls{display:flex;gap:12px}.controls label{display:grid;gap:3px;color:var(--dim);font-size:11px}
select{font:500 13px system-ui,sans-serif;padding:6px 10px;min-width:100px;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:7px}
select:focus-visible,.metric:focus-visible,.rank:focus-visible,.mark:focus-visible{outline:2px solid var(--mint);outline-offset:2px}
.demo{display:inline-block;margin-left:10px;padding:1px 7px;border:1px solid var(--line);border-radius:4px;color:var(--dim);font-size:11px;font-weight:500;vertical-align:middle;text-transform:none;letter-spacing:0}
main{display:grid;grid-template-columns:1.25fr 1fr 1fr;grid-template-rows:auto minmax(205px,1fr) minmax(340px,1.65fr);gap:12px;padding-top:14px;padding-bottom:10px;min-height:calc(100vh - 115px)}
.card,.kpis{background:rgba(27,38,55,.96);border:1px solid var(--line);border-radius:12px;min-width:0}
.card{padding:15px 17px;overflow:visible}.card h2{font-size:15px;line-height:1.2;letter-spacing:-.01em;margin:0 0 12px}
.kpis{grid-column:1/-1;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));padding:10px 0}
.metric{position:relative;min-width:0;padding:5px 16px;border-right:1px solid var(--line);cursor:help}.metric:last-child{border-right:0}.metric small{display:block;color:var(--dim);font-size:11px}.metric strong{display:block;font-size:24px;line-height:1.2;letter-spacing:-.03em;margin-top:2px}
.activity{grid-column:1/3}.content{grid-column:3}.audience,.engagement,.quality{min-height:0}
.group{min-width:0}.group h3{font-size:11px;color:var(--dim);font-weight:650;text-transform:uppercase;letter-spacing:.06em;margin:8px 0 4px}
.content .group{margin-top:4px}.content .rank{height:19px}.content .group h3{margin:3px 0 2px}.audience{display:grid;grid-template-columns:1fr 1fr;column-gap:14px;align-content:start}.audience h2{grid-column:1/-1}.audience .group{margin-top:0}
.rank{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 52px 38px;align-items:center;gap:6px;height:24px;cursor:help;border-radius:4px}.rank:hover,.rank:focus-visible{background:var(--tile)}
.rank-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.track{height:5px;border-radius:4px;background:#31435b;overflow:hidden}.fill{display:block;height:100%;background:linear-gradient(90deg,var(--blue),var(--mint));border-radius:4px}.rank b{font-size:11px;text-align:right;font-weight:600}.more{display:block;position:relative;border:0;background:none;color:var(--mint);font:inherit;font-size:10px;margin-top:2px;padding:0;cursor:help}.more:hover .tip,.more:focus-visible .tip{display:block}
.trend-total{font-size:26px;line-height:1;letter-spacing:-.04em}.trend-caption{color:var(--dim);font-size:11px}.trend-plot{position:relative;height:110px}.trend{display:block;width:100%;height:104px;margin-top:6px;overflow:visible}.trend .axis{stroke:var(--line);stroke-width:1}.trend .area{fill:#2d70a7;opacity:.25}.trend .line{fill:none;stroke:var(--mint);stroke-width:3;stroke-linejoin:round;stroke-linecap:round}
.trend-marks{position:absolute;inset:0;height:104px;pointer-events:none}.mark{position:absolute;display:block;width:12px;height:12px;margin:-6px 0 0 -6px;border:2px solid var(--bg);border-radius:50%;background:var(--mint);padding:0;cursor:help;pointer-events:auto}.mark:hover,.mark:focus-visible{z-index:4;scale:1.25}
.trend-axis{display:flex;justify-content:space-between;color:var(--dim);font-size:10px;margin-top:-1px}
.vitals{display:grid;grid-template-columns:1fr 1fr;background:var(--tile);border-radius:7px;padding:5px 0}.vitals .metric{padding:3px 10px}.vitals .metric strong{font-size:17px}
.tip{display:none;position:absolute;z-index:10;left:50%;bottom:calc(100% + 8px);width:max-content;max-width:min(280px,80vw);padding:7px 9px;border:1px solid #597293;border-radius:6px;background:#0c1523;color:var(--fg);font-size:11px;font-weight:400;line-height:1.3;text-align:left;white-space:normal;overflow-wrap:anywhere;box-shadow:0 8px 24px #0008;transform:translateX(-50%);pointer-events:none}
.mark .tip{bottom:auto;top:calc(100% + 8px)}
.mark:first-child .tip{left:0;transform:none}.mark:last-child .tip{left:auto;right:0;transform:none}
.metric:hover .tip,.metric:focus-visible .tip,.rank:hover .tip,.rank:focus-visible .tip,.mark:hover .tip,.mark:focus-visible .tip{display:block}
.empty{color:var(--dim);margin:5px 0}.wide{grid-column:1/-1}footer{font-size:10px;color:var(--dim);padding-bottom:8px}
@media(min-width:900px) and (min-height:750px){main{height:calc(100vh - 115px);max-height:790px}}
@media(max-width:900px){main{grid-template-columns:1fr 1fr;grid-template-rows:auto;min-height:0}.kpis{grid-column:1/-1}.activity,.content{grid-column:auto}.audience{grid-column:1/-1}.quality{grid-column:1/-1}}
@media(max-width:600px){header{display:block;padding:16px}header p{display:none}.controls{margin-top:12px}.controls label{flex:1}select{width:100%}main{display:block;padding:12px 16px}.card,.kpis{margin-bottom:12px}.card{padding:14px}.kpis{grid-template-columns:repeat(2,1fr)}.metric:nth-child(2n){border-right:0}.kpis .metric{padding:7px 12px}.metric strong{font-size:20px}.audience{display:block}.trend-plot{height:106px}.trend{height:100px}.trend-marks{height:100px}footer{padding:0 16px 12px}}
</style></head><body>
<header><div><div class="brand">edgeglint<i>●</i>${demo ? '<span class="demo">Demo data</span>' : ''}</div><h1>Site overview</h1><p>Page activity, engagement, and quality in one view.</p></div>
<div class="controls"><label>Site<select id="site"></select></label>
<label>Last days<select id="days"><option>1</option><option selected>7</option><option>30</option><option>90</option></select></label></div></header>
<main id="main" aria-live="polite"></main>
<footer>edgeglint v${VERSION.version} ${VERSION.sha}</footer>
<script nonce="${nonce}">${CLIENT}</script>
</body></html>`;
