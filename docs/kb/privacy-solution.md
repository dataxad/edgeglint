# Privacy solution

Date: 2026-10-29. Type: system.

Design: [[one-page/privacy-solution]]. Sources: `src/collect.js`, `src/tracker.js`, `docs/data-flow.md`, `docs/tiers.md`. Counsel packet: #34.

Level 0 as deployed. The tracker reads the pathname (never the query string), a viewport width group, the referrer host, scroll depth, dwell, LCP, CLS, clicks, error names and outbound links. It never sets cookies or storage and holds no identifier. With GPC, DNT or the opt-out cookie `t=0` it sends nothing.

Script gate: the edge answers the tracker request with an empty script (`//`) when the request country is in EXCLUDE (EEA, UK, CH and their territories, unknown `XX`, Tor `T1`) or `COLLECT` is off, so collection never starts there.

Beacon gates in `collect()`, in order: COLLECT off; opted out; Cloudflare verified-bot category; User-Agent bot regex (`bot|crawl|spider|headless|lighthouse|preview|fetch`); country excluded (same set); rate limiter with the IP as the key; schema validation and the SITES allowlist (ROUTES does not reject: it maps unlisted paths to `/other`). Every rejection answers 204 with `Cache-Control: no-store` and writes nothing, so a 204 is not proof of ingestion.

A stored row (Analytics Engine, three-month platform retention, sampled): index = site host; blobs = kind, normalized path (identifier-like segments become `:x`, unknown paths `/other`), width group, referrer domain or `direct`, `internal` or `other`, country code, browser family with its major version, OS family with the major version only on iOS and Android; doubles = bounded numbers (first flush, scroll 0 to 10, quick exit, dwell in 5 s steps, LCP in 100 ms steps, CLS, visit flag, correction weight). No visitor field exists. Raw IP and raw User-Agent live only inside the collect function. There is no archive and no delete API.

Read path: the dashboard Worker queries through the Analytics SQL binding (no API token, 60 s cache, sample weights already applied). Login is a separate HttpOnly cookie for 30 days.

Levels (`docs/tiers.md`): 0 live; 1 daily unique browsers by a daily HMAC of IP and User-Agent (#6, counsel first; WP29 and CNIL call it fingerprinting); 2 consent mode and a French exemption profile for excluded countries (#10, counsel first); 3 session replay is another product.

Bot defence is a separate optional layer. Today: gates 3, 4 and 6 drop bot rows without labelling or storing them. Optional edge layer, when bot rows show in the dashboard or writes approach the free 100k per day: a Cloudflare rate rule or WAF rule scoped to the `/api/t` path (the Undermine pattern, undermine #686), or a bot score threshold where the plan offers one; never zone-wide Bot Fight Mode. Never for analytics: a client challenge such as Turnstile for a page view. A visit is not a service the visitor asked us to protect, and ePrivacy 5(3) has no legitimate-interest exemption; bot filtering is minimisation, not a legal basis.

Never write "compliant" or "banner-free" (EDPB 2/2023 ¶53: no cookie is not an exemption).
