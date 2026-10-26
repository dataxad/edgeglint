// Allowlist rules for the tracker and the collector. The tracker build inlines the parts that the tracker uses.
// The collector runs the same rules again, because the server is authoritative.

// A segment stays when it is a short lowercase word and is not ID-like. Its first letter can be a capital.
// The function makes the segment lowercase first and then tests it. Thus the test sees the same text on each run.
// A segment becomes ":x" when it has one of these items:
// - a capital letter after the first letter, for example "SecretToken";
// - a hex run of 8 or more (a UUID has one), or a digit run of 5 or more;
// - 3 or more digit runs, or more than 20 characters with no "-";
// - a character that is not a-z, 0-9 or "-", for example "@".
// Numbers of 1 to 4 digits stay, for example /2024/06/12/slug.
// The result has a maximum of 8 segments and 200 characters, else it is "/:long".
// ponytail: a lowercase token of 20 letters or less stays, because the rule cannot tell it from a word. Upgrade: a route list (ROUTES, see routeMatch).
// The function gives the same result when it runs again on its result.
const SEG = /^(?!.*\d{5}|.*[0-9a-f]{8}|.*\d\D+\d\D+\d|[^-]{21,}$)[a-z0-9][a-z0-9-]{0,39}$|^:(x|long)$/;
export const normPath = (p) => {
  const s = "/" + p.split("/").filter(Boolean).slice(0, 8).map((x) => (/[A-Z]/.test(x.slice(1)) || !SEG.test((x = x.toLowerCase())) ? ":x" : x)).join("/");
  return s.length > 200 ? "/:long" : s;
};
export const pathOk = (x) => typeof x == "string" && x.length <= 200 && normPath(x) == x;

// The health check path is "/edgeglint-probe/<token>". The token has 6 to 32 characters, each a-z or 0-9.
// The collector keeps a page path that obeys this rule, also when the path is not in the route list. It writes the probeKey path. This rule is not for a script path.
export const PROBE = "/edgeglint-probe/";
export const isProbe = (p) => /^\/edgeglint-probe\/[a-z0-9]{6,32}$/.test(p);
// The stored health check path has the first 12 hex characters of SHA-256(token), not the token. Thus a name that is a token does not go into the data.
export const probeKey = async (token) => PROBE + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
// The function reads the body in parts and gives the text. It gives null after `max` bytes, thus a large body does not go into memory.
export const readBody = async (request, max) => {
  let s = "", size = 0;
  const dec = new TextDecoder();
  for await (const c of request.body || []) {
    if ((size += c.byteLength) > max) return null;
    s += dec.decode(c, { stream: true });
  }
  return s + dec.decode();
};
// The route list is an array or a comma-separated string. An entry is a full path ("/about") or a prefix pattern ("/blog/*").
// The pattern "/blog/*" agrees with "/blog/" and each path below it, but not with "/blog" itself.
// The function gives null when there is no list. Else it gives a function that tells if a path is in the list.
export const routeMatch = (routes) => {
  const l = (typeof routes == "string" ? routes.split(",") : routes || []).map((r) => r.trim()).filter(Boolean);
  return l.length ? (p) => l.some((r) => (r.endsWith("/*") ? p.startsWith(r.slice(0, -1)) : p == r)) : null;
};

// The host rule: a registrable-domain shape with 2 or more parts and a maximum of 80 characters.
// No part has only digits, thus the rule rejects an IPv4 address. The last part has 2 to 24 letters.
// Each part has only a-z, 0-9 and "-". Thus the rule rejects an IPv6 address, userinfo and `:<port>`.
export const hostOk = (h) => /^(?=.{1,80}$)((?!\d+\.)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(h);
// Usually, the registrable domain is the last 2 parts.
// It is 3 parts when SLD has the part before the last and the last part has 2 characters.
// An example is bbc.co.uk.
// Then the function removes "www.".
// ponytail: a short list, not the Public Suffix List. Upgrade: a copy of the Public Suffix List.
const SLD = /* @__PURE__ */ "co com net org gov edu ac or ne go sch nhs police ltd plc me biz info".split(" ");
export const regDomain = (h) => {
  const l = h.split("."), n = l.length > 2 && SLD.includes(l.at(-2)) && l.at(-1).length == 2 ? 3 : 2;
  return l.slice(-n).join(".").replace(/^www\.(?=.+\..)/, "");
};
// The function gives the registrable domain when the host obeys the host rule and each part of the domain obeys the segment rule (SEG).
// Else it gives "". Thus an ID-like part, for example a UUID, does not go into the data.
export const domainOf = (h) => {
  const d = hostOk(h) ? regDomain(h) : "";
  return d.split(".").every((x) => SEG.test(x)) ? d : "";
};
// The site is the request host in lowercase, without "www.". The function keeps a ":<port>" part. Thus the host rule rejects that host.
export const siteOf = (request) => (request.headers.get("host") || new URL(request.url).host).toLowerCase().replace(/^www\./, "");
// SITES is a comma-separated list of host names. When it is set, the site must be in it.
export const siteAllowed = (site, sites) => !sites || sites.split(",").map((s) => s.trim().toLowerCase()).includes(site);

// An error class that is not in this list becomes "Other".
export const ERRS = /* @__PURE__ */ "Error TypeError ReferenceError SyntaxError RangeError URIError EvalError AggregateError DOMException AbortError NetworkError SecurityError NotAllowedError QuotaExceededError InvalidStateError TimeoutError ChunkLoadError".split(" ");
export const DL = /* @__PURE__ */ "pdf zip csv xlsx docx apk dmg exe mp4 mp3".split(" ");
// ponytail: 63 frequent tags, not the full HTML list of about 115 names. Each different tag becomes "other".
// Upgrade: add tags from the HTML living standard when the 3072-byte limit lets it.
export const TAGS = /* @__PURE__ */ "a abbr article aside audio b blockquote body br button canvas code dd details dialog div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr i iframe img input label legend li main nav ol option p picture pre section select small span strong summary svg table tbody td textarea tfoot th thead tr ul video".split(" ");
