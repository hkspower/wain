#!/usr/bin/env node
/**
 * Drives the MCP server the way a client does:  npm run test:mcp
 *
 * A real child process, real pipes, real newline-delimited JSON-RPC. The
 * transport is hand-written here — see mcp/wain-mcp.mjs for why — so the parts
 * an SDK would have provided are exactly the parts that need proving:
 * framing, notifications, unknown methods, and tool errors that must NOT be
 * transport errors.
 *
 * The catalogue assertions are deliberately about SHAPE and about agreement
 * with the site's own search, not about which place ranks first. Ranking is
 * tuned in search.ts and has its own tests; a copy of its expectations here
 * would fail every time somebody improved it.
 */

import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const failures = [];
const ok = (cond, what) => (cond ? (passed++, console.log(`  ✓ ${what}`)) : failures.push(what));

/** One client session: send these, collect what comes back. */
function session(messages, { raw = null } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, "mcp/wain-mcp.mjs")], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", () => {
      const lines = out.split("\n").filter((l) => l.trim());
      const parsed = [];
      for (const l of lines) {
        try {
          parsed.push(JSON.parse(l));
        } catch {
          reject(new Error(`server wrote a line that is not JSON: ${l.slice(0, 200)}`));
          return;
        }
      }
      resolve({ messages: parsed, stderr: err });
    });
    child.stdin.write(raw ?? messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
    child.stdin.end();
  });
}

const rpc = (id, method, params) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
const call = (id, name, args) => rpc(id, "tools/call", { name, arguments: args });
const textOf = (m) => JSON.parse(m.result.content[0].text);

console.log("\n── the handshake ──");
{
  const { messages } = await session([rpc(1, "initialize", { protocolVersion: "2024-11-05" })]);
  const init = messages.find((m) => m.id === 1);
  ok(init?.result?.protocolVersion === "2024-11-05", "initialize answers with a protocol version");
  ok(init?.result?.serverInfo?.name === "wain", "and names the server");
  ok(init?.result?.capabilities?.tools !== undefined, "and declares a tools capability");
}

console.log("\n── framing: the part an SDK would have done ──");
{
  // Two messages in one write, and one message split across two — the two
  // things a naive "one chunk is one message" reader gets wrong.
  const a = JSON.stringify(rpc(1, "tools/list"));
  const b = JSON.stringify(rpc(2, "ping"));
  const { messages } = await session([], { raw: `${a}\n${b}\n` });
  ok(messages.filter((m) => m.id === 1 || m.id === 2).length === 2, "two messages in one write get two answers");
}
{
  const { messages } = await session([rpc(7, "tools/list"), rpc(8, "ping"), rpc(9, "tools/list")]);
  ok([7, 8, 9].every((i) => messages.some((m) => m.id === i)), "three in sequence all get answered");
}

console.log("\n── the rules that wedge a strict client ──");
{
  const { messages } = await session([
    { jsonrpc: "2.0", method: "notifications/initialized" },
    rpc(3, "ping"),
  ]);
  ok(!messages.some((m) => m.id === undefined || m.id === null), "a notification is never answered");
  ok(messages.some((m) => m.id === 3), "and the next request still is");
}
{
  const { messages } = await session([rpc(4, "no/such/method")]);
  ok(messages[0]?.error?.code === -32601, "an unknown method is a method-not-found error");
}
{
  const { messages } = await session([], { raw: "{not json\n" + JSON.stringify(rpc(5, "ping")) + "\n" });
  ok(messages.some((m) => m.error?.code === -32700), "a malformed line is a parse error");
  ok(messages.some((m) => m.id === 5), "and does not stop the messages after it");
}

console.log("\n── the tools ──");
{
  const { messages } = await session([rpc(1, "tools/list")]);
  const tools = messages[0].result.tools;
  const names = tools.map((t) => t.name).sort();
  ok(
    names.join(",") === "get_place,list_actions,list_categories,list_places,search_places",
    `five tools listed: ${names.join(", ")}`
  );
  ok(tools.every((t) => t.description && t.inputSchema?.type === "object"), "each has a description and an object schema");
  ok(
    tools.find((t) => t.name === "search_places").inputSchema.required.includes("query"),
    "search_places requires a query"
  );
}

console.log("\n── it answers from the real catalogue ──");
{
  const { messages } = await session([
    call(1, "list_categories"),
    call(2, "list_places"),
    call(3, "search_places", { query: "قهوة", limit: 5 }),
    call(4, "search_places", { query: "beach", limit: 3, kind: "place" }),
  ]);
  const cats = textOf(messages.find((m) => m.id === 1));
  ok(cats.categories.length === 8, `eight categories (${cats.categories.length})`);
  ok(
    cats.categories.reduce((n, c) => n + c.places, 0) === 52,
    "and their counts add up to all 52 places"
  );

  const all = textOf(messages.find((m) => m.id === 2));
  ok(all.count === 52, `list_places returns all 52 (${all.count})`);
  ok(all.places.every((p) => p.slug && p.name_ar && p.url.startsWith("https://www.wainkw.com/places/")),
    "every summary carries a slug, an Arabic name and a real url");

  const ar = textOf(messages.find((m) => m.id === 3));
  ok(ar.count > 0, `Arabic query «قهوة» returns results (${ar.count})`);
  ok(ar.results.length <= 5, "and respects the limit");

  const en = textOf(messages.find((m) => m.id === 4));
  ok(en.count > 0, `English query "beach" returns results (${en.count})`);
  ok(en.results.every((r) => r.kind === "place"), "and the kind filter holds");
}

