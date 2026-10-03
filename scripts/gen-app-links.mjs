#!/usr/bin/env node
/**
 * The two files that let a shared wainkw.com link open the app instead of the
 * browser:   npm run app:links
 *
 *   public/.well-known/apple-app-site-association   (iOS universal links)
 *   public/.well-known/assetlinks.json              (Android App Links)
 *
 * Both name the app by something only the owner has: Apple's Team ID, and the
 * SHA-256 of the certificate that signs the Android release. They come in as
 * APPLE_TEAM_ID and ANDROID_CERT_SHA256 (GitHub repository variables in CI —
 * see flutter_app/docs/app-links.md) and NOTHING is written without both
 * looking real: a placeholder in either file is worse than no file, because
 * the platforms fetch it once, cache the refusal, and the link goes on opening
 * the browser with nothing anywhere saying why.
 *
 * The files are output, so they are gitignored: deploy.yml asserts a clean
 * tree before it builds, and a build step that writes into public/ would
 * otherwise cost the deploy its commit-named build id (CLAUDE.md, «A feature
 * that dirties the tree disables the build-id proof»).
 *
 * Only /places/* and /pick/* are claimed. Those are the links people forward —
 * a «رسّلها للربع» plan and a «خلّهم يختارون» shortlist (3 October); claiming
 * the whole site would send a visitor who meant the website into the app.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const BUNDLE_ID = "com.wainkw.app";
export const PATHS = ["/places/*", "/pick/*"];

const TEAM = /^[A-Z0-9]{10}$/;
const CERT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** Both files' content, or the reasons there are none. Pure, for the test. */
export function appLinks({ teamId, certSha256 }) {
  const team = (teamId ?? "").trim();
  const certs = (certSha256 ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  const problems = [];
  if (!TEAM.test(team)) problems.push("APPLE_TEAM_ID is not a 10-character Team ID");
  if (!certs.length || !certs.every((c) => CERT.test(c))) {
    problems.push("ANDROID_CERT_SHA256 is not one or more AA:BB:… SHA-256 fingerprints");
  }
  if (problems.length) return { problems };
  const aasa = {
    applinks: {
      details: [
        {
          appIDs: [`${team}.${BUNDLE_ID}`],
          components: PATHS.map((p) => ({ "/": p })),
        },
      ],
    },
  };
  const assetlinks = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: BUNDLE_ID,
        sha256_cert_fingerprints: certs,
      },
    },
  ];
  return {
    problems: [],
    files: {
      "apple-app-site-association": JSON.stringify(aasa, null, 2) + "\n",
      "assetlinks.json": JSON.stringify(assetlinks, null, 2) + "\n",
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { problems, files } = appLinks({
    teamId: process.env.APPLE_TEAM_ID,
    certSha256: process.env.ANDROID_CERT_SHA256,
  });
  if (problems.length) {
    // Not a failure: until the owner sets both values, links open the site,
    // which is what they have always done.
    console.log(`app-links: nothing written — ${problems.join("; ")}`);
    process.exit(0);
  }
  const dir = join(root, "public/.well-known");
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(dir, name), body);
  }
  console.log(`app-links: wrote ${Object.keys(files).join(" and ")} to public/.well-known/`);
}
