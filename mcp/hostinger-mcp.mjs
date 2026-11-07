#!/usr/bin/env node
// The Hostinger connector, by API token instead of OAuth.
//
// `hosa` is a claude.ai connector signed in with OAuth, and its sign-in
// lapses: it has had to be reconnected by hand, about daily. That is the
// connector's session expiring, not anything on the account — every read it
// makes works again the moment it is reconnected — so nothing in this
// repository can stop it lapsing. What this file can do is not depend on it.
//
// Hostinger's own MCP server (`hostinger-api-mcp`, the same API surface
// hosa exposes) skips OAuth entirely when HOSTINGER_API_TOKEN is set, and an
// API token lives until the expiry chosen when it was created in hPanel. So
// with the token in the cloud environment, every session starts connected
// and stays connected — no browser, no reconnect.
//
// The token is saved as a network secret on the cloud environment, for the
// host developers.hostinger.com — never in this repository and never in an
// environment variable. See the placeholder below for how it gets used.
//
// One optional argument picks a SCOPED server from the same package:
// `node mcp/hostinger-mcp.mjs vps` runs `hostinger-vps-mcp`, which exposes
// the same three tools (search / execute / multi-execute) but can only find
// and run the VPS operations. That is what `hostinger-vps` in .mcp.json is.
// Scoping is the point, not a convenience: the unified server reaches the
// shared-hosting docroot and its static-archive deploy — the call CLAUDE.md
// says empties the folder first — and a session working on a VPS has no
// reason to hold that. The token is the same one; the scope is the binary.
//
// The version is pinned for the reason `@convai-widget-embed@1` taught: a
// range resolves to whatever was published last, at the moment a session
// starts. Bump it on purpose — both servers share the pin, so they cannot
// disagree about what an operation is called.
import { spawn } from "node:child_process";

const VERSION = "2.16.0";

// The bins `hostinger-api-mcp@2.16.0` actually ships, read out of its
// package.json rather than guessed — an unknown group would make npx fail
// with a message about a missing executable, which reads like a broken
// install instead of a typo here.
const GROUPS = new Set([
  "agency-hosting", "billing", "dns", "domains", "ecommerce",
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
