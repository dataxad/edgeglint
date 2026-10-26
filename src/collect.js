// edgeglint collector: the POST handler, the tracker handler and the router.
// COLLECT="off" stops the service quickly: the tracker script is empty and the collector writes nothing.
// The collector always sends 204 to a beacon. A 4xx status can cause too many retries.
import TRACKER from "./tracker.built.js";
import { pathOk, hostOk, domainOf, siteOf, siteAllowed, routeMatch, isProbe, probeKey, readBody, PROBE, ERRS, DL, TAGS } from "./rules.js";
import { dashRoutes } from "./dashboard.js";

const BOT = /bot|crawl|spider|headless|lighthouse|preview|fetch/i;
// Geo gate, fail-closed. The collector drops a beacon when the country is missing or is not 2 capital letters.
// It also drops XX (unknown), T1 (Tor), the 27 EU countries, IS, LI, NO, GB and CH.
// It also drops the areas that have their own country code but use EU or UK rules: GF to PM (France), AX, GI, GG, JE and IM.
const EXCLUDE = new Set("XX T1 AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH GF GP MQ RE YT MF BL PM AX GI GG JE IM".split(" "));
// Keep this sequence. An Edge or Opera User-Agent also has `Chrome` in it. An iOS User-Agent has `Mac OS X`. An Android User-Agent has `Linux`.
const BROWSERS = [["Edge", /Edg\w*\/(\d+)/], ["Opera", /OPR\/(\d+)/], ["Firefox", /(?:Firefox|FxiOS)\/(\d+)/], ["Chrome", /(?:Chrome|CriOS)\/(\d+)/], ["Safari", /Version\/(\d+).*Safari/]];
const SYSTEMS = [["iOS", /(?:iPhone|iPad|iPod).*? OS (\d+)/], ["Android", /Android (\d+)/], ["macOS", /Mac OS X/], ["Windows", /Windows/], ["Linux", /Linux/]];

const int = (lo, hi) => (x) => Number.isInteger(x) && x >= lo && x <= hi;
const or = (...f) => (x) => f.some((g) => g(x));
const is = (...v) => (x) => v.includes(x);
const tuple = (...f) => (x) => Array.isArray(x) && x.length == f.length && f.every((g, i) => g(x[i]));
const list = (max, f) => (x) => Array.isArray(x) && x.length <= max && x.every(f);
// A step value must be a multiple of its step: 5 s for dwell, 100 ms for LCP and 10 for CLS x 1000.
const step = (s, hi) => (x) => int(0, hi)(x) && x % s == 0;
const count = int(1, 1e4), line = int(0, 1e6), text = (max) => (x) => typeof x == "string" && x.length <= max;
// A script is "ext", "inline", or a normalized path that ends in .js, .mjs or .cjs.
const scriptOk = (x) => x == "ext" || x == "inline" || (typeof x == "string" && pathOk(x.match(/^(.*)\.[mc]?js$/)?.[1]));
// An element path has a maximum of 12 steps and 120 characters. Each step is a tag from TAGS or "other", with an optional :nth-child(1..999).
const elOk = (x) =>
  typeof x == "string" && x.length <= 120 && x.split(">").length <= 12 && x.split(">").every((s) => (s = s.match(/^([a-z0-9]+)(:nth-child\([1-9]\d{0,2}\))?$/)) && (s[1] == "other" || TAGS.includes(s[1])));
const clkOk = tuple(elOk, count, int(0, 1e4), int(0, 1e4));
const SCHEMA = {
  v: is(1),
  f: is(0, 1),
  // qb is the quick-exit flag. The tracker sets it only on the pagehide beacon.
  qb: is(0, 1),
  p: pathOk,
  // The collector applies the host rule to the referrer after the schema check. If the referrer does not obey the rule, it becomes "other".
  r: text(255),
  d: is("s", "m", "l"),
  sc: int(0, 10),
  dw: step(5, 86400),
  lcp: or(is(-1), step(100, 6e4)),
  cls: or(is(-1), step(10, 1e5)),
  // The rage count and the dead count are not more than the click count.
  clk: list(100, (x) => clkOk(x) && x[2] <= x[1] && x[3] <= x[1]),
  err: list(20, tuple(is(...ERRS, "Other"), scriptOk, line, line, count)),
  // If an `out` host does not obey the host rule or has an ID-like part, the collector drops that item. It does not drop the beacon.
  out: list(50, or(tuple(text(255), is("out"), count), tuple(is(...DL), is("dl"), count))),
};
const KEYS = Object.keys(SCHEMA);
export const valid = (b) =>
  !!b && typeof b == "object" && !Array.isArray(b) && Object.keys(b).length == KEYS.length && KEYS.every((k) => Object.hasOwn(b, k) && SCHEMA[k](b[k]));

