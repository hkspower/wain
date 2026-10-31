#!/usr/bin/env node
/**
 * Do the three PHP endpoints count the same visitor?   npm run audit:client-ip
 *
 * `/api/wain.php`, `/api/media.php` and `/api/tts.php` rate-limit and log by
 * visitor, and each carries its own copy of the code that decides who that is —
 * the duplication is deliberate (each file stays copy-installable from a raw
 * URL with no include path between them), and `audit:logs` is the same check
 * for the log format. This is that check for the address.
 *
 * Why it matters: behind a reverse proxy REMOTE_ADDR is the proxy, so every
 * visitor shared one bucket and a handful could lock everyone else out of
 * ordering. The fix reads X-Forwarded-For — a header the client types whenever
 * nothing of ours is in front, and a limit that believes it is one anybody
 * steps around by sending a new value with each request. So the rule is strict,
 * and drift in any half of it is silent:
 *
 *   - trust is OPT-IN. The header is read only when the connection comes from
 *     a proxy named in storage/trusted-proxies.txt. With no list the visitor is
 *     exactly REMOTE_ADDR, as before this existed. It was range-based (anything
 *     private is a proxy) in the first draft; review showed Docker presents an
 *     externally published port as its private gateway address, so a range
 *     would have believed a public attacker's own header;
 *   - from a trusted proxy, the visitor is the nearest hop from the RIGHT that
 *     is not itself listed, because a proxy appends the address it saw;
 *   - a header that cannot be read is never guessed at.
 *
 * Four checks, each against what PHP says rather than what a regex reads:
 *   1. every endpoint answers the same table of (peer, header, list) cases —
 *      including every edge of the ranges a list can name;
 *   2. the helper's source is byte-identical in all three files;
 *   3. the address and the header are read in exactly one place per file,
 *      inside the helper, by any spelling — so a new read cannot put a limiter
 *      back on the proxy's address, or on a header nobody gated;
 *   4. an unreadable or hostile list entry trusts nothing.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINTS = {
  wain: "scripts/publish/wain-api.php",
  media: "scripts/publish/media-endpoint.php",
  tts: "scripts/publish/tts-endpoint.php",
};

let errors = 0;
const fail = (m, d = "") => { errors++; console.log(`  ✗ ${m}${d ? `\n      ${d}` : ""}`); };
const ok = (m) => console.log(`  ✓ ${m}`);

const V = "203.0.113.7"; // a documentation address standing in for a visitor
const DOCKER = "172.18.0.0/16";

/** [peer, X-Forwarded-For, trusted list, expected, why] */
const CASES = [
  // Off by default: no list, no trust — whatever the peer, whatever the header.
  ["127.0.0.1", "", "", "127.0.0.1", "no header: the peer"],
  ["8.8.8.8", "", "", "8.8.8.8", "a visitor connecting directly"],
  ["172.18.0.2", V, "", "172.18.0.2", "NO LIST: a private peer's header is not believed"],
  ["127.0.0.1", V, "", "127.0.0.1", "NO LIST: nor loopback's"],
  ["172.17.0.1", V, "# only a comment\n\n", "172.17.0.1", "a list of nothing trusts nothing"],
  ["0", V, "", "0", "no REMOTE_ADDR at all (a CLI run)"],
  // A public peer's header is the client's own typing, listed or not.
  ["8.8.8.8", "1.2.3.4", DOCKER, "8.8.8.8", "a peer outside the list: its header is IGNORED"],
  ["8.8.8.8", "10.0.0.1, 1.2.3.4", DOCKER, "8.8.8.8", "…however it is dressed"],
  ["172.19.0.2", V, DOCKER, "172.19.0.2", "a private peer outside the list is not a proxy"],
  ["172.17.0.1", V, DOCKER, "172.17.0.1", "the Docker gateway is not the listed network"],
  ["::ffff:8.8.8.8", "1.2.3.4", DOCKER, "::ffff:8.8.8.8", "a public peer spelled as IPv4-mapped IPv6"],
  // A listed proxy: the visitor behind it.
  ["172.18.0.2", V, DOCKER, V, "a listed Docker-network proxy: the forwarded visitor"],
  ["127.0.0.1", V, "127.0.0.1", V, "a single listed address, no prefix"],
  ["127.0.0.1", V, "127.0.0.1/32", V, "…or written /32"],
  ["::1", V, "::1", V, "a listed IPv6 address"],
  ["172.18.0.2", V, "# the Docker network\n172.18.0.0/16  # Traefik\n", V, "comments and blank lines"],
  ["10.0.0.9", V, "172.18.0.0/16\n10.0.0.0/8", V, "the second line of a list"],
  ["172.18.0.2", V, "garbage\n999.1.1.1\n172.18.0.0/16", V, "unreadable lines are skipped, readable ones still count"],
  ["::ffff:172.18.0.2", "2001:db8::5", DOCKER, "2001:db8::5", "a listed proxy spelled as dotted IPv4-mapped IPv6"],
  ["::ffff:ac12:2", V, DOCKER, V, "…and as hex IPv4-mapped IPv6"],
  ["0:0:0:0:0:ffff:172.18.0.2", V, DOCKER, V, "…and in the long form"],
  // Which hop, counting from the right.
  ["172.18.0.2", `198.51.100.1, ${V}`, DOCKER, V, "a client-typed prefix to the left is ignored"],
  ["172.18.0.2", `${V}, 172.18.0.5`, DOCKER, V, "an inner listed proxy hop is skipped"],
  ["172.18.0.2", `${V}, 198.51.100.9`, DOCKER, "198.51.100.9", "the nearest hop that is not listed, from the right"],
  ["172.18.0.2", ` ${V} `, DOCKER, V, "whitespace around a hop"],
  ["172.18.0.2", `${V},`, DOCKER, "172.18.0.2", "a trailing empty hop is unreadable, so the peer"],
  ["fd12::1", "2001:DB8:0:0:0:0:0:5", "fd00::/8", "2001:db8::5", "an IPv6 visitor is written one way"],
  ["172.18.0.2", "::ffff:808:808", DOCKER, "8.8.8.8", "a visitor written hex-mapped is the IPv4 one"],
  ["172.18.0.2", "0:0:0:0:0:ffff:8.8.8.8", DOCKER, "8.8.8.8", "…in the long form too"],
  ["172.18.0.2", "::ffff:ac12:5", DOCKER, "172.18.0.2", "a listed hop written hex-mapped is still ours: every hop ours, the peer"],
  ["172.18.0.2", "0:0:0:0:0:ffff:172.18.0.5", DOCKER, "172.18.0.2", "…in the long form"],
  // Never guess.
  ["172.18.0.2", "garbage", DOCKER, "172.18.0.2", "a header that is not an address is ignored"],
  ["172.18.0.2", "unknown", DOCKER, "172.18.0.2", "…including «unknown»"],
  ["172.18.0.2", `${V}, garbage`, DOCKER, "172.18.0.2", "…and an unreadable nearest hop is not skipped past"],
  ["172.18.0.2", "172.18.0.9", DOCKER, "172.18.0.2", "every hop listed: the peer"],
  ["172.18.0.2", "999.1.1.1", DOCKER, "172.18.0.2", "an out-of-range octet"],
  ["172.18.0.2", `${V}:8080`, DOCKER, "172.18.0.2", "a port suffix"],
  ["172.18.0.2", `[::1]`, DOCKER, "172.18.0.2", "brackets"],
  ["172.18.0.2", `fe80::1%eth0`, "172.18.0.0/16", "172.18.0.2", "a zone id"],
  // A list entry that could trust the world must trust nothing.
  // The hop is in the OTHER address family on purpose: a /0 would trust the
  // peer but not the hop, so a trust-everything entry shows up as a leaked header.
  ["8.8.8.8", "2001:db8::5", "0.0.0.0/0", "8.8.8.8", "/0 is refused"],
  ["2001:4860:4860::8888", V, "::/0", "2001:4860:4860::8888", "…in IPv6 too"],
  ["172.18.0.2", V, "172.18.0.0/33", "172.18.0.2", "a prefix longer than the address"],
  ["172.18.0.2", V, "172.18.0.0/-1", "172.18.0.2", "a negative prefix"],
  ["172.18.0.2", V, "172.18.0.0/ab", "172.18.0.2", "a prefix that is not a number"],
  ["8.8.8.8", V, "8.8.8.8/16/4", "8.8.8.8", "two slashes"],
];

