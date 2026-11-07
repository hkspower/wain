#!/usr/bin/env node
// The Hostinger VPS connector — how a session starts a vps-deploy.mjs job.
//
// GO-LIVE.md, "Deploying to the VPS": `scripts/vps-deploy.mjs compose …`
// prints a one-shot Compose project, and it is started on 187.7.78.123 through
// the Hostinger API (vps_docker_create, project `sporta-deploy`), its log read
// back the same way. This file is what makes that API reachable as MCP tools.
// It runs Hostinger's own `hostinger-api-mcp` package, authenticating with an
// API token instead of a claude.ai OAuth sign-in, which lapses about daily.
//
// The token is saved as a network secret on the cloud environment, for the
// host developers.hostinger.com — never in this repository and never in an
// environment variable. See the placeholder below for how it gets used.
//
// One optional argument picks a SCOPED server from the same package:
// `node mcp/hostinger-mcp.mjs vps` runs `hostinger-vps-mcp`, which exposes
// the same three tools (search / execute / multi-execute) but can only find
// and run the VPS operations. That is what `hostinger-vps` in .mcp.json is.
// Scoping is the point, not a convenience: the unified server also reaches
// DNS, domains, billing and the old shared-hosting account, and a deploy
// session has no reason to hold any of that. Same token; the scope is the bin.
//
// The version is pinned: a range resolves to whatever was published last, at
// the moment a session starts, and an operation renamed upstream would break
// a deploy mid-sitting. Bump it on purpose.
import { spawn } from "node:child_process";

const VERSION = "3.31.1";

// The bins `hostinger-api-mcp@3.31.1` actually ships, read out of its
// package.json rather than guessed — an unknown group would make npx fail
// with a message about a missing executable, which reads like a broken
// install instead of a typo here.
const GROUPS = new Set([
  "agency-hosting", "agent-readiness", "billing", "dns", "domains", "ecommerce", "gpu",
  "horizons", "hosting", "mail", "reach", "vps", "wordpress",
]);

const group = process.argv[2];
if (group !== undefined && !GROUPS.has(group)) {
  process.stderr.write(
    `hostinger: unknown group «${group}» — one of: ${[...GROUPS].join(", ")}.\n`,
  );
  process.exit(1);
}
const bin = group ? `hostinger-${group}-mcp` : "hostinger-api-mcp";

// The token is normally NOT in this process at all: it is saved as a network
// secret on the cloud environment, and the egress proxy writes it into the
// Authorization header of every request to developers.hostinger.com. So an
// unset variable gets a placeholder rather than an exit — the package needs a
// non-empty value to skip its browser OAuth (which would hang here), and the
// proxy replaces whatever it sends. Where no secret is saved, the placeholder
// reaches Hostinger and comes back a 401: a clear failure, never a hang.
const env = { ...process.env };
if (!env.HOSTINGER_API_TOKEN?.trim()) env.HOSTINGER_API_TOKEN = "proxy-injected";

// `-p <pkg> <bin>`, not `<pkg>`: bare `npx <pkg>` runs only the package's
// default bin, and the scoped servers are its other entries.
const child = spawn("npx", ["-y", "-p", `hostinger-api-mcp@${VERSION}`, bin], {
  stdio: "inherit",
  env,
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
