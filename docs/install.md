# Existing Worker, Astro and Pages

Run `npm run build` first. Copy the `src/` directory, with its build output, into the project as `edgeglint/`.
Add the bindings and variables from `wrangler.jsonc` to the host project's configuration.

Follow the shared setup, secret and verification steps in [AGENTS.md](../AGENTS.md).

## Worker

For a Worker that you have, use `handle(request, env, ctx)` in its fetch handler:

```js
import { handle } from "./edgeglint/collect.js";
// In the fetch handler:
if (/^\/api\/t(\.js|\/|$)/.test(new URL(request.url).pathname)) return handle(request, env, ctx);
```

## Astro

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

## Pages Functions

Put the built source at `functions/edgeglint/`.
Add `functions/api/t/[[path]].js` for `/api/t` and `/api/t/*`:

```js
export { pages as onRequest } from "../../edgeglint/adapters.js";
```

Add `functions/api/t.js.js` for `/api/t.js`:

```js
export { pages as onRequest } from "../edgeglint/adapters.js";
```

These files keep unrelated `/api/*` routes out of the handler.
Pages has no Workers rate-limit binding. Analytics SQL availability on Pages is unverified here.

Use a standalone collector Worker on the site's `/api/t*` route for the full binding set.
Check production routes, login POSTs and ingestion before use.

Add `<script defer src="/api/t.js"></script>` to the layout for each integration.
The adapters use the host's environment and request context. They do not configure Cloudflare resources.

Framework-version compatibility has not been tested by this documentation change.
