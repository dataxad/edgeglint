/* edgeglint tracker. This is a plain browser script with no dependencies. The build inlines src/rules.js.
 * The server validates each field again. Thus the client keeps its data in the schema limits.
 *
 * Do not read these properties: `innerText`, `textContent`, `innerHTML`, `outerHTML`, `nodeValue`, `value`, `id`, `className`,
 * `dataset`, `attributes`, `getAttribute`, `href`, `location.search`, `location.hash`, `localStorage`, `sessionStorage`.
 * The tracker reads `error.name`, and the `hostname` and `pathname` of an `a` element. These reads are permitted.
 * The test file `test/tracker.test.js` examines this file and `dist/tracker.js` for the names in the list.
 *
 * The test lets one `value` through: the number in a `layout-shift` entry. The browser makes this number, thus it is not page data.
 * The test also lets one `attributes` through: the key in the object that goes to `MutationObserver.observe`.
 *
 * `prev` holds the preceding scroll, LCP and CLS maxima. The collector uses it to correct the aggregate.
 * Each flush sends the changes since the last flush. `f` is 1 on the first flush of a page load and 0 after it.
 * `qb` is the quick-exit flag. The first pagehide flush with `persisted: false` sets it to 1 when the total foreground dwell since load is less than 5 s.
 * Each other flush sends `qb` 0.
 * Each count stops at 10000, the server maximum. CLS x 1000 stops at 100000, LCP at 60000 and dwell at 86400.
 * The tracker sends dwell in 5 s steps, LCP in 100 ms steps and CLS x 1000 in steps of 10.
 * Accurate values with the country, the device and the row time can identify a visitor. */
import { normPath, regDomain, ERRS, DL, TAGS } from "./rules.js";

