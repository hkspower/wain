#!/usr/bin/env node
/**
 * Registration's own rules:  npm run test:register
 *
 * The form asks for four things and fills two more on the way out, and those
 * two are the whole reason this file exists. `submissions.ts` imports the
 * Supabase client through the `@` alias, so the test is bundled before it is
 * run — the same shape as the logic layers in run-orders.mjs.
 *
 * There is no browser layer here on purpose. Sending a real submission needs
 * Supabase credentials, and a test that silently skips when they are absent
 * reports a pass for a thing it never did. What can be checked without a
 * backend is checked here; the rest is `docs/business-registration.md`.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const run = (cmd, args) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
  });

const tmp = mkdtempSync(join(tmpdir(), "wain-register-"));
const bundle = join(tmp, "registration.mjs");

console.log("\n════ التسجيل: what the owner must write, and what we write for them ════");
if ((await run("npx", ["esbuild", "tests/registration.test.mjs", "--bundle", "--format=esm",
      `--alias:@=${join(ROOT, "src")}`, `--outfile=${bundle}`, "--log-level=error"])) !== 0) {
  console.error("could not bundle tests/registration.test.mjs");
  process.exit(1);
}
const code = await run("node", [bundle]);
rmSync(tmp, { recursive: true, force: true });

console.log(code === 0 ? "\nالتسجيل: all suites passed" : "\n1 suite(s) failed");
process.exit(code === 0 ? 0 : 1);
