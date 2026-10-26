import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import DEMO from "../src/demo.js";

test("the bundled dashboard fetches data with keepNames", async () => {
  const { outputFiles } = await build({
    entryPoints: [new URL("../src/dashboard.js", import.meta.url).pathname],
    bundle: true,
    format: "esm",
    keepNames: true,
    write: false,
    platform: "browser",
  });
  const { dashRoutes } = await import("data:text/javascript;base64," + Buffer.from(outputFiles[0].text).toString("base64"));
  const response = await dashRoutes["GET /api/t/dash"](
    new Request("https://example.com/api/t/dash", { headers: { cookie: "dk=test-key" } }),
    { DASH_KEY: "test-key" },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  const nonce = response.headers.get("content-security-policy").match(/script-src 'nonce-([^']+)'/)[1];
  const script = html.match(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/);
  assert.ok(script);
  assert.equal(script[1], nonce);

  const node = () => ({
    children: [], textContent: "", value: "",
    append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {},
    set innerHTML(value) { throw new Error("innerHTML"); },
  });
  const ids = { main: node(), site: node(), days: Object.assign(node(), { value: "7" }) };
  const requests = [];
  const document = { getElementById: (id) => ids[id], createElement: node, createElementNS: node };
  const fetch = async (url) => {
    const parsed = new URL(url, "https://example.com");
    requests.push(parsed);
    return { ok: true, json: async () => DEMO[parsed.searchParams.get("kind")] };
  };
  await runInNewContext(script[2], { document, fetch, location: { hostname: "example.com" } }, { timeout: 1000 });
  await new Promise(setImmediate);
  assert.deepEqual(requests.map((url) => url.searchParams.get("kind")), ["sites", "pv", "cwv", "clk", "err", "out"]);
  assert.ok(requests.every((url) => url.pathname === "/api/t/dash/data"));
  assert.ok(ids.site.children.length > 0);
  assert.ok(ids.main.children.length > 1);
  assert.equal(typeof ids.site.onchange, "function");
  assert.equal(ids.days.onchange, ids.site.onchange);

  ids.site.value = "other.example";
  ids.days.value = "30";
  await ids.days.onchange();
  assert.ok(requests.slice(-5).every((url) => url.searchParams.get("site") === "other.example" && url.searchParams.get("days") === "30"));
});
