#!/usr/bin/env node
/**
 * Work out the deploy, and what would prove it landed.   npm run deploy:plan
 *
 * Nothing here can push bytes to Hostinger — the upload host is refused at
 * CONNECT by the sandbox's egress gateway. The server can *pull*, though, and
 * a cron job is a write path. The deploy itself is one command now: an
 * installed caller signs a request to the site's own endpoint over the
 * loopback, and GitHub is not in it. `docs/hosting.md` has the measured detail.
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

/**
 * The installed caller, which is what makes a deploy stop touching GitHub.
 *
 * Every deploy used to begin `wget -qO d.php https://raw.githubusercontent.com/…`
 * and end `rm -f d.php`, so the recurring path ran through a host that has
 * nothing to do with this server, in three or four cron jobs where one would
 * do. `php d.php install` puts it beside the secret it reads — storage/, which
 * is outside public_html and the one directory deploy.php never prunes — and
 * from then on a deploy is one command naming this path.
 *
 * Sibling of the docroot, not derived by walking up from it, because
 * `dirname()` on a path this exact is the kind of cleverness that silently
 * resolves one level wrong — which is the bug `setup-staging-endpoint.php`
 * exists to avoid in the endpoint itself.
 */
const INSTALLED = "/home/u130124229/domains/wainkw.com/storage/d.php";

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
// Located by extension, not by directory. Next 15 put the stylesheet in
// `_next/static/css/`, Next 16 puts it in `_next/static/chunks/` — and a
// required proof that names a directory the framework has since renamed does
// not fail loudly, it fails as "expected exactly one stylesheet, found 0",
// which reads like the build lost its CSS.
const css = Object.keys(files).filter((f) => f.startsWith("_next/static/") && f.endsWith(".css"));
if (css.length !== 1) fail(`expected exactly one stylesheet under _next/static, found ${css.length}`);

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
/** The commit that serves the archive, or null when it is hosted elsewhere. */
let publish = null;
if (archiveUrlArg) {
  if (!/^https:\/\//.test(archiveUrlArg)) {
    fail(`--archive-url must be https. The server fetches it over the open internet.`);
  }
  url = archiveUrlArg;
} else {
  const localBlob = git(["hash-object", archive]);
  const touched = git(["log", "--format=%H", "--", `wain-${version}.zip`]).split("\n").filter(Boolean);
  publish = touched.find((sha) => {
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
/**
 * The route is the server calling its own deploy endpoint over the loopback.
 *
 * This used to be `wget` the zip and `unzip -o` it straight over the live
 * docroot, which is what `public_html/api/deploy.php` was written to replace —
 * its own header says so. That endpoint was skipped for months on the belief
 * that it could not be reached, because www.wainkw.com is refused at CONNECT by
 * the sandbox gateway. That was a confusion between "unreachable from the
 * session" and "unreachable": sporta's eight cron jobs have always called their
 * own site as `--header=Host:… https://127.0.0.1/api/…`, and the same shape
 * reaches wain. Proved with a GET that returned deploy.php's own 405 body.
 *
 * What that buys over unzip: the artifact is checksum-verified before anything
 * is written, staged outside the web root rather than expanded onto it, refused
 * if it contains .php or a traversal or one of the PHP application's
 * directories, and — the one this repository paid for by hand — pruned against
 * the previous manifest, so a deploy no longer leaves the last build's chunks
 * behind forever.
 *
 * One cron job, now that the caller is installed rather than fetched. It was
 * three or four: fetch, maybe allow, deploy, clean. The command field caps
 * between 210 and 279 characters, which is why fetch-and-run could never be
 * one line — and the absolute path to the installed caller is 49 characters,
 * so a deploy command carrying it, a release URL, a 64-character digest and a
 * version still fits inside 210 with room to spare.
 */
const callerUrl = `https://raw.githubusercontent.com/${repo}/${commit}/scripts/publish/deploy-call.php`;

/**
 * deploy.php's ALLOWED_HOSTS is GitHub-only. `storage/deploy.hosts` extends it,
 * which is the whole reason that file exists — so that hosting the archive
 * elsewhere does not mean editing an endpoint inside public_html.
 *
 * The `allow` step writes that file through the caller rather than a shell
 * redirection, and that is not a stylistic choice: `printf … > deploy.hosts`
 * contains a `>`, which is exactly the plumbing the WAF rule below refuses. The
 * one-liner reads fine and cannot be run as a cron job at all.
 */
const artifactHost = new URL(url).hostname;
const hostAllowedByDefault = ["raw.githubusercontent.com", "github.com", "codeload.github.com"]
  .includes(artifactHost);

/**
 * The recurring deploy: one command, no GitHub, nothing to clean up.
 *
 * `allow` is in the list only when the artifact is somewhere deploy.php's
 * built-in ALLOWED_HOSTS does not cover. It is idempotent — the caller answers
 * `already_listed` and writes nothing — so leaving it in on a later run of the
 * same plan costs a cron firing and changes nothing.
 */
const commands = [
  ...(hostAllowedByDefault
    ? []
    : [{ step: "allow the host", command: `php ${INSTALLED} allow ${artifactHost}` }]),
  { step: "deploy", command: `php ${INSTALLED} ${url} ${zipSha} ${version}` },
];

/**
 * The one-time route, which is also the only way to write to this account from
 * here: the server fetches a commit-pinned file and runs it. Needed again only
 * when scripts/publish/deploy-call.php changes — which `version` below is how
 * anyone finds out about, since storage/ is outside the docroot and no read
 * tool in a session can see what is installed there.
 */
const bootstrap = [
  { step: "fetch the caller", command: `wget -qO d.php ${callerUrl}` },
  { step: "install it", command: `php d.php install` },
  { step: "clean", command: `rm -f d.php` },
];

/** Ask the server which caller it has. Compare with `callerFingerprint`. */
const checkCommand = `php ${INSTALLED} version`;

const callerFingerprint = createHash("sha256")
  .update(readFileSync(join(ROOT, "scripts/publish/deploy-call.php")))
  .digest("hex")
  .slice(0, 16);

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

/**
 * The command field also has a length cap, which is a 422 rather than a 403 and
 * so looks nothing like the WAF refusal above. Measured while clearing stale
 * build files: two 101-character paths plus `rm -rf ` went through, three did
 * not. So the ceiling is above 210 and below 279, and 210 is the largest length
 * actually observed to work. A long artifact URL is the realistic way to exceed
 * it — the deploy command carries a URL, a 64-character digest and a version.
 */
const MAX_COMMAND = 210;
for (const { step, command } of [...commands, ...bootstrap, { step: "check", command: checkCommand }]) {
  if (!SAFE.test(command)) {
    fail(`the ${step} command contains a shell metacharacter:\n    ${command}\n  Cloudflare's WAF answers 403 for these. One program and its arguments only.`);
  }
  if (command.length > MAX_COMMAND) {
    fail(
      `the ${step} command is ${command.length} characters, past the ${MAX_COMMAND} that is\n` +
      `  known to be accepted — createAccountCronJobV1 answers 422, not 403, so it\n` +
      `  will not look like the WAF rule above. Shorten the URL it carries:\n    ${command}`,
    );
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
  caller: { path: INSTALLED, fingerprint: callerFingerprint, url: callerUrl },
  commands,
  bootstrap,
  check: checkCommand,
  required: required.map(([path, why]) => ({ path, why })),
  files,
};
const planPath = join(ROOT, "deploy-plan.json");
writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n");

console.log(`  built    ${commit.slice(0, 8)}  (${branch})`);
console.log(publish
  ? `  zip at   ${publish.slice(0, 8)}${publish === commit ? "" : "  — the commit that publishes the archive"}`
  : `  zip at   hosted outside the repository — nothing enters history`);
console.log(`  digest   ${build.digest}`);
console.log(`  archive  ${(zipBytes / 1048576).toFixed(2)} MB, sha256 ${zipSha.slice(0, 16)}…`);
console.log(`  export   ${Object.keys(files).length} files`);
console.log(`  url      ${url}`);
console.log(`           ${urlState === "200" ? "✓ reachable, and the same size as the local archive" : urlState}`);

console.log(`  caller   ${callerFingerprint}  installed at ${INSTALLED}`);

console.log(`\n▸ run these in order, one cron job each, deleting it after it fires`);
for (const { step, command } of commands) console.log(`\n  ${step}\n    ${command}`);

console.log(`\n▸ that is the whole deploy. It fetches nothing from GitHub and leaves`);
console.log(`  nothing behind, because the caller is installed on the server rather`);
console.log(`  than wget'd at the head of every deploy and rm'd at the end of it.`);
console.log(`  Only the artifact still comes over the internet, and only because no`);
console.log(`  session can push bytes to this account at all.`);

console.log(`\n▸ if the caller is NOT installed yet, or scripts/publish/deploy-call.php`);
console.log(`  has changed since it was, run this once first — it is the same`);
console.log(`  fetch-pin-run write path, used once instead of every time:`);
for (const { step, command } of bootstrap) console.log(`\n  ${step}\n    ${command}`);

console.log(`\n▸ storage/ is outside the docroot, so nothing here can read what is`);
console.log(`  installed. Ask the server instead, and compare with ${callerFingerprint}:`);
console.log(`\n    ${checkCommand}`);

if (!hostAllowedByDefault) {
  console.log(`\n▸ ${artifactHost} is not in deploy.php's ALLOWED_HOSTS, which is why`);
  console.log(`  the «allow the host» step is in the list — without it the endpoint`);
  console.log(`  answers host_not_allowed. It writes one line to storage/deploy.hosts,`);
  console.log(`  outside public_html, and survives any later edit of the endpoint.`);
}

/**
 * Serving the artifact from wainkw.com's own docroot is the intended
 * arrangement — see "Where the artifact goes" in docs/hosting.md — but the
 * site's own `.htaccess` denies `.zip`, so the obvious filename 403s and the
 * deploy stops at download_failed. The endpoint reads the bytes with
 * ZipArchive and never looks at the name, so the fix is the extension.
 *
 * The check covers the other domains on the account too, not to invite hosting
 * there — that mixes one project's artifact into another project's web root —
 * but because pointing at one by mistake fails the same way, for the same
 * reason, and the error the endpoint returns says only "403".
 */
if (/\.(zip|tar|gz|bak|sql|log|json|sh|env|md|ts|mjs)$/i.test(new URL(url).pathname)
    && /(^|\.)(wainkw\.com|sporta\.com\.kw|mawsoool\.com|almuhallab-code\.com)$/i.test(artifactHost)) {
  console.log(`\n▸ ${artifactHost} denies this extension in .htaccess, so the fetch`);
  console.log(`  would be a 403 and the deploy would stop at download_failed. wain's own`);
  console.log(`  rule names bak|zip|db|sqlite; the shop's names zip|tar|gz and more.`);
  console.log(`  Rename the uploaded file to something on no deny list (.bin) and pass`);
  console.log(`  that URL — the endpoint never reads the name, only the bytes.`);
}

console.log(`\n▸ the half-download trap is gone: deploy.php verifies sha256 against`);
console.log(`  ${zipSha.slice(0, 16)}… before it writes anything, and stages outside`);
console.log(`  the web root. A truncated fetch is a 422, not a broken site.`);

console.log(`\n▸ read the reply with getCronJobOutputV1. {"ok":true,...} carries the`);
console.log(`  file counts; anything else names the step that refused and why.`);
console.log(`  \`php ${INSTALLED} probe\` first if you want the`);
console.log(`  signature checked on its own —`);
console.log(`  it is refused at the host check, which is after the HMAC.`);

console.log(`\n▸ createAccountCronJobV1 can return a uid for a job it never stored,`);
console.log(`  and deleteAccountCronJobV1 can accept a delete it does not perform.`);
console.log(`  List the jobs after both; neither reply is proof.`);

console.log(`\n▸ then: npm run deploy:verify -- --observed <what the server reports>`);
console.log(`  ${relative(ROOT, planPath)} holds all ${Object.keys(files).length} expected files and ${required.length} required proofs.\n`);
