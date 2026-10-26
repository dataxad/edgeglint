# Research and decisions

This record uses research from 2026-10-21 to 2026-10-25.
Market values below are a dated snapshot. They are not current guarantees.
The source URLs identify the source for each result.
A value of "not verified" means that the research did not give that value.

## The gap

Cloudflare Web Analytics is free on all plans. It uses no cookies or localStorage.
For proxied sites, its beacon goes to the site's domain, but its script comes from `static.cloudflareinsights.com`.
It has no scroll depth, click data, heatmaps, JavaScript errors or custom events.
Its FAQ gives "Not yet" for custom events.
Sources: [about](https://developers.cloudflare.com/web-analytics/about/), [FAQ](https://developers.cloudflare.com/web-analytics/faq/), [setup](https://developers.cloudflare.com/web-analytics/get-started/).

Cloudflare Web Analytics has Core Web Vitals.
Its EU setting does not include visitor data in the EU. Cloudflare gives no promise of a consent exemption.
Sources: [Core Web Vitals](https://developers.cloudflare.com/web-analytics/data-metrics/core-web-vitals/), [setup](https://developers.cloudflare.com/web-analytics/get-started/).

The former Cloudflare Apps marketplace ended. Third-party notices give 2024-08-31 as the end date.
Those notices give 2025-01-15 as the stop date for new installs.
Source: [migration notice](https://docs.datadome.co/docs/cloudflare-app-to-workers-migration-guide).

Deploy buttons and the Cloudflare templates repository are the closest installation paths in this research.
The templates repository had no analytics template at the research date.
Sources: [deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [templates](https://github.com/cloudflare/templates).

Cloudflare Custom Dashboards list three data source types. Analytics Engine is not one of them.
Thus Custom Dashboards cannot chart Workers Analytics Engine data through those data sources.
Source: [Custom Dashboards](https://developers.cloudflare.com/analytics/custom-dashboards/).

Zaraz manages third-party tools, including Amplitude, GA, GA4, Mixpanel and Snowplow. It also has a consent platform.
It has no first-party collector. A custom managed component cannot give a public endpoint.
Sources: [tool list](https://developers.cloudflare.com/zaraz/reference/supported-tools/), [custom components](https://developers.cloudflare.com/zaraz/advanced/load-custom-managed-component/).

Decision: use a small collector and a dashboard on the SQL binding.
This gives scroll depth, element click counts and JavaScript errors with the Cloudflare data service.
Code: [collector](../src/collect.js), [dashboard](../src/dashboard.js).

## Prior art

All star counts use the check on 2026-10-21. Other results use the research dates above.
"Not verified" does not mean that a feature is missing.
The feature column gives scroll / click / errors / replay, in that sequence.
The edgeglint row gives this tree, with no published release.

| Project and source | License | Stars; date checked | Storage | How visitors are counted | Scroll / click / errors / replay | Last release |
| --- | --- | --- | --- | --- | --- | --- |
| [Counterscale](https://github.com/benvinegar/counterscale) | MIT | 2,166; 2026-10-21 | Analytics Engine; R2 archive | Browser HTTP cache | No / no / not verified / not verified | v3.4.1; 2025-12-15 |
| [GT Analytics](https://github.com/wpgaurav/gt-analytics) | MIT | Not verified; 2026-10-21 | Not verified | Daily site-scoped HMAC key | Not verified / not verified / not verified / not verified | Not verified |
| [InsightFlare](https://github.com/RavelloH/InsightFlare) | MIT | 646; 2026-10-21 | D1/KV; Analytics Engine optional | localStorage visitor ID unless EU mode is on | Not verified / not verified / not verified / not verified | Not verified |
| [HanAnalytics](https://github.com/uxiaohan/HanAnalytics) | MIT | 278; 2026-10-21 | Pages + Analytics Engine | Not verified | Not verified / not verified / not verified / not verified | Not verified; last push 2025-03-19 |
| [Plausible](https://github.com/plausible/analytics) | AGPL-3.0; JS MIT | 29,583; 2026-10-21 | ClickHouse for self-hosting | Daily salt + domain + IP + User-Agent hash | Yes / not verified / not verified / not verified | v3.2.1; 2026-05-15 |
| [Umami](https://github.com/umami-software/umami) | MIT | 39,504; 2026-10-21 | Not verified | Website + IP + User-Agent + salt + server secret hash | No / not verified / not verified / no | v3.4.0; 2026-09-17 |
| [Rybbit](https://github.com/rybbit-io/rybbit) | AGPL-3.0 | 13,147; 2026-10-21 | Not verified | Not verified; project says no cookies | Not verified / not verified / yes / yes | v2.9.0; 2026-09-12 |
| [Cloudflare Web Analytics](https://developers.cloudflare.com/web-analytics/faq/) | Not verified | Not applicable | Not verified | No cookies or localStorage; count method not verified | No / no / no / not verified | Not applicable |
| [Microsoft Clarity](https://learn.microsoft.com/en-us/clarity/faq) | Not verified | Not applicable | Not verified | Cookies need consent in the EEA, UK and Switzerland | Not verified / not verified / not verified / not verified | Not applicable |
| [PostHog cookieless](https://posthog.com/docs/privacy/data-collection) | Not verified | Not verified; 2026-10-21 | Not verified | Server-side hash | Not verified / not verified / not verified / not verified | Not verified |
| [edgeglint](../src/collect.js) | To be decided | Not verified; tree 2026-10-26 | Analytics Engine | No unique visitors; referrer-based visits | Yes / yes / yes / no | Pilot tree 0.2.0; no public release claimed |

Counterscale uses one dataset for each deployment, with the site ID as its index.
Its tracker first gets `/cache`. The server reads `If-Modified-Since` and sets `Last-Modified`.
Its collector also keeps the raw User-Agent in `blob2`.
Sources: [repository and source files](https://github.com/benvinegar/counterscale), in `collect.ts`, `routes/cache.tsx` and `tracker/src/lib/request.ts`.

Counterscale had about 8,500 non-test lines and 11,100 test lines.
The server had about 5,400 lines, the CLI installer 1,700 and the tracker 1,100.
Its stack used React Router 7, Recharts, Tailwind 3 and Vite 7.
Source: [Counterscale](https://github.com/benvinegar/counterscale).

Counterscale had no heatmaps or custom events. Its last commit was 2026-10-04.
It was volunteer-driven. External PR merge times ranged from four days to four months.
The research found a security PR open since 2026-10-16.
Sources: [repository](https://github.com/benvinegar/counterscale), [contribution policy](https://github.com/benvinegar/counterscale/blob/main/CONTRIBUTING.md).

GT Analytics is a hard fork of Counterscale 3.4.1.
InsightFlare started on 2026-02-28 and has Core Web Vitals and custom events.
Sources: [GT Analytics](https://github.com/wpgaurav/gt-analytics), [InsightFlare](https://github.com/RavelloH/InsightFlare).

Plausible removes its daily salt each 24 hours. It has scroll depth but no heatmaps.
Umami changes its salt monthly by default. It has no heatmaps.
Sources: [Plausible data policy](https://plausible.io/data-policy), [scroll depth](https://plausible.io/docs/scroll-depth), [Umami source](https://github.com/umami-software/umami), in `src/app/api/send/route.ts` and `src/lib/crypto.ts`.

Rybbit has session replay, funnels, errors and cloud Web Vitals, but no heatmaps.
A different MIT personal-site project keeps click heatmap cells in Analytics Engine for an owner-only report.
Sources: [Rybbit](https://github.com/rybbit-io/rybbit), [site project](https://github.com/dytsou/site).

Clarity uses the phrase "designed to be GDPR ready". Its regional cookie rule makes explicit consent necessary.
PostHog: "a persistent distinct ID is considered Personal Data under GDPR".

Mouseflow claims GDPR compliance but says that active, explicit consent can be necessary for customers.
Sources: [Clarity](https://learn.microsoft.com/en-us/clarity/faq), [PostHog](https://posthog.com/docs/privacy/data-collection), [Mouseflow](https://mouseflow.com/gdpr/).

Decision: keep the Cloudflare storage model, with no cache-based visitor count or daily visitor hash.
Keep element counts with no heatmaps or session replay. Use a small HTML dashboard.
Code: [collector](../src/collect.js), [tracker](../src/tracker.js), [dashboard](../src/dashboard.js).

## Legal reasoning

The research used EDPB Guidelines 2/2023, version 2.0, dated 2024-10-07.
Paragraphs 44 and 53 identify information made locally and sent to a server as access.
Paragraphs 40 and 56 distinguish applicability from consent: an exemption assessment is necessary.

Paragraph 50 identifies cache mechanisms as terminal storage.
Paragraphs 54 and 55 include IP-only tracking when the IP comes from the terminal.

Source: [EDPB Guidelines 2/2023](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf).

WP29 Opinion 04/2012 does not identify first-party analytics cookies as "strictly necessary".
It gives limited risk when aggregation, opt-out and anonymisation apply.
Source: [WP29 Opinion 04/2012](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2012/wp194_en.pdf).

The German research result is that section 25 TDDDG makes consent necessary for device information access or storage.
It also found no general DSK exemption for "reach measurement".
Source limit: the supplied research records two checks, but gives no German primary URL. This result has no primary-source URL here.
The European scope analysis is [EDPB Guidelines 2/2023](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf), not verification of the German result.

UK PECR Schedule A1 took effect on 2026-02-05. It has a statistical-purposes exception with an objection requirement.
Paragraph 5(2) does not include "automatically emitted" information from that exception.
The status of HTTP headers is an open question in this research.
Sources: [Schedule 12](https://www.legislation.gov.uk/ukpga/2025/18/schedule/12), [PECR Schedule A1](https://www.legislation.gov.uk/uksi/2003/2426/schedule/A1).

The French CNIL criteria below are "not verified against cnil.fr".
The primary pages gave HTTP 503 during research. The sources are a vendor copy and a news summary.
Those sources give July 2025 criteria for audience measurement.
Sources: [vendor copy of the assessment table](https://matomo.org/wp-content/uploads/2026/04/CNIL-Consent-Exemption-Self-Assessment-Table.pdf), [news summary](https://ppc.land/french-data-regulator-updates-cookie-exemption-rules-for-websites/).

Those criteria limit events to presence, feature use and timing.
They limit IP use to city-level data, with a minimum of the last octet removed.
They limit identifiers to a site-specific component with a time limit, and outputs to aggregates.

They do not include session replay and heatmaps. They give a 13-month tracker life and a 25-month data limit.
Source: [assessment table copy; "not verified against cnil.fr"](https://matomo.org/wp-content/uploads/2026/04/CNIL-Consent-Exemption-Self-Assessment-Table.pdf).

In Planet49, C-673/17, consent applies to personal and non-personal data.
In Breyer, C-582/14, a dynamic IP address can be personal data.
Sources: [Planet49](https://curia.europa.eu/jcms/upload/docs/application/pdf/2019-10/cp190125en.pdf), [Breyer](https://curia.europa.eu/jcms/upload/docs/application/pdf/2016-10/cp160112en.pdf).

Decision: aggregation alone does not remove a JavaScript beacon from Article 5(3).
The edge gate sends an empty script in the EEA, UK, Switzerland, unknown countries and Tor. The collector discards their beacons.
A CNIL mode and a consent-manager hook must get counsel before code changes.
Sources: [EDPB scope](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf), [edge gate](../src/collect.js).

edgeglint does not claim to be compliant or banner-free.

## Design decisions

Tier 1 means the bounded fields below. The collector checks each field against allowlists.
A route list from the site build maps unknown paths to `/other`; identifier-like segments become `:x`.
Referrers become a registrable domain or `other`.
Sources: [rules](../src/rules.js), [collector](../src/collect.js).

- Page fields: normalized path, referrer domain, country and device class `s`, `m` or `l`.
- Browser fields: bounded browser and OS major versions.
- Measurements: scroll in 10 percent steps, foreground dwell in 5 s steps, LCP in 100 ms steps and CLS in 0.01 steps.
- Errors: set error class and script path, with line and column values.
- Clicks: counts for each element path, from a 63-tag allowlist with `nth-child` only.
- Outbound clicks: registrable domain or download extension.

Sources for these fields: [tracker](../src/tracker.js), [rules](../src/rules.js), [collector](../src/collect.js).

The dataset does not keep IP addresses, raw User-Agent strings, cookies, local storage or visitor identifiers.
It does not keep x/y coordinates, cursor traces, session replay, form contents, page text or query strings.
The edge uses request information for country, bot checks, rate limits and version numbers, then discards the raw values.
Sources: [collector](../src/collect.js), [tracker](../src/tracker.js).

A visit is a pageview with a referrer domain that is not the site, using the Cloudflare visit definition.
There is no unique-visitor identifier. A quick exit means total foreground dwell less than 5 s, set at pagehide.
Sources: [Cloudflare metrics](https://developers.cloudflare.com/web-analytics/about/), [collector](../src/collect.js), [tracker](../src/tracker.js).

The first beacon of a page load sends the pageview. Subsequent beacons send only delta counts and foreground dwell.
The tracker flushes when a tab becomes hidden and at pagehide. The back/forward cache continues the same page load.
Source: [tracker and flush tests](../test/tracker.test.js).

Global Privacy Control and Do Not Track stop the tracker and collector.
An explicit opt-out control sets a visitor-selected cookie for 13 months. There are no measurement cookies.
Source: [collector](../src/collect.js), [tracker](../src/tracker.js).

Canary tests put marker strings in IDs, classes, text, attributes, error messages, referrers and URLs.
They give an error if a marker gets into a beacon or dataset row. The deployment research also used a Playwright canary on a production site.
Source: [canary tests](../test/tracker.test.js). The live canary is a deployment result, not a test in this tree.

The research measured 2,471 bytes gzip for the tracker. The build budget is at most 3,072 bytes gzip.
The collector sends 204 in each condition. A flush writes at most 171 rows and uses rate-limit bindings when available.
Sources: [build](../scripts/build.js), [collector](../src/collect.js), [tests](../test/collect.test.js).

Analytics Engine limits are 20 blobs, 20 doubles and one index, with 250 writes for each invocation and 16 KB of blobs for each request.
It keeps data for three months. The free allowance is 100,000 writes and 10,000 reads each day.
At the research date, Cloudflare gives "Currently, you will not be billed". Future prices can change.
Sources: [limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/), [pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/).

The dashboard is one HTML page on `ANALYTICS_SQL`, with Wrangler 4.145.0 or a subsequent version. It uses no API token.

The login form sets an authentication cookie. Without `DASH_KEY`, dashboard routes send 404.
Answers use a 60 s cache. The public health probe hashes tokens; a diagnostic route uses owner authentication.
Sources: [SQL binding](https://developers.cloudflare.com/analytics/sql-api/workers-binding/), [dashboard](../src/dashboard.js).

## Lessons from the first deployments

Six deployment runs on two production sites gave these lessons.
The local source and tests below keep the resulting changes; they are not public deployment records.

1. Start Analytics Engine one time for each account in the Cloudflare dashboard. No API token can do this step.
   The first deploys stopped with "You need to enable Analytics Engine". See the [setup procedure](../README.md#standalone-worker).
2. Astro rejected a login form with `Origin: null` after `Referrer-Policy: no-referrer`.
   The login page sends `same-origin`. See the [login response](../src/dashboard.js) and [tests](../test/dashboard.test.js).
3. A client function serialized with `toString()` did not work after esbuild `keepNames` added `__name`.
   The client uses a template string. A [bundle test](../test/dashboard-bundle.test.js) checks the result.
4. The DataFusion-style binding has no `_sample_interval`; it applies sampling weights itself. It has no `date_trunc`.
   `toStartOfInterval`, `toStartOfDay` and `toDate` work. Grouped columns with SELECT aliases caused ORDER BY errors.
   An owner-only diagnostic route tested 18 query shapes live. See the [queries](../src/dashboard.js) and [SQL binding](https://developers.cloudflare.com/analytics/sql-api/workers-binding/).
5. Reviewers from different model families found defects in each of five runs: patterns where allowlists were necessary, one-shot flushes, fail-open geo and double sample weighting.
   Other defects involved SELECT DISTINCT, cache keys, the back/forward cache and identifier-like domain labels.
   The resulting checks are in the [collector tests](../test/collect.test.js), [tracker tests](../test/tracker.test.js) and [dashboard tests](../test/dashboard.test.js).
6. A quota alert came from a different workload in the account. The collector used about 180 Worker requests each day.
   A game-host heartbeat used 100,000. This is a deployment observation, not an Analytics Engine cost estimate.
   Use the [health probe](../README.md#health-probe) and [pricing source](https://developers.cloudflare.com/analytics/analytics-engine/pricing/) to distinguish measurement from account-wide use.