/** The edges of each range a list can name: one byte either side of every
    boundary. A widened or narrowed prefix is the quiet way this goes wrong. */
const EDGES = [
  ["172.16.0.0/12", ["172.16.0.0", "172.31.255.255"], ["172.15.255.255", "172.32.0.0"]],
  ["192.168.0.0/16", ["192.168.0.0", "192.168.255.255"], ["192.167.255.255", "192.169.0.0"]],
  ["10.0.0.0/8", ["10.0.0.0", "10.255.255.255"], ["9.255.255.255", "11.0.0.0"]],
  ["127.0.0.0/8", ["127.0.0.0", "127.255.255.255"], ["126.255.255.255", "128.0.0.0"]],
  ["169.254.0.0/16", ["169.254.0.0", "169.254.255.255"], ["169.253.255.255", "169.255.0.0"]],
  ["100.64.0.0/10", ["100.64.0.0", "100.127.255.255"], ["100.63.255.255", "100.128.0.0"]],
  ["fc00::/7", ["fc00::", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"], ["fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "fe00::"]],
  ["fe80::/10", ["fe80::", "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff"], ["fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "fec0::"]],
  ["2001:db8::/33", ["2001:db8::", "2001:db8:7fff:ffff:ffff:ffff:ffff:ffff"], ["2001:db7:ffff:ffff:ffff:ffff:ffff:ffff", "2001:db8:8000::"]],
  ["198.51.100.4/30", ["198.51.100.4", "198.51.100.7"], ["198.51.100.3", "198.51.100.8"]],
];
for (const [net, inside, outside] of EDGES) {
  for (const p of inside) CASES.push([p, V, net, V, `edge: ${p} is inside ${net}`]);
  for (const p of outside) CASES.push([p, V, net, p, `edge: ${p} is outside ${net}`]);
}

console.log("\n── every endpoint resolves the visitor the same way ──");

const ask = (app, peer, xff, trusted) =>
  JSON.parse(execFileSync("php", [join(ROOT, ENDPOINTS[app]), "clientip", peer, xff, trusted], { encoding: "utf8" })).ip;

for (const app of Object.keys(ENDPOINTS)) {
  const wrong = [];
  for (const [peer, xff, trusted, want, why] of CASES) {
    let got;
    try { got = ask(app, peer, xff, trusted); } catch (e) { got = `(no answer: ${String(e.message).split("\n")[0]})`; }
    if (got !== want) wrong.push(`${why}: peer ${peer}, header ${JSON.stringify(xff)}, list ${JSON.stringify(trusted)} → ${got}, wanted ${want}`);
  }
  if (wrong.length) fail(`${app} answers ${wrong.length} of ${CASES.length} cases differently`, wrong.slice(0, 12).join("\n      "));
  else ok(`${app}: all ${CASES.length} cases answer as written`);
}

console.log("\n── the helper is one piece of text ──");

const sources = Object.fromEntries(
  Object.entries(ENDPOINTS).map(([app, f]) => [app, readFileSync(join(ROOT, f), "utf8")])
);
const START = "/** The proxies we run in front of this file";
const END = "// END shared rate-counter helper\n";
const block = (src) => {
  const a = src.indexOf(START);
  if (a < 0) return null;
  const b = src.indexOf(END, a);
  return b < 0 ? null : src.slice(a, b + END.length);
};
const blocks = Object.fromEntries(Object.entries(sources).map(([app, s]) => [app, block(s)]));
const missing = Object.entries(blocks).filter(([, b]) => b === null).map(([a]) => a);
if (missing.length) fail(`no parseNets … clientIp block in: ${missing.join(", ")}`);
else {
  const [first, ...rest] = Object.keys(blocks);
  const differ = rest.filter((a) => blocks[a] !== blocks[first]);
  if (differ.length) fail(`${differ.join(", ")} carry a different copy of the helper than ${first}`);
  else ok(`parseNets, trustedProxies, inNets, unwrapMappedIp, clientIp, rateKey and sweepRateCounters are byte-identical in ${Object.keys(blocks).join(", ")} (${blocks[first].length} bytes)`);
}

console.log("\n── the address and the header are read in one place ──");

/** Every way PHP lets a script reach the peer address or a client-supplied
    forwarding header. REMOTE_ADDR and X-Forwarded-For are read once, inside
    the helper; the rest are read nowhere. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*(\/\/|#).*$/gm, "");
const READS = [
  ["$_SERVER['REMOTE_ADDR']", /\$_SERVER\[\s*['"]REMOTE_ADDR['"]\s*\]/g, 1],
  ["$_SERVER['HTTP_X_FORWARDED_FOR']", /\$_SERVER\[\s*['"]HTTP_X_FORWARDED_FOR['"]\s*\]/g, 1],
  ["any other forwarding header (X_REAL_IP, CLIENT_IP, FORWARDED, CF_CONNECTING_IP, TRUE_CLIENT_IP, FASTLY…)",
    /HTTP_(?:X_REAL_IP|CLIENT_IP|FORWARDED\b|X_FORWARDED(?!_FOR\b)|CF_CONNECTING_IP|TRUE_CLIENT_IP|FASTLY_CLIENT_IP|X_CLUSTER_CLIENT_IP)/g, 0],
  ["getenv() of the address or header", /getenv\(\s*['"](?:REMOTE_ADDR|HTTP_X_FORWARDED_FOR|X-Forwarded-For)['"]/gi, 0],
  ["getallheaders() / apache_request_headers()", /\b(?:getallheaders|apache_request_headers)\s*\(/g, 0],
  ["filter_input(INPUT_SERVER…)", /INPUT_SERVER/g, 0],
  ["a $_SERVER key built at run time", /\$_SERVER\[\s*(?!['"])[^\]]/g, 0],
];
for (const [app, src] of Object.entries(sources)) {
  const code = stripComments(src);
  const inHelper = stripComments(blocks[app] ?? "");
  const bad = [];
  for (const [name, re, allowed] of READS) {
    const total = (code.match(re) ?? []).length;
    const inside = (inHelper.match(re) ?? []).length;
    if (total !== allowed || inside !== allowed) {
      bad.push(`${name}: ${total} in the file, ${inside} inside the helper; ${allowed} expected, all inside`);
    }
  }
  if (bad.length) fail(`${app} reads the visitor outside the gate`, bad.join("\n      "));
  else ok(`${app}: REMOTE_ADDR and X-Forwarded-For are each read once, inside the helper; nothing else reaches the visitor`);
}

console.log(`\n${errors} error${errors === 1 ? "" : "s"}\n`);
process.exit(errors ? 1 : 0);
