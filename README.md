# edgeglint

edgeglint gives privacy-aware analytics on Cloudflare, with no measurement cookies or identifiers.
It adds scroll depth, element click counts, JavaScript errors and Core Web Vitals. For specified country codes in the EEA, UK, Switzerland and related areas, the rule sends an empty tracker. It also drops reports from these requests. This rule does not show where consent is necessary.

Cloudflare Web Analytics has Core Web Vitals, but no scroll depth, element click counts or JavaScript errors.
See the [research and decisions](docs/research.md) for the sources, market table, legal analysis and deployment lessons.

## What it never collects

- IP addresses or raw User-Agent strings in the dataset.
- Measurement cookies, local storage or visitor identifiers.
- Pointer coordinates, cursor traces or session replay.
- Form contents, page text or query strings.
- Element IDs, CSS classes, attribute values or error messages.

The edge reads request information for country, bot checks, rate limits and browser versions. It does not keep the raw values.
A visitor-selected opt-out cookie and a dashboard authentication cookie have different purposes. These cookies do not identify visitors for measurement.

## How it works

- `GET /api/t.js` sends a tracker of at most 3,072 bytes gzip, with `Cache-Control: no-store`.
- The edge uses Cloudflare's request country code to send an empty script for the EEA, UK, Switzerland and related areas. It also sends no tracker for unknown country codes or Tor.
- The collector discards beacons from those regions. It sends 204 in each condition.
- The tracker sends delta beacons when the tab becomes hidden and at `pagehide`. Only the first beacon counts a pageview.
- Subsequent beacons contain new clicks, errors, outbound clicks, foreground dwell and maximum-value corrections. The back/forward cache continues the same page load.
- Allowlists check paths, referrer domains, error classes and element paths. Click paths use tag names and `nth-child` only.
- Analytics Engine keeps the rows. The dashboard reads them through `ANALYTICS_SQL`, with no API token.
- Global Privacy Control, Do Not Track and the opt-out cookie stop collection. `/api/t?optout=1` sets the opt-out cookie for 13 months.

A visit is a pageview with a referrer domain that is not the site. The project does not count unique visitors.
A quick exit means total foreground dwell less than 5 s, set at pagehide.
The [collector](src/collect.js), [tracker](src/tracker.js) and [rules](src/rules.js) give the fields and allowlists.

## Standalone Worker

Before the first deploy, start Workers Analytics Engine one time for the account.
In the Cloudflare dashboard, open Workers & Pages, then Analytics Engine, then select `Enable`.
No API token can do this step. Without it, deployment stops with "You need to enable Analytics Engine".

1. Run `npm install`. Use Node.js 22 or a subsequent version, and Wrangler 4.145.0 or a subsequent version.
2. Set the site route in `wrangler.jsonc`, for example `example.com/api/t*` in the `example.com` zone.
3. Set `SITES` and `ROUTES` in `vars`. See the configuration below.
4. Run `npm run deploy`.
5. Run `npx wrangler secret put DASH_KEY`.
6. Add `<script defer src="/api/t.js"></script>` to the site layout.

The setup commands are `npm install`, `npm run deploy` and `npx wrangler secret put DASH_KEY`.
The commands `npm run deploy` and `npm run dev` run the build first.
The build writes `src/tracker.built.js` and `src/version.js`; these files do not belong in the repository.

## Existing Worker, Astro and Pages

Run `npm run build` first. Copy the `src/` directory, with its build output, into the project as `edgeglint/`.
Add the bindings and variables from `wrangler.jsonc` to the host project's configuration.

For a Worker that you have, use `handle(request, env, ctx)` in its fetch handler:

```js
import { handle } from "./edgeglint/collect.js";
// In the fetch handler:
if (/^\/api\/t(\.js|\/|$)/.test(new URL(request.url).pathname)) return handle(request, env, ctx);
```

For Astro on Cloudflare, put the copied directory at `src/edgeglint/` for these import paths.
Add `src/pages/api/t/[...rest].ts` for `/api/t` and `/api/t/*`:

```ts
import { astro } from "../../../edgeglint/adapters.js";
export const prerender = false;
export const ALL = astro;
```

Add `src/pages/api/t.js.ts` for the tracker script:

```ts
import { astro } from "../../edgeglint/adapters.js";
export const prerender = false;
export const ALL = astro;
```

Astro checks the `Origin` header on a POST to an on-demand route. A missing header gives 403. A browser `sendBeacon` sends it.
A curl test must send `-H 'Origin: https://your-site'`.
The login page uses `Referrer-Policy: same-origin` to prevent `Origin: null` on the login form.

The Astro dev server can have no `TELEMETRY`. The collector then sends 204 without writes, so a local canary can examine the beacon.
Local requests have no `request.cf`; a Playwright test can set `page.setExtraHTTPHeaders({"cf-ipcountry": "US"})`.

