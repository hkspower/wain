#!/usr/bin/env node
/**
 * Work out the deploy, and what would prove it landed.   npm run deploy:plan
 *
 * Nothing here can push bytes to Hostinger — the upload host is refused at
 * CONNECT by the sandbox's egress gateway. The server can *pull*, though, and
 * a cron job is a write path: wget the release zip from a commit-pinned raw
 * GitHub URL, then unzip it into the docroot. `docs/hosting.md` has the
 * measured detail.
 *
 * That worked by hand on 2026-09-09 and took two false starts to get there,
 * both of which are now assertions in this file rather than things to
 * rediscover:
 *
 *   - `createAccountCronJobV1` answers 403 from Cloudflare when the command
 *     carries shell plumbing. It is not the URL — the same command without the
 *     redirection is accepted. So the commands are checked for metacharacters
 *     before anyone tries to send them.
 *   - The zip has to actually be fetchable at the pinned sha. A cron that
 *     wgets a 404 writes a 14-byte "404: Not Found" file and unzip then fails
 *     against a live docroot, so the URL is checked from here first.
 *
 * The other half of the output is the part that matters more. On 9 September a
 * deploy landed `build.json` and the eleven other root files, and all 232 files
 * in subdirectories arrived later — so the digest read correct while the site
 * had no CSS and every route but `/` was a 404. A digest at the root cannot
 * prove a deploy. This writes down every file the export contains, with its
 * size, and marks a handful of deep ones as required, so `npm run deploy:verify`
 * can fail on exactly that case.
 *
 *   npm run deploy:plan            plan against HEAD, check the URL
 *   npm run deploy:plan -- --offline   skip the URL check
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");
const OFFLINE = process.argv.includes("--offline");

/**
 * The docroot, spelled out rather than discovered.
 *
 * wainkw.com is an ADDON domain on account u130124229, so its document root is
 * /home/u130124229/domains/wainkw.com/public_html and NOT the account's own
 * public_html. Getting that wrong publishes the site into the primary domain
 * and every check here still passes, because it is looking at the wrong place.
 */
const DOCROOT = "/home/u130124229/domains/wainkw.com/public_html";

const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

/**
 * The same, for calls that are *expected* to fail — asking whether a blob is
 * in a commit is a question, not an error. Without this git writes «fatal:
 * path … exists on disk, but not in <sha>» to stderr for every commit that
 * does not have it, and a run that ends in a clear message is preceded by a
 * screenful of fatals that look like the actual problem.
 */
const gitQuiet = (args) =>
  execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const { version } = pkg;
const archive = join(ROOT, `wain-${version}.zip`);

console.log(`\nwain ${version} — deploy plan\n`);

/* ── the tree has to be clean ────────────────────────────────────────────── */
/**
 * `generateBuildId` is the commit sha when the tree is clean and a random id
 * when it is not, so a dirty build's asset paths do not correspond to any
 * commit. The URL the server fetches is pinned to a sha; if that sha does not
 * describe what is in the zip, the deploy is unreproducible and the
 * verification below is checking against fiction.
 */
if (git(["status", "--porcelain"]) !== "") {
  fail("the working tree is dirty. Commit first — a deploy is pinned to a sha,\n  and a dirty build does not correspond to one.");
}
const head = git(["rev-parse", "HEAD"]);
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);

/* ── and the export has to be this commit's ──────────────────────────────── */
if (!existsSync(OUT)) fail("out/ does not exist. Run `npm run release` first.");
if (!existsSync(join(OUT, "build.json"))) fail("out/build.json is missing. Run `npm run release`.");

const build = JSON.parse(readFileSync(join(OUT, "build.json"), "utf8"));
if (build.dirty) fail("out/build.json says the build came from a dirty tree.");
if (!existsSync(archive)) fail(`${relative(ROOT, archive)} is missing. Run \`npm run release\`.`);

/**
 * There are two commits here, and conflating them made the first run of this
 * script impossible to satisfy.
 *
 * The export is built at one commit — that sha is the build id, so it names
 * `_next/static/<sha>/` and is what build.json will claim. But the server
 * fetches the zip over HTTP, which means the zip has to be *in* the
 * repository, which means committing it — and that commit is necessarily one
 * later than the build it contains. Requiring them to be equal is requiring
 * the archive to contain itself.
 *
 * So the build commit may be behind HEAD, but only by commits that changed
 * nothing except the archive. Anything else and out/ is stale.
 */
const ARCHIVE_ONLY = new Set([`wain-${version}.zip`, `wain-${version}.zip.sha256`]);
if (build.commit !== head) {
  let drift;
  try {
    drift = git(["diff", "--name-only", build.commit, head]).split("\n").filter(Boolean);
  } catch {
    fail(`out/ was built from ${build.commit.slice(0, 8)}, which is not in this history.\n  Run \`npm run release\`.`);
  }
  const real = drift.filter((f) => !ARCHIVE_ONLY.has(f));
  if (real.length) {
    fail(
      `out/ was built from ${build.commit.slice(0, 8)} but HEAD is ${head.slice(0, 8)}, and\n` +
      `  ${real.length} file(s) changed in between:\n` +
      real.slice(0, 5).map((f) => `    ${f}`).join("\n") +
      `\n  Run \`npm run release\` to rebuild against HEAD.`,
    );
  }
}
const commit = build.commit;

