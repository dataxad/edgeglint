# edgeglint

edgeglint gives privacy-aware analytics on Cloudflare, with no measurement cookies or identifiers.
It adds scroll depth, element click counts, JavaScript errors and Core Web Vitals.
For specified country codes in the EEA, UK, Switzerland and related areas, the rule sends an empty tracker.

It also drops reports from these requests. This rule does not show where consent is necessary.

Cloudflare Web Analytics has Core Web Vitals, but no scroll depth, element click counts or JavaScript errors.
See the [research and decisions](docs/research.md) for the sources, market table, legal analysis and deployment lessons.

## Choose an installation

- New collector: use the standalone Worker below.
- For a Worker, Astro or Pages project: use the [source adapters](docs/install.md).
- No npm package is available. Check the use terms before installation.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dataxad/edgeglint)

Cloudflare documents this button path, but we have not tested it with these Analytics Engine, rate-limit and Analytics SQL bindings.
Read the [button documentation](https://developers.cloudflare.com/workers/platform/deploy-buttons/) for the platform mechanism.
For a new project, C3 also documents this template command:

```sh
npm create cloudflare@latest -- --template https://github.com/dataxad/edgeglint
```

The C3 path is untested here. Configure the account, bindings, routes and runtime secret before collection.

## Choose a level

Start with **level 0**, the current measurement features, before adding a consent form or tracking service.
It gives pageviews, referrer-based visits, scroll, clicks, errors, LCP and CLS averages, and width groups.
The dataset has no visitor identifiers. The country-code rule decreases coverage.

- **Level 1** proposes daily unique visitors with a daily identifier and a different legal review.
- **Level 2** proposes wider coverage after consent or a French exemption profile with review approval.
- Levels 1 and 2 are proposals. They have no flags.
- **Level 3** uses external replay and heatmap tools. It is not part of edgeglint.

Read [measurement levels](docs/tiers.md) and [data flow](docs/data-flow.md) before deployment.

## For AI agents

Read [AGENTS.md](AGENTS.md) for the shared installation procedure.
Use [llms.txt](llms.txt) as the documentation index.
Load the `edgeglint-install` skill from `.agents/skills/`, `.claude/skills/` or `skills/` when necessary.

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
- The edge uses Cloudflare's request country code to send an empty script for the EEA, UK, Switzerland and related areas.
  It also sends no tracker for unknown country codes or Tor.
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
Without account enablement, deployment can stop with "You need to enable Analytics Engine".

1. Run `npm ci`. Use Node.js 22 or a subsequent version, and Wrangler 4.145.0 or a subsequent version.
2. Set the site route in `wrangler.jsonc`, for example `example.com/api/t*` in the `example.com` zone.
3. Set `COLLECT=off`, `SITES` and `ROUTES` in `vars`. See the configuration below.

   Check that rate-limit namespace IDs `1001` and `1002` are unique in your account.
4. Run `npm run deploy`.
5. Run `npx wrangler secret put DASH_KEY`.
6. Add `<script defer src="/api/t.js"></script>` to the site layout.
7. Review [data flow](docs/data-flow.md).

   Set `COLLECT=on`. Deploy when prepared to measure.

The setup commands are `npm ci`, `npm run deploy` and `npx wrangler secret put DASH_KEY`.

The commands `npm run deploy` and `npm run dev` run the build first.
The build writes `src/tracker.built.js` and `src/version.js`; these files do not belong in the repository.

## Existing Worker, Astro and Pages

Use the [source adapter recipes](docs/install.md). No npm package is available.
Build the selected checkout before copying its source with the build output.

## Configuration

- `SITES`: comma-separated hosts, for example `example.com,shop.example.com`. The collector rejects hosts not in the list.
- `ROUTES`: full paths or prefix patterns, for example `/,/pricing,/blog/*`. Unknown page paths become `/other`; unknown error script paths become `other`.
- `COLLECT`: set `off` to send an empty script and stop all writes.
- `DASH_KEY`: runtime secret for the dashboard. Use `npx wrangler secret put DASH_KEY`, or the Worker's "Variables and Secrets" settings.

The template keeps collection off and uses example hosts and paths. Replace them before collection.
Copy `.dev.vars.example` to `.dev.vars` only for local development. Set a private local key.

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

## Check the installation

1. Load `/api/t.js` from an allowed-country browser without an opt-out.
2. Send one probe from that browser's console on the site's origin:

```js
navigator.sendBeacon("/api/t", JSON.stringify({
  v: 1, f: 1, qb: 0, p: "/edgeglint-probe/deploycheck", r: "", d: "m",
  sc: 0, dw: 0, lcp: -1, cls: -1, clk: [], err: [], out: []
}));
```

3. After ingestion, open `/api/t/health?p=/edgeglint-probe/deploycheck`.
   Make sure that `probe.pv_rows` is 1 or more. A 204 response alone does not prove ingestion.
4. Open `/api/t/dash`. Use the login form. Make sure that the page shows the site's rows.
5. Check that an excluded-country browser receives an empty tracker and gives no probe rows in storage.
6. Do the noncollection checks again with GPC, DNT and `/api/t?optout=1`.

Use a different permitted probe token for each check to distinguish earlier rows.
A spoofed country header does not prove the production country rule. See the local adapter test limits in [recipes](docs/install.md).

Record production checks that stay unverified.

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
- The geo policy does not measure the EEA, UK, Switzerland, related areas, unknown countries and Tor. It decreases measurement coverage.

The project does not claim to be compliant or banner-free. Each operator must get a legal review for the deployment.
The country rule decreases collection. GDPR, ePrivacy, local law and cross-border data rules can continue to apply.

Cloudflare can keep request logs. The host settings control these logs.
See [research and decisions](docs/research.md) for the sources, legal limits and decisions.

## Status

Pilot 0.2.0. The author runs edgeglint on two production sites.
The source is public at [dataxad/edgeglint](https://github.com/dataxad/edgeglint).
There is no tagged release or npm package. Pilot status does not give a compatibility or legal guarantee.

[Project page](https://dataxad.com/projects/edgeglint).

## License

> License: to be decided. Until a license file is added, all rights are reserved.
