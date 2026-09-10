#!/usr/bin/env node
/**
 * wain as an MCP server — the catalogue and its search, over stdio.
 *
 *   npm run mcp          # speaks JSON-RPC on stdin/stdout, for an MCP client
 *   npm run test:mcp     # drives it end to end
 *
 * `.mcp.json` at the repo root points Claude Code at this file, so opening the
 * repository is all it takes: no install step, no configuration, no key.
 *
 * ## Why there is no SDK here
 *
 * `@modelcontextprotocol/sdk` is the obvious choice and was tried first. It
 * pulls **68 packages** — express, hono, cors, body-parser, ajv, eventsource —
 * an entire HTTP server stack, into a project whose first documented principle
 * is that THERE IS NO SERVER, and onto every `npm ci` the deploy runs. All of
 * it to carry newline-delimited JSON-RPC between two pipes.
 *
 * So the transport is written out instead. It is genuinely small — a reader
 * that splits on newlines, and three methods — and `tests/mcp.test.mjs` drives
 * a real child process over real pipes rather than trusting that it is right.
 *
 * ## Why it bundles the TypeScript instead of re-reading the data
 *
 * The catalogue is `src/lib/places.ts` and the ranking is `src/lib/search.ts`,
 * both TypeScript. A parallel JSON copy would drift the first time somebody
 * edited one and not the other, and an answer here that disagreed with the
 * site would be worse than no answer — so this loads the REAL modules, bundled
 * once at startup with the local esbuild. Same pattern as
 * `scripts/audit-places.mjs`, and the same reason: never parse what you can
 * import.
 *
 * That means a client gets exactly what /search would show for the same words:
 * the same tokenizer, the same Arabic normalisation, the same scoring.
 *
 * ## And the same set of things to DO
 *
 * `src/lib/wain-hub.ts` is the site's list of what wain can do — browse, call
 * شوق, register a place — and it is drawn by `SearchHub`, which is what the
 * search button opens onto. `list_actions` is that list, bundled the same way,
 * so «what can wain do» has one answer whether it is asked over stdio or by
 * tapping the search button. Adding a row there adds it to both.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROTOCOL_VERSION = "2024-11-05";

/* ── load the site's own modules ──────────────────────────────────────────── */

const tmp = mkdtempSync(join(tmpdir(), "wain-mcp-"));
let places, categories, buildIndex, search, HUB_ACTIONS, WAIN_ORIGIN;
try {
  // The local esbuild, not `npx -y`: this starts on every client launch and
  // must not depend on the network or on a registry round-trip.
  const bin = join(ROOT, "node_modules/.bin/esbuild");
  if (!existsSync(bin)) {
    throw new Error("node_modules/.bin/esbuild is missing — run `npm ci` first");
  }
  const entry = join(tmp, "entry.mjs");
  const bundle = join(tmp, "wain.mjs");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    entry,
    `export { places, categories } from ${JSON.stringify(join(ROOT, "src/lib/places.ts"))};\n` +
      `export { buildIndex, search } from ${JSON.stringify(join(ROOT, "src/lib/search.ts"))};\n` +
      `export { HUB_ACTIONS, WAIN_ORIGIN } from ${JSON.stringify(join(ROOT, "src/lib/wain-hub.ts"))};\n`
  );
  execFileSync(bin, [
    entry, "--bundle", "--format=esm", `--alias:@=${join(ROOT, "src")}`,
    `--outfile=${bundle}`, "--log-level=error",
  ], { cwd: ROOT, stdio: "pipe" });
  ({ places, categories, buildIndex, search, HUB_ACTIONS, WAIN_ORIGIN } = await import(
    pathToFileURL(bundle).href
  ));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const index = buildIndex(places);

/* ── what a place looks like on the way out ───────────────────────────────── */

/**
 * Site-relative → absolute, from the site's own constant.
 *
 * Every url this server hands back is one a client may open, and the origin was
 * written out four times by hand. `wain-hub.ts` already had to hold it for the
 * same reason, so it holds it once.
 */
const absolute = (href) => `${WAIN_ORIGIN}${href}`;

/**
 * Trimmed deliberately. The full record carries menus, opening tables, salon
 * fields and art keys — thousands of tokens per place, most of it meaningless
 * without the site around it. A client asking "where is good for coffee" wants
 * the answer, not the schema, so the summary carries what identifies and
 * places a spot, and `get_place` is there when the whole record is the point.
 */
const summarise = (p) => ({
  slug: p.slug,
  name_ar: p.nameAr,
  name_en: p.nameEn,
  category: p.category,
  area_ar: p.areaAr,
  tagline_ar: p.taglineAr,
  url: absolute(`/places/${p.slug}/`),
});

const bySlug = new Map(places.map((p) => [p.slug, p]));

/* ── the tools ────────────────────────────────────────────────────────────── */