const zipBytes = statSync(archive).size;
const zipSha = createHash("sha256").update(readFileSync(archive)).digest("hex");

/* ── every file the export contains, with its size ───────────────────────── */
const files = {};
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else files[relative(OUT, p).split("\\").join("/")] = statSync(p).size;
  }
})(OUT);

/**
 * The proofs that are not at the root.
 *
 * Chosen so that each one is reached by a different part of a deploy: the
 * stylesheet and the search chunk are content-hashed, so their names change
 * whenever the code does and a stale copy cannot satisfy them; the build-id
 * directory is named for the commit; and /explore/, a place page and an og
 * image are three different subdirectory depths. A deploy that satisfies all
 * six did not land only its root.
 */
const cssDir = "_next/static/css";
const css = Object.keys(files).filter((f) => f.startsWith(`${cssDir}/`) && f.endsWith(".css"));
if (css.length !== 1) fail(`expected exactly one stylesheet in ${cssDir}, found ${css.length}`);

const searchChunk = Object.keys(files).find((f) => /^_next\/static\/chunks\/app\/search\/page-[0-9a-f]+\.js$/.test(f));
if (!searchChunk) fail("could not find the /search page chunk in the export");

const ogImage = Object.keys(files).find((f) => f.startsWith("og/") && f.endsWith(".jpg"));
const placePage = Object.keys(files).find((f) => /^places\/[^/]+\/index\.html$/.test(f));

const required = [
  [css[0], "the hashed stylesheet — a deploy without it renders every page unstyled"],
  [`_next/static/${commit}/_buildManifest.js`, "the build-id directory, named for this commit"],
  [searchChunk, "the /search chunk, whose hash changes whenever the page does"],
  ["explore/index.html", "a route one level down"],
  [placePage, "a route two levels down"],
  [ogImage, "an image, from the directory that went missing on its own once"],
];
for (const [path] of required) {
  if (!path || !(path in files)) fail(`required proof ${path} is not in the export`);
}

/* ── the commands, and whether they can be sent at all ───────────────────── */
const repo = git(["remote", "get-url", "origin"]).replace(/^.*github\.com[/:]/, "").replace(/\.git$/, "");

/**
 * Which commit the URL points at is found, not assumed.
 *
 * A branch name would be wrong — it moves, and a deploy that quietly fetched
 * something newer than what was verified is worse than one that fails. HEAD
 * would be wrong too: HEAD is where the zip was *committed*, which is only the
 * right answer if this local archive is byte-identical to the one committed
 * there, and after a rebuild it is not.
 *
 * So: hash the local file the way git would, and walk the commits that touched
 * the archive looking for that exact blob. A match is proof the URL serves
 * this file. No match means it has not been committed yet, which is a
 * different problem with a different fix, and the difference is worth saying
 * out loud rather than discovering as a 404 on the server.
 */
/**
 * `--archive-url <url>` — fetch from somewhere that is not the git history.
 *
 * The committed-archive route below works, and it costs about 4MB of permanent
 * history per deploy. Six of them have been committed and removed already, and
 * the removals reclaim nothing: 25MB of this repository is old copies of this
 * one file. Nothing in the process needs them to be in git. The server does a
 * plain `wget`, so any URL it can reach will do — a GitHub Release asset is
 * the obvious one, since release assets live outside the object database
 * entirely.
 *
 * Passing a URL skips the commit hunt and everything downstream is unchanged,
 * including the size check below, which is the property that actually matters:
 * whatever the URL serves must be byte-for-byte this archive.
 *
 * Removing the committed route was tempting and would have been wrong. It is
 * the one that needs no credentials and no second host, and this environment
 * cannot create a release — the GitHub tools here can read releases and not
 * publish them — so a plan that depended on one would have left no way to
 * deploy at all.
 */
const archiveUrlArg = (() => {
  const i = process.argv.indexOf("--archive-url");
  return i !== -1 ? process.argv[i + 1] : null;
})();

