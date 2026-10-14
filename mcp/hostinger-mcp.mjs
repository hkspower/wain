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
// Two things must be true, both set in the environment's settings and never
// in this repository:
//   - HOSTINGER_API_TOKEN, as an environment variable;
//   - developers.hostinger.com under Allowed domains. The sandbox's egress
//     gateway refuses it at CONNECT today (403), measured 14 October; hosa
//     works without it only because its calls leave from claude.ai's side.
//
// Without the token this exits at once rather than starting the package's
// OAuth fallback, which opens a browser this container does not have and
// would hang the server until the client gave up on it.
//
// The version is pinned for the reason `@convai-widget-embed@1` taught: a
// range resolves to whatever was published last, at the moment a session
// starts. Bump it on purpose.
import { spawn } from "node:child_process";

const VERSION = "2.16.0";

if (!process.env.HOSTINGER_API_TOKEN?.trim()) {
  process.stderr.write(
    "hostinger: HOSTINGER_API_TOKEN is not set — use the hosa connector, " +
      "or add the token to the cloud environment's variables.\n",
  );
  process.exit(1);
}

const child = spawn("npx", ["-y", `hostinger-api-mcp@${VERSION}`], {
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
