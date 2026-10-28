# Choose a measurement level

Start at level 0. It gives useful counts with no measurement identifiers.
The country-code list stops collection in the EEA, UK, Switzerland and related areas.

Examine this alternative before you add a consent form or a tracking service.
This method decreases data collection. It cannot prevent a legal complaint.

The operator must get a legal review of the deployment.

| Level | Dashboard gain | Added data | Legal reading and step | Configuration and default | Cost and stop rule |
| --- | --- | --- | --- | --- | --- |
| **0: Start here. Available today.** | Pageviews, referrer-based visits, referrers, routes, scroll depth, clicks, errors, LCP and CLS averages, and width groups. | No visitor ID. Bounded event fields only. | No collection in the excluded countries. JavaScript measurements can still fall within ePrivacy scope [E]. Review the actual deployment. | Existing: `COLLECT=on`. The country exclusion list is fixed. No level flag exists. | Can cost $0 within Cloudflare allowances [P]. Coverage is incomplete. STOP until you set `SITES` and `ROUTES` and review logs, retention, transfers and local rules. |
| **1: Count daily visitors. Proposed.** | Estimated daily unique browsers. No return rate or sessions. | A daily, site-specific HMAC identifier from IP and User-Agent. No raw IP or User-Agent storage. | Rotation does not remove fingerprinting [F]. Get a separate legal assessment of the identifier and its purpose. Keep the country exclusions. | Proposed: `UNIQUE_VISITORS=daily`. No implemented flag. See the daily-visitor proposal. | More identifier processing, key management and dataset writes. STOP until counsel approves the deployment and tests verify key rotation, deletion and count accuracy. |
| **2: Extend coverage. Proposed.** | Measurements from eligible visitors in excluded countries after consent. France can use a separate restricted profile [C]. | Consent state and a measurement-basis label. No new visitor ID unless you also approve level 1. | Get valid prior consent for the consent path [E, D]. France needs a documented exemption assessment [C]. The UK exception has separate conditions [U]. | Proposed: `CONSENT_MODE=required`; not implemented. Proposed: `GEO_MODE=cnil`; current behavior: exclusion. See the coverage proposal. | Consent integration, notices, withdrawal tests and more writes. The French profile loses detail. STOP until the applicable legal assessment and its technical checks pass. |
| **3: Investigate individual journeys. External.** | Session replay and heatmaps in a separate product [V]. | Vendor-dependent identifiers, interaction records and possibly page content. | Review the vendor, purposes, consent, masking, retention and transfers before installation. Do not extend the French exemption to replay [C]. | No edgeglint flag. No external tracker by default. Evaluate Clarity or PostHog separately. | Separate integration and vendor costs. STOP until legal review and tests approve the exact configuration. |

A visit is a pageview with a referrer domain that is different from the site.
It is not a session. Width groups summarize viewport width. They do not identify the device type.

Subsequent flushes correct scroll, LCP and CLS maxima without a visitor identifier. Corrections use flush time.

Cloudflare request logs use a different data system.

## How to move between levels

Levels give alternatives. The sequence is optional.
You can extend coverage at level 2 and keep unique visitors off.

The proposed consent mode applies to recognized countries with no default collection.
It must not start measurement before consent. A missing decision must keep collection off there.

Withdrawal must stop observers and discard pending measurements [D].

Consent does not collect earlier visits. Visitors who refuse consent give no measurements in this path.
Unknown countries, Tor, GPC, DNT and explicit opt-out must continue to stop collection.

Wider regional coverage does not include all traffic.

The proposed French profile applies to France only. It gives no exception in other countries.
With the two modes on, the French profile applies first in France.

Other countries with no default collection continue to use the consent path.
The French profile must keep unique visitors off unless a different assessment gives approval.

It must collect only approved presence, feature-use, load-time, scroll and dwell fields.
The proposed profile does not collect errors, CLS, rage counts or dead-click counts pending review.
This is a proposed configuration, not a CNIL field ruling.

Reports and exports must prevent identification through small groups or filter combinations [C].

## Legal sources and limits

All sources below were read on 2026-10-28. These notes are not a deployment approval.

[E] [EDPB Guidelines 2/2023, version 2.0](https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf).
Paragraph 53 includes information made locally and sent to a server.
Paragraphs 54–55 discuss IP tracking and the source of the IP address.