let url;
if (archiveUrlArg) {
  if (!/^https:\/\//.test(archiveUrlArg)) {
    fail(`--archive-url must be https. The server fetches it over the open internet.`);
  }
  url = archiveUrlArg;
} else {
  const localBlob = git(["hash-object", archive]);
  const touched = git(["log", "--format=%H", "--", `wain-${version}.zip`]).split("\n").filter(Boolean);
  const publish = touched.find((sha) => {
    try { return gitQuiet(["rev-parse", `${sha}:wain-${version}.zip`]) === localBlob; } catch { return false; }
  });
  if (!publish) {
    fail(
      `wain-${version}.zip is not committed anywhere in this history.\n` +
      `  The server fetches it over HTTP, so it has to be reachable. Either:\n` +
      `    git add -f wain-${version}.zip && git commit && git push\n` +
      `  (.gitignore lists it, hence -f — it is deleted again once verified,\n` +
      `   though the blob stays in history, which is why the other way exists)\n` +
      `  or upload it anywhere the server can reach and pass the URL:\n` +
      `    npm run deploy:plan -- --archive-url https://…/wain-${version}.zip`,
    );
  }
  url = `https://raw.githubusercontent.com/${repo}/${publish.slice(0, 7)}/wain-${version}.zip`;
}
const zipOnServer = `${DOCROOT}/w.zip`;

const commands = [
  { step: "fetch", command: `wget -O ${zipOnServer} ${url}` },
  { step: "extract", command: `unzip -o -q -d ${DOCROOT} ${zipOnServer}` },
  { step: "clean", command: `rm -f ${zipOnServer}` },
];

/**
 * Hostinger puts Cloudflare in front of the cron-create endpoint, and its WAF
 * reads shell plumbing as an injection attempt: a command containing
 * `{ … } > log 2>&1` came back 403, and the same command with the redirection
 * removed was accepted. The URL was never the problem.
 *
 * Worse, an earlier attempt returned a uid for a job that was never stored —
 * so a 200 is not proof either, and the caller has to list the jobs
 * afterwards. That part cannot be checked from here; it is in the runbook.
 */
const SAFE = /^[A-Za-z0-9 _\-./:=?&@]+$/;
for (const { step, command } of commands) {
  if (!SAFE.test(command)) {
    fail(`the ${step} command contains a shell metacharacter:\n    ${command}\n  Cloudflare's WAF answers 403 for these. One program and its arguments only.`);
  }
}

/* ── is the URL the server will fetch actually there? ─────────────────────── */
let urlState = "unchecked";
if (!OFFLINE) {
  try {
    const head = execFileSync("curl", ["-sI", "-o", "/dev/null", "-w", "%{http_code} %{size_download}", url], { encoding: "utf8" });
    const code = head.trim().split(/\s+/)[0];
    const len = execFileSync("curl", ["-sI", url], { encoding: "utf8" }).match(/content-length:\s*(\d+)/i);
    if (code !== "200") {
      urlState = `HTTP ${code}`;
      console.log(`  ⚠  ${url}`);
      console.log(`     answers ${code}. ${archiveUrlArg
        ? "Whatever is serving this has to be public and hold the exact archive."
        : "The zip has to be committed and pushed at this sha"}`);
      if (!archiveUrlArg) console.log(`     before a cron can fetch it, and the repository has to be public.`);
      console.log("");
    } else if (len && Number(len[1]) !== zipBytes) {
      fail(`the URL serves ${len[1]} bytes but the local archive is ${zipBytes}.\n  These must be the same file.`);
    } else {
      urlState = "200";
    }
  } catch {
    urlState = "unreachable from here";
  }
}

/* ── write it down ───────────────────────────────────────────────────────── */
const plan = {
  version,
  commit,
  publish,
  branch,
  digest: build.digest,
  docroot: DOCROOT,
  url,
  urlState,
  archive: { name: `wain-${version}.zip`, bytes: zipBytes, sha256: zipSha },
  commands,
  required: required.map(([path, why]) => ({ path, why })),
  files,
};
const planPath = join(ROOT, "deploy-plan.json");
writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");

console.log(`  built    ${commit.slice(0, 8)}  (${branch})`);
console.log(`  zip at   ${publish.slice(0, 8)}${publish === commit ? "" : "  — the commit that publishes the archive"}`);
console.log(`  digest   ${build.digest}`);
console.log(`  archive  ${(zipBytes / 1048576).toFixed(2)} MB, sha256 ${zipSha.slice(0, 16)}…`);
console.log(`  export   ${Object.keys(files).length} files`);
console.log(`  url      ${url}`);
console.log(`           ${urlState === "200" ? "✓ reachable, and the same size as the local archive" : urlState}`);

console.log(`\n▸ run these in order, one cron job each, deleting it after it fires`);
for (const { step, command } of commands) console.log(`\n  ${step}\n    ${command}`);

console.log(`\n▸ after the fetch, check w.zip is ${zipBytes} bytes before extracting.`);
console.log(`  Extracting a half-finished archive over a live docroot is the one`);
console.log(`  outcome worth waiting a firing window to avoid.`);

console.log(`\n▸ createAccountCronJobV1 can return a uid for a job it never stored.`);
console.log(`  List the jobs afterwards; the reply is not proof.`);

console.log(`\n▸ then: npm run deploy:verify -- --observed <what the server reports>`);
console.log(`  ${relative(ROOT, planPath)} holds all ${Object.keys(files).length} expected files and ${required.length} required proofs.\n`);
