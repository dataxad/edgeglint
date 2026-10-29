# edgeglint installation

Read [docs/kb/index.md](docs/kb/index.md) first: the one-page design in `docs/one-page/` and the KB notes (#38).
Read [README.md](README.md) for installation terms.
Read [docs/data-flow.md](docs/data-flow.md) before deployment.
The source is public. There is no license grant or npm package.

## Prepare

1. Examine the host framework, public paths and Wrangler configuration.
2. Use Node.js 22 or a subsequent version.
3. Run `npm ci` in the edgeglint checkout.
4. Run `npm run build` to make the tracker and version modules.
5. Start Analytics Engine in the Cloudflare account dashboard before the first deployment.

## Install

For a new collector, use `wrangler.jsonc` and `src/worker.js` from this checkout.
For a project that you have, copy the built `src/` directory as `edgeglint/`.
Use [docs/install.md](docs/install.md) for the Worker, Astro and Pages files.

Keep `/api/t`, `/api/t.js` and dashboard paths on the site's origin.
Add `<script defer src="/api/t.js"></script>` to the site layout.
Copy the bindings from `wrangler.jsonc` into the host configuration:

- `TELEMETRY`: Analytics Engine dataset `edgeglint`.
- `ANALYTICS_SQL`: the `analytics` SQL binding; Wrangler 4.145.0 or a subsequent version.
- `LIMITER` and `PROBE_LIMITER`: rate limits with account-unique integer namespace IDs.

Pages does not have these rate-limit bindings. Its SQL binding availability is unverified here.
Use the standalone Worker on a same-origin route when the host has no necessary bindings.

Set `SITES` to the site's hosts and `ROUTES` to its public path allowlist.
Keep `COLLECT=off` until the configuration and deployment review are complete.
Set `DASH_KEY` with `npx wrangler secret put DASH_KEY` in the deployment project.

Use a private random value from `openssl rand -hex 32`.
Keep the value out of source files, logs or build secrets.
Deploy with the host's procedure.

Set `COLLECT=on` when prepared to measure.

## Verify

1. Run `npm test` and `npm run size` in this checkout.
2. Load `/api/t.js` from an allowed-country browser with no opt-out.
3. Send the documented probe beacon in [README.md](README.md#check-the-installation).
4. Make sure that `probe.pv_rows` is 1 or more after ingestion.
5. Open `/api/t/dash`. Use the runtime key in the login form.
6. Check excluded-country, GPC, DNT and explicit opt-out noncollection.

A 204 response alone does not prove a write. Record unverified deployment checks.
Keep country exclusions, allowlists and opt-out checks. Add no visitor identifiers.

Do not claim compliance, a consent exemption or complete traffic coverage.
Do not commit secrets or build output.

## Maintain

Change dev `main` first.
Mirror the reviewed changes to public `main`.
With `origin` for dev and `public` for the mirror, fetch the two remotes.

Run `git diff origin/main public/main`. The result must be empty after the mirror.
On 2026-10-27, a public-first README edit caused different trees. Keep its privacy corrections.

Route public issues into dev before code changes. Mirror the reviewed repair back to public.
