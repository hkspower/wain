// The files that let a shared link open the app: written only from real
// values, and served the way Apple and Google fetch them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appLinks, BUNDLE_ID } from "../scripts/gen-app-links.mjs";

let failed = 0;
const ok = (name, fn) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${e.message}`);
  }
};

const CERT = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":");

ok("nothing is written without both values", () => {
  assert.equal(appLinks({}).files, undefined);
  assert.equal(appLinks({ teamId: "ABCDE12345" }).files, undefined);
  assert.equal(appLinks({ certSha256: CERT }).files, undefined);
});

ok("a placeholder is refused, not written", () => {
  assert.equal(appLinks({ teamId: "TEAMID", certSha256: CERT }).files, undefined);
  assert.equal(appLinks({ teamId: "ABCDE12345", certSha256: "AA:BB" }).files, undefined);
  assert.equal(appLinks({ teamId: "<your team>", certSha256: "<sha>" }).files, undefined);
});

ok("the Apple file names the app and claims only /places/*", () => {
  const { files } = appLinks({ teamId: "ABCDE12345", certSha256: CERT });
  const aasa = JSON.parse(files["apple-app-site-association"]);
  assert.deepEqual(aasa.applinks.details[0].appIDs, [`ABCDE12345.${BUNDLE_ID}`]);
  assert.deepEqual(aasa.applinks.details[0].components, [{ "/": "/places/*" }]);
});

ok("the Android file names the package and the fingerprint, upper-cased", () => {
  const { files } = appLinks({ teamId: "ABCDE12345", certSha256: CERT.toLowerCase() });
  const [link] = JSON.parse(files["assetlinks.json"]);
  assert.equal(link.target.package_name, BUNDLE_ID);
  assert.deepEqual(link.target.sha256_cert_fingerprints, [CERT]);
  assert.deepEqual(link.relation, ["delegate_permission/common.handle_all_urls"]);
});

ok("two fingerprints (upload key and Play's signing key) are both kept", () => {
  const other = CERT.replace(/^00/, "FF");
  const { files } = appLinks({ teamId: "ABCDE12345", certSha256: `${CERT}, ${other}` });
  assert.equal(JSON.parse(files["assetlinks.json"])[0].target.sha256_cert_fingerprints.length, 2);
});

ok(".htaccess serves the extensionless Apple file as JSON", () => {
  const ht = readFileSync(new URL("../public/.htaccess", import.meta.url), "utf8");
  assert.match(ht, /<Files\s+"apple-app-site-association">\s*ForceType application\/json\s*<\/Files>/);
});

ok("the generated files are gitignored, so the deploy tree stays clean", () => {
  const gi = readFileSync(new URL("../.gitignore", import.meta.url), "utf8");
  assert.match(gi, /public\/\.well-known\/apple-app-site-association/);
  assert.match(gi, /public\/\.well-known\/assetlinks\.json/);
});

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\napp-links: all passed");
