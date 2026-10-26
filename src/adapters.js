// Adapters that send a framework request to `handle`.
import { handle } from "./collect.js";

// Astro on Cloudflare: `export const ALL = astro;` in an API route with `prerender = false`.
// The Astro dev server can have no TELEMETRY binding. Then the collector sends 204 and writes nothing.
export const astro = (ctx) => handle(ctx.request, ctx.locals.runtime.env, ctx);
// Pages Functions: `export const onRequest = pages;`.
export const pages = (context) => handle(context.request, context.env, context);