For Pages Functions, add `functions/api/[[path]].js`:

```js
import { pages } from "../../edgeglint/adapters.js";
export const onRequest = pages;
```

Add `<script defer src="/api/t.js"></script>` to the layout for each integration.

## Configuration

- `SITES`: comma-separated hosts, for example `example.com,shop.example.com`. The collector rejects hosts not in the list.
- `ROUTES`: full paths or prefix patterns, for example `/,/pricing,/blog/*`. Unknown page paths become `/other`; unknown error script paths become `other`.
- `COLLECT`: set `off` to send an empty script and stop all writes.
- `DASH_KEY`: runtime secret for the dashboard. Use `npx wrangler secret put DASH_KEY`, or the Worker's "Variables and Secrets" settings.

Do not put `DASH_KEY` in Workers Builds build secrets. The runtime cannot read a build secret.
Without `SITES`, the collector accepts other hosts. Without `ROUTES`, lowercase private path words can go into the dataset.
Always set the two values for a production deployment. A site build can supply `handle(request, env, ctx, { routes })` as an alternative.

A path segment that resembles an identifier becomes `:x`. A host becomes its registrable domain.
Probe paths have a different rule: `/edgeglint-probe/<token>` becomes a path with a hash of the token.

The `TELEMETRY` binding writes to the `edgeglint` dataset. `ANALYTICS_SQL` reads it through the SQL binding.

The optional `LIMITER` has a limit of 60 beacons for each client IP each minute at each Cloudflare location.
The optional `PROBE_LIMITER` has a limit of five token health queries each minute at each location, for all clients together.
Pages has no rate limiter binding. Without `PROBE_LIMITER`, the cache has a limit of one query for each token in 60 s.

Worker invocation logs do not show query strings through `redact_query_string`.

## Dashboard

Open `/api/t/dash`. Type the key in the login form.
The form sends the key in a POST body to `/api/t/dash/login`. The Worker sets an HttpOnly cookie for 30 days.
Without `DASH_KEY`, dashboard routes send 404. An incorrect key gives no data.

Scripts can send `Authorization: Bearer <DASH_KEY>` to `/api/t/dash/data?site=example.com&days=7&kind=pv`.
The permitted day values are `1`, `7`, `30` and `90`; types are `pv`, `clk`, `err`, `out`, `cwv` and `sites`.

`DASH_DEMO=1` uses generic fixture data without a binding. The footer shows the build version and Git SHA.
With owner authentication, `/api/t/dash/data?kind=diag` runs 18 SQL queries in sequence and reports each result without a cache.

## Health probe

`GET /api/t/health` is public. It sends `points_last_hour` for the request's site.
Send a beacon with `/edgeglint-probe/deploycheck`.
Request `/api/t/health?p=/edgeglint-probe/deploycheck`.
After ingestion, `probe.pv_rows` must be one or more. The collector and health route hash the token before storage or lookup.

Tokens must have 6 to 32 lowercase letters or digits. Other `p` values have no effect.
`LIMITER` also applies to health requests. A refused probe query sends `probe: null` with the cached total.

Without `ANALYTICS_SQL`, the answer gives `points_last_hour: null` and the message `no ANALYTICS_SQL binding`.
Before the first write, a missing dataset gives 0 counts, null averages and empty lists. It does not give 503.

## Limits and cost

Analytics Engine keeps data for three months. The free allowance is 100,000 writes and 10,000 SQL reads each day.
The research snapshot gives "Currently, you will not be billed"; check the [pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/) before deployment.

A flush writes 1 to 172 data points. Subsequent flushes can write more rows for one pageview.
A dashboard load uses 15 queries; health uses one. Answers use a 60 s cache. Each beacon is at most 16 KB.
See [Analytics Engine limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/) for platform limits.

## Known limits

- A `pagehide` with `persisted: true` sends `qb` 0. If the page does not come back, the quick-exit count is too low.
- The dashboard selects rows by flush time. A correction can refer to a snapshot before the selected period.
- Analytics Engine samples rows. The SQL binding applies sample weights; it has no `_sample_interval` column.
- The dashboard shows average LCP and CLS, with no percentiles. It has no session replay, heatmaps or unique-visitor counts.
- A dashboard response from an earlier request can replace a more recent selection.
- The geo policy does not measure the EEA, UK, Switzerland, related areas, unknown countries and Tor. It decreases measurement coverage.

The project does not claim to be compliant or banner-free. Each operator must get a legal review for the deployment.

The country rule decreases collection. GDPR, ePrivacy, local law and cross-border data rules can continue to apply. Cloudflare can keep request logs. The host settings control these logs.
See [research and decisions](docs/research.md) for the sources, legal limits and decisions.

## Status

Pilot 0.2.0. The author runs edgeglint on two production sites.
This tree prepares a public release. It does not claim that a public release has occurred.

## License

> License: to be decided. Until a license file is added, all rights are reserved.