(() => {
  const N = navigator, D = document, W = window, L = location, P = performance;
  const off = () => /(^|;\s*)t=0(;|$)/.test(D.cookie);
  if (N.globalPrivacyControl || N.doNotTrack == "1" || off()) return;
  const n = (o) => Object.keys(o).length, www = (h) => h.replace(/^www\./, ""), lim = (x) => Math.max(0, Math.min(x | 0, 1e6)), up = (a, i) => a[i] < 1e4 && a[i]++;
  const p = normPath(L.pathname), T = {}, obs = [], me = www(L.hostname);
  // Each waiting click and its timer.
  const pend = new Map();
  let prev, clk = {}, err = {}, out = {}, f = 1, q = 1, ms = 0, tot = 0, open = -1, r = "", sc = 0, lcp = -1, cls = -1, win = 0, wEnd = -1e9, wStart = 0, mut = 0;
  // The tracker sends the registrable domain (regDomain) of a different host, and this site host without "www.". The server applies its rules again.
  const dom = (h) => (www(h) == me ? me : regDomain(h));
  // `document.referrer` is empty or a full URL, thus `new URL` does not throw an error.
  if (D.referrer) r = dom(new URL(D.referrer).hostname) || "other";
  // Dwell time counts only the time in the foreground.
  const start = () => { if (open < 0 && D.visibilityState == "visible") open = P.now(); };
  const stop = () => { if (open >= 0) ms += P.now() - open, tot += P.now() - open; open = -1; };
  start();
  const scroll = () => { sc = Math.max(sc, Math.min(10, Math.round((W.scrollY + W.innerHeight) / D.documentElement.scrollHeight * 10) || 0)); };
  scroll();
  W.addEventListener("scroll", scroll);
  new MutationObserver(() => mut++).observe(D, { childList: true, subtree: true, characterData: true, attributes: true });
  const ob = (type, h) => {
    try {
      if (PerformanceObserver.supportedEntryTypes.includes(type)) {
        const o = new PerformanceObserver((l) => l.getEntries().forEach(h));
        o.observe({ type, buffered: true });
        return obs.push([o, h]);
      }
    } catch {}
  };
  ob("largest-contentful-paint", (e) => { lcp = Math.min(6e4, Math.round(e.startTime / 100) * 100); });
  if (ob("layout-shift", (e) => {
    if (e.hadRecentInput) return;
    if (e.startTime - wEnd > 1e3 || e.startTime - wStart > 5e3) { win = 0; wStart = e.startTime; }
    win += e.value; wEnd = e.startTime;
    cls = Math.min(1e5, Math.max(cls, Math.round(win * 100) * 10));
  })) cls = 0;
  // The element path has only permitted tag names and `:nth-child(n)`. It starts at the target and goes to `body`.
  // It has a maximum of 12 steps and 120 characters.
  const path = (el) => {
    let s = "", k = 0;
    for (; el && el.parentElement && el != D.body && k < 12; el = el.parentElement, k++) {
      const i = [].indexOf.call(el.parentElement.children, el) + 1, t = el.tagName.toLowerCase();
      const step = (TAGS.includes(t) ? t : "other") + (i < 1e3 ? `:nth-child(${i})` : "");
      const next = s ? step + ">" + s : step;
      if (next.length > 120) break;
      s = next;
    }
    return s;
  };
  // The argument is [path, rage, dead]. Each rage and dead value is 0 or 1.
  const add = ([s, g, d]) => { if (clk[s] || n(clk) < 50) { const c = (clk[s] ||= [s, 0, 0, 0]); if (c[1] < 1e4) c[1]++, c[2] += g, c[3] += d; } };
  D.addEventListener("click", (e) => {
    const el = e.target.nodeType == 1 ? e.target : e.target.parentElement;
    const s = path(el), m = mut;
    if (!s) return;
    const a = el.closest("a"), q = (T[s] ||= []);
    // A rage click is the third click on one path in 1 s.
    if (q.push(P.now()) > 3) q.shift();
    const z = [s, +(q[2] - q[0] < 1e3), 0];
    // A dead click has no DOM change in 1 s. A click on an `a` element is not a dead click.
    // The tracker adds a click that is not an `a` click after 1 s, with its dead count. A flush in that 1 s adds the click as not dead.
    if (!a) return pend.set(z, setTimeout(() => pend.delete(z) && ((z[2] = +(m == mut)), add(z)), 1e3));
    add(z);
    // An `a` element to a different host counts as "out". An `a` element to this site counts as "dl" when its path ends in a known file extension.
    // An SVG `a` element has no string hostname. The tracker ignores it.
    if (typeof a.hostname != "string" || typeof a.pathname != "string") return;
    let h = a.hostname, x = a.pathname.toLowerCase().split(".").pop(), k = www(h) != me ? "out" : "dl", t = k == "out" ? (h = dom(h)).length < 81 && h : DL.includes(x) && x;
    if (t && (out[k + t] || n(out) < 30)) up(out[k + t] ||= [t, k, 0], 2);
  }, { capture: true });
  W.addEventListener("error", (e) => {
    const x = e.error?.name, c = ERRS.includes(x) ? x : "Other";
    let s = "ext";
    try {
      const u = new URL(e.filename), m = u.pathname.match(/^(.*)(\.[mc]?js)$/);
      if (u.origin == L.origin) s = m ? normPath(m[1]) + m[2] : "inline";
    } catch {}
    const key = [c, s, lim(e.lineno), lim(e.colno)];
    if (err[key] || n(err) < 20) up(err[key] ||= [...key, 0], 4);
  });
  // Each flush adds each waiting click as a click that is not dead and stops its timer.
  // Thus the tracker makes the dead decision only for a 1 s window that ends while the page is in the foreground.
  const flush = (end) => {
    stop();
    pend.forEach((t, z) => (clearTimeout(t), add(z)));
    pend.clear();
    // Only the first pagehide flush sets the quick-exit flag.
    const qb = end && q && tot < 5e3 ? 1 : 0;
    if (end) q = 0;
    if (off()) return;
    obs.forEach(([o, h]) => o.takeRecords().forEach(h));
    const w = W.innerWidth, V = Object.values, c = V(clk);
    // The remainder goes into the next flush. Thus the sum of the dwell values stays near the correct time.
    const dw = Math.min(86400, Math.round(ms / 5e3) * 5), cur = [sc, lcp, cls];
    if (!f && !qb && !dw && !c.length && !n(err) && !n(out) && cur.every((x, i) => x == prev[i])) return;
    // ponytail: the client keeps at most 50 `clk`, 20 `err` and 30 `out` items, thus the body stays below the 16 KB server limit:
    // 50 x 145 + 20 x 251 + 30 x 100 + 300 = 15570 bytes. Upgrade: remove `clk` items until the body is 16 KB or less.
    const body = JSON.stringify({ v: 1, f, qb, prev, p, r, d: w < 600 ? "s" : w < 1024 ? "m" : "l", sc, dw, lcp, cls, clk: c, err: V(err), out: V(out) });
    prev = cur; ms -= dw * 1e3; f = 0; clk = {}; err = {}; out = {};
    const url = L.origin + "/api/t";
    if (!N.sendBeacon?.(url, body)) fetch(url, { method: "POST", body, keepalive: true, credentials: "omit" });
  };
  // After a pagehide with `persisted: true`, the page can come back from the back/forward cache, thus the flush sends qb 0. Thus the quick-exit count can be too low.
  W.addEventListener("pagehide", (e) => flush(!e?.persisted));
  // A page from the back/forward cache continues the same page load. On the first pageshow, `start` does nothing.
  W.addEventListener("pageshow", start);
  D.addEventListener("visibilitychange", () => (D.visibilityState == "hidden" ? flush() : start()));
})();