console.log("\n── a tool failure is content, not a transport error ──");
{
  const { messages } = await session([
    call(1, "get_place", { slug: "kuwait-towers" }),
    call(2, "get_place", { slug: "no-such-place" }),
    call(3, "list_places", { category: "nonsense" }),
    call(4, "search_places", { query: "   " }),
  ]);
  const good = messages.find((m) => m.id === 1);
  ok(!good.error && good.result.isError === false, "a good call is not an error");
  ok(textOf(good).slug === "kuwait-towers", "and returns the record asked for");

  const missing = messages.find((m) => m.id === 2);
  ok(!missing.error, "a missing slug is NOT a JSON-RPC error");
  ok(missing.result.isError === true, "it is content flagged isError, which a model can read");
  ok(Array.isArray(textOf(missing).did_you_mean), "and it suggests near misses instead of ending the attempt");

  const badCat = messages.find((m) => m.id === 3);
  ok(badCat.result.isError === true && Array.isArray(textOf(badCat).known),
    "an unknown category lists the known ones");

  ok(messages.find((m) => m.id === 4).result.isError === true, "an empty query is refused");
}

console.log("\n── it agrees with the site's own search ──");
{
  // The point of bundling src/lib rather than keeping a copy: ask both the
  // same question and require the same answer. A JSON snapshot would pass this
  // on the day it was written and drift silently afterwards.
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { pathToFileURL } = await import("node:url");
  const tmp = mkdtempSync(join(tmpdir(), "wain-mcp-test-"));
  const entry = join(tmp, "e.mjs");
  const bundle = join(tmp, "b.mjs");
  writeFileSync(
    entry,
    `export { places } from ${JSON.stringify(join(ROOT, "src/lib/places.ts"))};\n` +
      `export { buildIndex, search } from ${JSON.stringify(join(ROOT, "src/lib/search.ts"))};\n` +
      `export { HUB_ACTIONS, WAIN_ORIGIN } from ${JSON.stringify(join(ROOT, "src/lib/wain-hub.ts"))};\n`
  );
  execFileSync(join(ROOT, "node_modules/.bin/esbuild"), [
    entry, "--bundle", "--format=esm", `--alias:@=${join(ROOT, "src")}`,
    `--outfile=${bundle}`, "--log-level=error",
  ], { cwd: ROOT, stdio: "pipe" });
  const site = await import(pathToFileURL(bundle).href);
  rmSync(tmp, { recursive: true, force: true });

  const idx = site.buildIndex(site.places);
  for (const q of ["قهوة هادية", "بحر", "متحف", "السالمية"]) {
    const direct = site.search(q, idx, { limit: 10 }).map((h) => h.doc.id);
    const { messages } = await session([call(1, "search_places", { query: q, limit: 10 })]);
    const viaMcp = textOf(messages[0]).results.map((r) => (r.kind === "place" ? `place:${r.slug}` : r.id));
    ok(
      JSON.stringify(direct) === JSON.stringify(viaMcp),
      `«${q}» — MCP returns exactly what the site's search returns (${direct.length})`
    );
  }

  // Same argument, applied to what wain can DO. The point of list_actions is
  // that a client and a visitor are offered one set under one set of names, so
  // the assertion is equality with the module the search hub draws from — not
  // a list retyped here, which would pass today and drift on the first change.
  {
    const { messages } = await session([call(1, "list_actions")]);
    const got = textOf(messages[0]).actions;
    ok(
      got.map((a) => a.id).join(",") === site.HUB_ACTIONS.map((a) => a.id).join(","),
      `list_actions is the hub's own list, in order (${got.map((a) => a.id).join(", ")})`
    );
    ok(
      got.every((a, i) => a.ar === site.HUB_ACTIONS[i].ar && a.what_ar === site.HUB_ACTIONS[i].hintAr),
      "and carries the same Arabic a visitor reads on the site"
    );
    ok(
      got.every((a, i) => a.url === site.WAIN_ORIGIN + site.HUB_ACTIONS[i].href),
      "every action url is absolute and trailing-slashed, so it can be opened as-is"
    );
    // A call happens in a browser. Saying so in `kind` is what stops a client
    // treating it as something it can perform.
    ok(got.some((a) => a.kind === "call") && got.some((a) => a.kind === "route"),
      "both kinds are present and told apart");
  }

  // Categories and areas used to come back as an id and a title with nothing to
  // open — the one result kind a client could see and not reach.
  {
    const { messages } = await session([call(1, "search_places", { query: "قهوة", limit: 10 })]);
    const nonPlaces = textOf(messages[0]).results.filter((r) => r.kind !== "place");
    ok(
      nonPlaces.length > 0 && nonPlaces.every((r) => r.url?.startsWith(site.WAIN_ORIGIN + "/")),
      `every non-place result carries a url (${nonPlaces.length} checked)`
    );
  }
}

console.log(
  failures.length
    ? `\n${passed} passed, ${failures.length} failed\n` + failures.map((f) => `  ✗ ${f}`).join("\n") + "\n"
    : `\n${passed} passed, 0 failed\nوين MCP: all checks passed\n`
);
process.exit(failures.length ? 1 : 0);
