#!/usr/bin/env node
/**
 * The local gate and release, in order, stopping at the first failure.
 *   npm run ship            scan → release (→ widget CSP check on an agent build)
 *   npm run ship -- --plan  deploy:plan, once the archive is committed and pushed
 *
 * There is no CI on this project: the owner ruled out GitHub Actions (CLAUDE.md,
 * «Never use GitHub for wain»), and the deploy is a signed call the server makes
 * to itself. So the only thing standing between a red tree and the live site is
 * running the same steps by hand, in the same order, every time. This is that.
 *
 * It never uploads, pushes or touches Hostinger. The deploy is a separate,
 * confirmed step — see «Deploying» in CLAUDE.md.
 *
 * The build variables are read from the environment and must be chosen on
 * purpose: the live site is an AGENT build, and a free build would switch both
 * agents off for every visitor. With neither id set it stops, unless you pass
 * --free, so an empty shell cannot ship a free build by accident.
 */
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const run = (label, cmd, cmdArgs, env = {}) => {
  console.log(`\n── ${label}`);
  const r = spawnSync(cmd, cmdArgs, { stdio: "inherit", env: { ...process.env, ...env } });
  if (r.status !== 0) {
    console.error(`\nship stopped: «${label}» failed (exit ${r.status ?? r.signal}). Nothing after it ran.`);
    process.exit(r.status || 1);
  }
};
const out = (cmd, cmdArgs) =>
  spawnSync(cmd, cmdArgs, { encoding: "utf8" }).stdout.trim();

const BRANCH = "claude/wainkw-design-issues-2bggdi";
const branch = out("git", ["branch", "--show-current"]);
if (branch !== BRANCH) {
  console.error(`ship stopped: on «${branch || "a detached HEAD"}», the working branch is ${BRANCH}.`);
  process.exit(1);
}

if (args.has("--plan")) {
  run("deploy:plan", "npm", ["run", "deploy:plan"]);
  console.log("\nPlan printed. The deploy itself is a confirmed step: one cron job through the installed caller, read at its first firing, deleted, then deploy:verify.");
  process.exit(0);
}

if (out("git", ["status", "--porcelain"])) {
  console.error("ship stopped: the working tree is not clean. The build id is the commit, and a dirty tree makes it random, which deploy:verify cannot prove.");
  process.exit(1);
}

const shouq = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "";
const salem = process.env.NEXT_PUBLIC_ELEVENLABS_SALEM_AGENT_ID || "";
const agent = Boolean(shouq && shouq !== "none") || Boolean(salem && salem !== "none");
if (!agent && !args.has("--free")) {
  console.error(
    "ship stopped: no agent id is set, so this would be a FREE build. The live site is an agent build:\n" +
      "  NEXT_PUBLIC_ELEVENLABS_AGENT_ID=agent_1701m1gcrccrethae9y3nyv1e116 \\\n" +
      "  NEXT_PUBLIC_ELEVENLABS_SALEM_AGENT_ID=agent_5101m4wwgr3ae5qat412ezcnffhn \\\n" +
      "  NEXT_PUBLIC_WAIN_TTS_URL=none npm run ship\n" +
      "Pass --free only when a free build is what you mean.");
  process.exit(1);
}
console.log(agent ? "Build: AGENT (ids from the environment)." : "Build: FREE (--free).");

run("npm run scan", "npm", ["run", "scan"]);
run("npm run release", "npm", ["run", "release"]);
if (agent) {
  run("npm run test:widget-csp", "npm", ["run", "test:widget-csp"], {
    CHROMIUM_PATH: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  });
}

console.log(`
ship: green. The archive is built and gated; nothing has been uploaded or pushed.
Next, by hand:
  1. git add the archive and commit it, then git push origin ${BRANCH}
  2. npm run ship -- --plan
  3. the deploy: one cron job per stage, read at its first firing, deleted, listed
  4. npm run deploy:verify -- --observed <readings>.json, then the cache purge and the edge reads`);