Paragraph 4 specifies a different consent-exception assessment in relation to national rules.
No cookies and no identifier storage do not give an exception.

[F] [WP29 Opinion 9/2014](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2014/wp224_en.pdf), sections 3 and 7.1.
It includes device recognition through signal combinations as fingerprinting and addresses first-party analytics.
[CNIL's July 2025 assessment tool](https://www.cnil.fr/sites/default/files/2025-07/outil_d_auto-evaluation_mesure_d_audience.pdf), page 4, also uses the term fingerprinting for time-limited device hashes.

It specifies site and time components. These safeguards alone do not give an exemption.

[Plausible's data policy](https://plausible.io/data-policy) gives a daily salt with domain, IP and User-Agent, with salt removal each 24 hours.
[Fathom's technical description](https://usefathom.com/data) gives a site-specific SHA-256 signature with IP, User-Agent and a salt that changes at midnight UTC.
Fathom says a salt change does not erase event signatures from storage.

These vendor methods are prior art, not regulator approval of edgeglint or the vendors.

[C] [CNIL audience-measurement guidance](https://www.cnil.fr/fr/cookies-solutions-pour-les-outils-de-mesure-daudience) and its [assessment tool](https://www.cnil.fr/sites/default/files/2025-07/outil_d_auto-evaluation_mesure_d_audience.pdf).
The primary pages were readable. The earlier research did not include their contents.

The conditions include publisher-only audience measurement, anonymous outputs, no data combination and no tracking across sites.
The tool limits event categories and specifies data minimization. It does not include marketing purposes or replay.

It recommends nearest-ten reporting or a justified anonymity analysis. Filter combinations must keep anonymity.

It specifies an objection control for personal data use.
The guidance recommends notice, a 13-month tracker life without automatic renewal, and at most 25 months of information storage.
These periods are limits. Do not increase edgeglint retention to these limits.

An exemption assessment does not resolve other data-protection duties.

[U] [UK PECR Schedule A1](https://www.legislation.gov.uk/uksi/2003/2426/schedule/A1), paragraph 5; read through its primary XML representation.
The change note gives 2026-02-05 as the insertion date.
The statistics exception specifies a service-improvement purpose, sharing limits, clear information and a simple, free objection control.

The visitor must not object. Paragraph 5(2) does not include "automatically emitted" information in this exception.
[ICO guidance](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-the-use-of-storage-and-access-technologies/what-are-the-exceptions/) distinguishes aggregate service statistics from the tracking of persons.

This is not a general exception for all first-party analytics. Keep UK collection off until the chosen path has review approval.

[D] [German TDDDG, section 25](https://www.gesetze-im-internet.de/ttdsg/__25.html).
It specifies consent for terminal storage or access, subject to transmission and "strictly necessary" service exceptions.
[DSK guidance, November 2024](https://www.datenschutzkonferenz-online.de/media/oh/OH_Digitale_Dienste.pdf), paragraphs 23–25 and 87–90, discusses fingerprinting and configuration-specific audience measurement.

Paragraphs 33 and 61–62 specify consent conditions and an easy withdrawal path.
It gives no general approval for an audience-measurement category.
A French assessment does not authorize collection in Germany.

[P] [Cloudflare Analytics Engine pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/).
Workers Free includes 100,000 writes and 10,000 reads each day.
Cloudflare currently says that it does not bill Analytics Engine use. Check Worker and other service limits independently.

[V] [Clarity heatmaps](https://learn.microsoft.com/en-us/clarity/heatmaps/heatmaps-overview), [Clarity consent API](https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-consent-api-v2), [PostHog replay](https://posthog.com/docs/session-replay) and [PostHog heatmaps](https://posthog.com/docs/toolbar/heatmaps).

## What remains unverified

No legal review has approved an edgeglint level 1 or level 2 deployment.
The French field set, report anonymity and processor terms are unverified for this deployment.
The UK treatment of the actual headers and daily hash is unverified.

Other national rules, including Swiss rules, are unverified here. Country codes are not a legal consent map.

Examine Cloudflare logs, data locations, international data movements and actual retention in the deployed configuration.
Daily-key management and unique-count precision on the SQL binding are unverified.
The repository has no software license grant. Free platform capacity does not give software use rights.
