#!/usr/bin/env node
/**
 * PreToolUse guard for the Hostinger connector (`mcp__hosa__execute` and
 * `mcp__hosa__multi-execute`).
 *
 * Every Hostinger operation goes through those two tools, so a permission
 * rule can only say yes or no to ALL of them — deleting a website and listing
 * a cron job look the same to settings.json. That is why the old
 * `deny: mcp__hosa__hosting_deployStaticSiteArchiveV1` never matched anything:
 * no tool has that name; it is an `operation` argument. This reads the
 * argument instead.
 *
 * - The deploy routine (cron jobs, reading the docroot, purging the cache) is
 *   allowed, so a deploy is one approval rather than one per call — asked for
 *   2 October: «make one time approve for whole task».
 * - Anything that replaces a docroot from an archive is denied: it empties the
 *   folder first (CLAUDE.md, «Never use … deploy static archive»).
 * - Every other operation still asks.
 */
const SAFE = new Set([
  "hosting_cron-jobs_list",
  "hosting_cron-jobs_create",
  "hosting_cron-jobs_delete",
  "hosting_cron-jobs_output",
  "hosting_files_list-website-and-directories",
  "hosting_files_website-content",
  "hosting_cache_clear-website",
]);
const NEVER = /deploy-static-site-archive|import-website-from-archive|deployStaticSiteArchive/i;

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || "{}");

// execute carries one `operation`; multi-execute carries several, nested.
// Collecting every `operation` string anywhere in the input covers both
// without depending on multi-execute's exact shape.
const ops = [];
(function walk(v) {
  if (Array.isArray(v)) return v.forEach(walk);
  if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      if (k === "operation" && typeof x === "string") ops.push(x);
      else walk(x);
    }
})(input.tool_input ?? {});

const decide = (permissionDecision, reason) => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason: reason },
    })
  );
  process.exit(0);
};

if (ops.some((o) => NEVER.test(o)))
  decide("deny", "Replacing the docroot from an archive empties it first — deploy through storage/d.php instead (CLAUDE.md).");
if (ops.length && ops.every((o) => SAFE.has(o)))
  decide("allow", `deploy routine: ${ops.join(", ")}`);
decide("ask", ops.length ? `not in the deploy routine: ${ops.join(", ")}` : "no operation named");
