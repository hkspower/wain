#!/usr/bin/env node
/**
 * Which iPhone simulator the iOS workflow boots.
 *
 *   xcrun simctl list devices available -j | node scripts/pick-ios-simulator.mjs large
 *
 * Prints `udid=…`, `name=…` and `runtime=…` lines, the shape `$GITHUB_OUTPUT`
 * takes. Device names change with every Xcode on the runner image («iPhone 16
 * Pro» one year, «iPhone 17 Pro» the next), so a name written into the
 * workflow is a job that fails the day the image moves. This picks from what
 * the runner actually has, on the NEWEST iOS runtime it carries:
 *
 *   large — the highest-numbered «iPhone N Pro», else «iPhone N», else any iPhone
 *   small — an «iPhone SE», else an «iPhone Ne» (16e), else a «mini», else the
 *           narrowest-named fallback that is not the large pick
 *
 * Pure function plus a stdin wrapper, so tests/pick-ios-simulator.test.mjs can
 * hold it to a recorded listing without a Mac.
 */
import { pathToFileURL } from "node:url";

/** "com.apple.CoreSimulator.SimRuntime.iOS-26-1" → [26, 1]; null if not iOS. */
export function iosVersion(runtimeKey) {
  const m = /SimRuntime\.iOS-(\d+)(?:-(\d+))?(?:-(\d+))?$/.exec(runtimeKey);
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const num = (name) => Number(/iPhone (\d+)/.exec(name)?.[1] ?? 0);
const byNumberDesc = (a, b) => num(b.name) - num(a.name);

export function pickSimulator(listing, kind) {
  const runtimes = Object.entries(listing.devices ?? {})
    .map(([key, devices]) => ({ key, version: iosVersion(key), devices }))
    .filter((r) => r.version && r.devices.some((d) => d.isAvailable !== false && /^iPhone/.test(d.name)))
    .sort((a, b) => cmp(b.version, a.version));
  if (!runtimes.length) throw new Error("no iOS runtime with an iPhone simulator");
  const newest = runtimes[0];
  const phones = newest.devices.filter((d) => d.isAvailable !== false && /^iPhone/.test(d.name));

  const first = (re) => phones.filter((d) => re.test(d.name)).sort(byNumberDesc)[0];
  const large = first(/^iPhone \d+ Pro$/) ?? first(/^iPhone \d+$/) ?? phones[0];
  const pick =
    kind === "large"
      ? large
      : kind === "small"
        ? first(/^iPhone SE/) ?? first(/^iPhone \d+e$/) ?? first(/mini$/) ??
          phones.find((d) => d.udid !== large.udid) ?? large
        : null;
  if (!pick) throw new Error(`unknown kind «${kind}» — large or small`);
  return { udid: pick.udid, name: pick.name, runtime: newest.version.join(".").replace(/\.0$/, "") };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const p = pickSimulator(JSON.parse(raw), process.argv[2] ?? "large");
  process.stdout.write(`udid=${p.udid}\nname=${p.name}\nruntime=${p.runtime}\n`);
}