// A version number has 1 to 3 digits. A longer digit run gives "other".
const pick = (ua, table) => {
  for (const [name, re] of table) {
    const m = ua.match(re);
    if (m) return !m[1] ? name : m[1].length <= 3 ? `${name} ${m[1]}` : "other";
  }
  return "other";
};
// The Astro dev server and Playwright give no request.cf. Only then does the CF-IPCountry header supply the country.
// In production, Cloudflare always gives request.cf. Without request.cf and without the header, the geo gate stops the request.
export const cfOf = (req, c = req.headers.get("cf-ipcountry")) => req.cf ?? (c ? { country: c } : undefined);
export const geoBlocked = (cf) => !/^[A-Z]{2}$/.test(cf?.country) || EXCLUDE.has(cf.country);
const optedOut = (h) => h.get("sec-gpc") == "1" || h.get("dnt") == "1" || /(^|;\s*)t=0(;|$)/.test(h.get("cookie") || "");
const empty = (headers) => new Response(null, { status: 204, headers });
const noStore = () => empty({ "Cache-Control": "no-store" });

// `routes` is the route list (see routeMatch in src/rules.js). env.ROUTES is the same list as a comma-separated string.
export async function collect(request, env, cf = cfOf(request), { routes = env.ROUTES } = {}) {
  try {
    const h = request.headers, ua = h.get("user-agent") || "";
    if (env.COLLECT == "off" || optedOut(h) || cf?.verifiedBotCategory || BOT.test(ua) || geoBlocked(cf)) return noStore();
    // The client IP goes only to the rate limiter as its key. The collector does not write or keep it.
    if (env.LIMITER && !(await env.LIMITER.limit({ key: h.get("cf-connecting-ip") || "" })).success) return noStore();
    // The collector reads a maximum of 16 KB of the body.
    const s = await readBody(request, 16384);
    if (s == null) return noStore();
    const b = JSON.parse(s);
    // If the site does not obey the host rule, the collector writes nothing. A host with `:<port>` does not obey the rule.
    // When SITES is set and the site is not in it, the collector also writes nothing.
    const site = siteOf(request);
    if (!valid(b) || !hostOk(site) || !siteAllowed(site, env.SITES)) return noStore();
    // A health check path becomes its probeKey path. With a route list, a different path that is not in the list becomes "/other".
    // A script path that is not in the list becomes "other".
    // Without a list, only normPath applies. normPath keeps lowercase words, for example a private word in a path.
    const ok = routeMatch(routes), p = isProbe(b.p) ? await probeKey(b.p.slice(PROBE.length)) : !ok || ok(b.p) ? b.p : "/other", js = (x) => (!ok || x == "ext" || x == "inline" || ok(x) ? x : "other");
    const own = b.r.replace(/^www\./, "") == site;
    const ref = !b.r ? "direct" : own ? "internal" : domainOf(b.r) || "other";
    // The raw User-Agent stays in this function. The function writes only the browser and OS names with their primary version numbers.
    // The Astro dev server can have no TELEMETRY binding. Then the collector writes nothing and sends 204. Thus a local canary test can read the beacon.
    const w = (blobs, doubles) => env.TELEMETRY?.writeDataPoint({ indexes: [site], blobs, doubles });
    // `f` is 1 on the first flush of a page load. Only that row counts as a pageview or a visit.
    // The quick-exit flag (double3) comes from `qb` on the pagehide flush.
    // Each row has the dwell time since the previous flush in 5 s steps (double4) and the maximum scroll step (double2).
    // LCP (double5) is in 100 ms steps. CLS x 1000 (double6) is in steps of 10.
    w(["pv", p, b.d, ref, cf.country, pick(ua, BROWSERS), pick(ua, SYSTEMS)], [b.f, b.sc, b.qb, b.dw, b.lcp, b.cls, b.f && !own ? 1 : 0]);
    // The schema lets a maximum of 100 `clk`, 20 `err` and 50 `out` rows. With the `pv` row, this is 171 writes.
    for (const [el, clicks, rage, dead] of b.clk) w(["clk", p, el], [clicks, rage, dead]);
    for (const [cls, script, ln, col, n] of b.err) w(["err", p, cls, js(script)], [ln, col, n]);
    for (const [target, kind, n] of b.out) {
      const t = kind == "dl" ? target : domainOf(target);
      if (t) w(["out", p, kind, t], [n]);
    }
  } catch {}
  return noStore();
}

// The tracker script has `no-store`. A cached copy of the active script must not go to a visitor in a country that the geo gate stops.
export const trackerResponse = (cf, env) =>
  new Response(env.COLLECT == "off" || geoBlocked(cf) ? "//" : TRACKER, { headers: { "Content-Type": "application/javascript", "Cache-Control": "no-store" } });

const notFound = () => new Response("Not found", { status: 404 });
const optOut = () => empty({ "Set-Cookie": "t=0; Max-Age=34214400; SameSite=Lax; Path=/", "Cache-Control": "no-store" });

// This table finds the handler from `METHOD path`.
export const routes = {
  "GET /api/t.js": (req, env) => trackerResponse(cfOf(req), env),
  "POST /api/t": (req, env, ctx, opts) => collect(req, env, cfOf(req), opts),
  "GET /api/t": (req) => (new URL(req.url).searchParams.get("optout") == "1" ? optOut() : notFound()),
  ...dashRoutes,
};

// `opts` goes to collect, for example `{ routes: ["/", "/blog/*"] }`.
export const handle = (request, env, ctx, opts) => (routes[`${request.method} ${new URL(request.url).pathname}`] || notFound)(request, env, ctx, opts);
