# Data flow and privacy notice

Source review: 2026-10-28, after the later-maximum correction.
[Collector](../src/collect.js), [rules](../src/rules.js) and [tracker](../src/tracker.js) give the current behavior.
This maps source behavior. It does not give approval for an adopter's deployed configuration.

## Stored fields

Each row has one site index, a type, typed fields and an Analytics Engine timestamp.
The timestamp is the write time, not a browser event time.
The table names each populated slot. Empty slots contain no collector field.

All rows have the same three-month Analytics Engine retention.

| Kind | Slot | Field, source and transformation |
| --- | --- | --- |
| all | index1 | Request host: lowercase, no `www.`; host validation and `SITES` allowlist. Subdomains can remain. |
| all | timestamp | Analytics Engine write time; supplied by the platform. |
| pv | blob1 | Collector constant `pv`; pageview or later flush. |
| pv | blob2 | `p`: browser pathname normalized by `normPath`; `ROUTES` maps unknown paths to `/other`. |
| pv | blob3 | `d`: viewport width group `s` below 600, `m` below 1024, else `l`. No exact width. |
| pv | blob4 | `r`: referrer host becomes `direct`, `internal`, a registrable domain, or `other`. |
| pv | blob5 | Cloudflare request country code; excluded, missing and invalid codes produce no row. |
| pv | blob6 | Request User-Agent: known browser family and major version, else `other`. |
| pv | blob7 | Request User-Agent: OS family; iOS and Android include major version, else family or `other`. |
| pv | double1 | `f`: 1 only for the first flush; later rows contain 0. |
| pv | double2 | `sc`: maximum visible scroll depth, rounded to steps 0–10. |
| pv | double3 | `qb`: quick exit, 1 on the final pagehide below 5 s foreground dwell, else 0. |
| pv | double4 | `dw`: foreground dwell since the preceding flush, rounded to 5 s; maximum 86400 s. |
| pv | double5 | `lcp`: performance LCP in 100 ms steps, maximum 60000 ms; -1 means unavailable. |
| pv | double6 | `cls`: maximum CLS session window ×1000, rounded to steps of 10; maximum 100000; -1 means unavailable. |
| pv | double7 | Visit flag: first flush and referrer different from this site, including direct traffic. |
| pv | double8 | Correction weight: 1 for changed maxima, -1 for their previous snapshot; otherwise 0 or absent. |
| clk | blob1 | Collector constant `clk`. |
| clk | blob2 | Same normalized and allowed `p` as the page row. |
| clk | blob3 | Click target ancestry: allowed tags and `nth-child`; at most 12 steps and 120 characters. |
| clk | double1 | Click count since preceding flush; integer 1–10000. |
| clk | double2 | Rage count: third or subsequent click on one path within 1 s; no more than clicks. |
| clk | double3 | Dead count: non-link click without a DOM change within 1 s; no more than clicks. |
| err | blob1 | Collector constant `err`. |
| err | blob2 | Same normalized and allowed `p` as the page row. |
| err | blob3 | Error name from the `ERRS` allowlist, else `Other`. No message. |
| err | blob4 | Error script: `ext`, `inline`, or normalized same-origin script path; disallowed routes become `other`. |
| err | double1 | Error line number, bounded to 0–1000000. |
| err | double2 | Error column number, bounded to 0–1000000. |
| err | double3 | Count for this error tuple; integer 1–10000. |
| out | blob1 | Collector constant `out`. |
| out | blob2 | Same normalized and allowed `p` as the page row. |
| out | blob3 | Link category: external host `out`, or same-host download `dl`. |
| out | blob4 | External target becomes a validated registrable domain; download target becomes an allowed `DL` file extension. |
| out | double1 | Count for the link category and target; integer 1–10000. |

`v` validates schema version 1; the collector does not keep it as a field.
Optional `prev` transmits previous `sc`, `lcp` and `cls` maxima, not an identifier.
A changed snapshot adds a negative-weight `pv` row with previous maxima and 0 counts.

The positive row keeps current dimensions. The SQL dashboard uses these weights for maximum-value corrections.

The tracker reads `location.pathname`, with no query string.
`normPath` replaces identifier-like segments with `:x`.
It keeps a maximum of eight segments and 200 characters. Long results become `/:long`.

Short lowercase private words can survive. Configure `ROUTES`. Normalization alone is not sufficient.

Probe paths keep the first 12 hexadecimal characters of SHA-256(token), not the raw token.
Domain reduction uses a short suffix list, not the full Public Suffix List.
The collector validates bounded values again. It accepts at most 100 click, 20 error and 50 outbound items for each beacon.

## Processing outside dataset rows

The browser sends measurements to same-origin `/api/t` through HTTPS.
Cloudflare's network receives these requests and keeps rows in the adopter's Analytics Engine account.
The collector reads raw User-Agent for bot checks and browser/OS categories.

It uses the request IP as the rate-limit key when `LIMITER` is available. The raw values do not go into dataset rows.
Country codes, bot metadata, GPC, DNT and the opt-out cookie can stop collection.

A rejected beacon also sends 204. This is not ingestion proof.
The dashboard reads rows through `ANALYTICS_SQL`; answers use a 60 s cache.

The optional visitor opt-out cookie `t=0` lasts 13 months.
Dashboard login uses a different HttpOnly authentication cookie for 30 days.
These are not measurement identifiers. Keep the dashboard key out of logs and source.

## Retention and request logs

[Analytics Engine retention](https://developers.cloudflare.com/analytics/analytics-engine/limits/) is three months, for each row above.
The collector has no archive or deletion API.

`wrangler.jsonc` starts observability and invocation logs with `redact_query_string: true`.
Query redaction does not remove URL paths or guarantee redaction in other Cloudflare request-record services.
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) currently keep Free logs for 3 days and Paid logs for 7 days.

Check the actual plan, sampling, exports, Logpush destinations and host settings before deployment.
Host request logs can have other fields and retention. The three-month dataset policy does not include them.

## Transfers and deployment review

No regional data-location guarantee follows from the country-code gate.
Review Cloudflare's processor terms, subprocessors, actual storage locations and applicable international data movement mechanism for this deployment.
The EU-US Data Privacy Framework has an [adequacy decision](https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj/eng) for participating US organizations.

It is not a general GDPR approval. Check the related entity, participation and scope before relying on it.
Country, time, route and behavior combinations can be personal data without a continuous visitor identifier.

See [research corrections](research.md#2026-10-27-corrections-checked-2026-10-28) and [measurement levels](tiers.md).

## Privacy notice template

This template is not legal advice. Adapt it to the actual deployment before publication.

> We use edgeglint to understand how people use this website and where its interface needs improvement.
> It records allowed page paths, referral domains, country codes, broad browser and operating-system information, and viewport width groups.
> It also records scroll depth, foreground time, element click counts, error classes and locations, outbound domains, download types, and web performance.
> It uses no measurement cookies or visitor identifiers, but combinations of these fields can still be personal data.
> Cloudflare processes requests on its network and retains measurement rows for three months in our account.
> Our configuration excludes specified country codes and respects Global Privacy Control, Do Not Track and an explicit opt-out.
> [Stop measurement](/api/t?optout=1) sets an opt-out cookie for 13 months. The private dashboard uses a separate authentication cookie.

Add the controller and contact, actual purposes and legal basis, request-log fields and retention, processor information, and applicable rights.
Check actual collection settings and retention before using the template.