const TOOLS = [
  {
    name: "search_places",
    description:
      "Search wain's Kuwait catalogue the way the site's own search box does — same Arabic " +
      "normalisation, same tokenizer, same ranking. Accepts Arabic or English. Returns ranked " +
      "matches, which may be places, categories, areas or site pages.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for, in Arabic or English (e.g. «قهوة هادية», \"beach\")." },
        limit: { type: "integer", description: "Maximum results (default 10, max 40).", minimum: 1, maximum: 40 },
        kind: {
          type: "string",
          enum: ["place", "category", "area", "page"],
          description: "Restrict to one kind of result. Omit for all kinds.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_place",
    description:
      "The full record for one place by slug: hours, coordinates, price band, who it suits, " +
      "the season and time of day it is best, and whatever else the catalogue holds.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string", description: "Place slug, e.g. \"kuwait-towers\"." } },
      required: ["slug"],
    },
  },
  {
    name: "list_categories",
    description: "The eight categories wain sorts places into, with how many places each holds.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_places",
    description:
      "Every place, or every place in one category. Summaries only — use get_place for a full record.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Category id to filter by (see list_categories). Omit for all places.",
        },
      },
    },
  },
  {
    name: "list_actions",
    description:
      "What wain can do besides answer a search: browse the whole catalogue, register a Kuwait " +
      "business for free, or call Shouq — the site's Arabic-speaking guide — and ask out loud. " +
      "This is exactly the set the site's own search hub offers a visitor, from the same list, " +
      "so an answer here and the site cannot disagree. A \"call\" action happens in a browser " +
      "and cannot be placed from here; its url is the page that places it.",
    inputSchema: { type: "object", properties: {} },
  },
];

function callTool(name, args = {}) {
  switch (name) {
    case "search_places": {
      const query = String(args.query ?? "");
      if (!query.trim()) return { error: "query is empty" };
      const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 40);
      const kinds = args.kind ? [args.kind] : undefined;
      const hits = search(query, index, { limit, kinds });
      return {
        query,
        count: hits.length,
        results: hits.map((h) => {
          const place = h.doc.kind === "place" ? bySlug.get(h.doc.id.replace(/^place:/, "")) : null;
          return place
            ? { kind: "place", score: h.score, ...summarise(place) }
            : {
                kind: h.doc.kind,
                score: h.score,
                id: h.doc.id,
                title_ar: h.doc.titleAr ?? h.doc.title,
                // A category or an area used to come back as an id and a title
                // with no way to reach it — the one result kind a client could
                // see and not open. The doc has carried the url all along.
                url: absolute(h.doc.url),
              };
        }),
      };
    }
    case "get_place": {
      const place = bySlug.get(String(args.slug ?? ""));
      if (!place) {
        // Naming the near misses turns a dead end into the next move, which is
        // the whole difference between a tool a model can recover from and one
        // that ends the attempt.
        const near = search(String(args.slug ?? ""), index, { limit: 5, kinds: ["place"] })
          .map((h) => h.doc.id.replace(/^place:/, ""));
        return { error: `no place with slug "${args.slug}"`, did_you_mean: near };
      }
      return { ...place, url: absolute(`/places/${place.slug}/`) };
    }
    case "list_categories":
      return {
        categories: categories.map((c) => ({
          id: c.id,
          ar: c.ar,
          en: c.en,
          blurb_ar: c.blurbAr,
          places: places.filter((p) => p.category === c.id).length,
          url: absolute(`/explore/?category=${c.id}`),
        })),
      };
    case "list_places": {
      const cat = args.category ? String(args.category) : null;
      if (cat && !categories.some((c) => c.id === cat)) {
        return { error: `unknown category "${cat}"`, known: categories.map((c) => c.id) };
      }
      const list = cat ? places.filter((p) => p.category === cat) : places;
      return { count: list.length, category: cat, places: list.map(summarise) };
    }
    case "list_actions":
      return {
        actions: HUB_ACTIONS.map((a) => ({
          id: a.id,
          kind: a.kind,
          ar: a.ar,
          en: a.en,
          what_ar: a.hintAr,
          url: absolute(a.href),
        })),
      };
    default:
      return { error: `unknown tool "${name}"` };
  }
}

/* ── JSON-RPC over stdio ──────────────────────────────────────────────────── */

const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

function handle(msg) {
  const { id, method, params } = msg;
  // A notification has no id and MUST NOT be answered — replying to one is the
  // classic way to wedge a client that is strict about the spec.
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "wain", version: "1.2.0" },
      });
    case "notifications/initialized":
    case "initialized":
      return;
    case "tools/list":
      return reply(id, { tools: TOOLS });
    case "tools/call": {
      const name = params?.name;
      const result = callTool(name, params?.arguments ?? {});
      // Tool-level failures come back as content with isError, not as a
      // JSON-RPC error: the model is meant to read them and try again, and a
      // transport error is not something it can see.
      return reply(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: Boolean(result?.error),
      });
    }
    case "ping":
      return reply(id, {});
    default:
      if (!isNotification) fail(id, -32601, `unknown method "${method}"`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  // Split on newlines and keep the remainder: a message can arrive in pieces,
  // and two can arrive in one chunk. Reading whatever landed as one message is
  // the bug this loop exists to avoid.
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      fail(null, -32700, "parse error");
      continue;
    }
    try {
      handle(msg);
    } catch (e) {
      if (msg.id !== undefined && msg.id !== null) fail(msg.id, -32603, String(e?.message ?? e));
    }
  }
});
process.stdin.on("end", () => process.exit(0));
