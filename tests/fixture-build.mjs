/**
 * A build with a menu in it, for the suites that need one.
 *
 * No shipped place has a menu — inventing a price list for a real café and
 * showing it to customers who will be charged at that café's counter is not
 * something wain should do — so the order panel never renders on the
 * production build and its browser suites skip. These helpers give one
 * existing place a three-item menu in a **git worktree** (a clean checkout of
 * HEAD plus the working tree's uncommitted files, patched there and never
 * here, because a test that edits places.ts in place leaves it edited when
 * somebody kills the run), build it with whatever environment the caller
 * wants, and serve the export.
 *
 * Three suites share this: the journey (the default `/api/wain.php` on the
 * test's own origin, so Playwright plays the server), the back-end run (the
 * same build with the real PHP answering) and the WhatsApp order flow (the
 * back end switched off, and the place carries `orderWhatsApp`). Extracted from
 * run-journey.mjs on 3 October, when the second one was written — a second
 * copy of the worktree dance would have drifted from the first the way every
 * duplicated helper in this repository has.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The place the fixture gives a menu to. */
export const FIXTURE_SLUG = "mubarakiya-tea-houses";
/** A second place given a menu and consent but NO number: the shape
 *  audit:places refuses in the catalogue, which is exactly why a test build
 *  is the only place it can be seen. */
export const FIXTURE_SLUG_NO_NUMBER = "souq-al-mubarakiya";
export const FIXTURE_WHATSAPP = "51234567";

export const FIXTURE_MENU = `
    acceptsOrders: true,
    orderPrepMinutes: 15,
    orderNoteAr: "الاستلام من الكاشير.",
    menuAr: [
      { id: "m1", nameAr: "چاي كرك", priceFils: 250 },
      { id: "m2", nameAr: "قهوة عربية", priceFils: 500 },
      { id: "m3", nameAr: "كيك اليوم", priceFils: 1750, soldOut: true },
    ],`;

function inject(tree, slug, fields) {
  const p = join(tree, "src/lib/places.ts");
  const s = readFileSync(p, "utf8");
  const anchor = `    slug: "${slug}",`;
  if (!s.includes(anchor)) throw new Error(`fixture place ${slug} not found in places.ts`);
  writeFileSync(p, s.replace(anchor, `${anchor}${fields}`));
}

/**
 * Check HEAD out into `tree`, carry the uncommitted files across, patch the
 * catalogue and build. Returns the export directory. Throws on a failed build.
 *
 * `whatsapp`: give the fixture place a number (and a second place a menu
 * with none). `env`: extra build-time variables, e.g. NEXT_PUBLIC_WAIN_BACKEND.
 */
export function buildFixture({ tree, whatsapp = false, env = {} }) {
  rmSync(tree, { recursive: true, force: true });
  spawnSync("git", ["worktree", "prune"], { cwd: ROOT, stdio: "ignore" });
  const wt = spawnSync("git", ["worktree", "add", "--detach", tree, "HEAD"], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
  });
  if (wt.status !== 0) throw new Error("could not create the worktree:\n" + (wt.stderr || wt.stdout));

  // The worktree is a checkout of HEAD, so anything uncommitted has to be
  // carried over by hand or the suite tests yesterday's code. `git diff HEAD`
  // alone lists modified *tracked* files and says nothing about new ones — a
  // change that adds a component and imports it from a page carried the page
  // across without the component, and the build failed with "Module not
  // found" for a file sitting right there. --others adds the untracked files,
  // --exclude-standard keeps node_modules and everything .gitignore rules out.
  const changed = spawnSync("git", ["diff", "HEAD", "--name-only"], { cwd: ROOT, encoding: "utf8" })
    .stdout.trim().split("\n").filter(Boolean);
  const untracked = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" })
    .stdout.trim().split("\n").filter(Boolean);
  const dirty = [...new Set([...changed, ...untracked])];
  for (const f of dirty) {
    if (!existsSync(join(ROOT, f))) {
      // Deleted here, still at HEAD: the worktree would keep the file, and a
      // module nobody imports any more can still fail the type check (the
      // old supabase.ts did, once its package was gone from node_modules).
      rmSync(join(tree, f), { force: true });
      continue;
    }
    mkdirSync(dirname(join(tree, f)), { recursive: true });
    copyFileSync(join(ROOT, f), join(tree, f));
  }
  if (dirty.length) console.log(`  carried ${dirty.length} uncommitted file(s) across`);
  symlinkSync(join(ROOT, "node_modules"), join(tree, "node_modules"));

  inject(tree, FIXTURE_SLUG, whatsapp ? `${FIXTURE_MENU}\n    orderWhatsApp: "${FIXTURE_WHATSAPP}",` : FIXTURE_MENU);
  console.log(`  gave ${FIXTURE_SLUG} a three-item menu${whatsapp ? ` and the number ${FIXTURE_WHATSAPP}` : ""}`);
  if (whatsapp) {
    inject(tree, FIXTURE_SLUG_NO_NUMBER, FIXTURE_MENU);
    console.log(`  and ${FIXTURE_SLUG_NO_NUMBER} a menu with no number`);
  }

  // A plain `next build`: the production script's extra steps (the vendored
  // widget, the stand-in prune, the service worker) are about shipping, not
  // about what a page renders.
  const build = spawnSync("npx", ["next", "build"], {
    cwd: tree,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (build.status !== 0) throw new Error("fixture build failed");
  return join(tree, "out");
}

export function removeFixture(tree) {
  rmSync(tree, { recursive: true, force: true });
  spawnSync("git", ["worktree", "prune"], { cwd: ROOT, stdio: "ignore" });
}

const MIME = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain",
  ".xml": "application/xml", ".avif": "image/avif", ".webp": "image/webp",
};

/** Serve a static export the way the host does: `/x/` → `/x/index.html`.
 *  Resolves to a function that stops the server. */
export async function serveDir(out, port) {
  const { createServer } = await import("node:http");
  const server = createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p.endsWith("/")) p += "index.html";
    let f = join(out, p);
    if (!existsSync(f) && existsSync(f + ".html")) f += ".html";
    if (!existsSync(f) || !f.startsWith(out)) { res.writeHead(404); return res.end("nope"); }
    res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return () => server.close();
}
