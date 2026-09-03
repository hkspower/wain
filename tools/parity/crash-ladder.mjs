// The ladder both builds are compared on. Kept beside the parity tools
// so the imports resolve the same way the rest of the suite's do.
import { HANDLING as H } from "../../src/game/handling.ts";
import { solveWallImpact, solveTrafficImpact, scrapeDrag } from "../../src/game/crash.ts";
const full = H.crashLatFull;
export const CASES = [[full,0,1],[full,0.6,1],[full,-0.6,1],[full/2,0.6,1],[full*4,-0.6,-1],[2,0.6,1]];
const f=(n,d)=>n.toFixed(d);
const sg=(n,d)=>`${n>=0?"+":""}${f(n,d)}`;
export function ladder() {
  const out = [];
  for (const [into,hd,side] of CASES) {
    const h = solveWallImpact({into,heading:hd,side,crashResist:0});
    out.push(`wall into=${f(into,3)} hd=${sg(hd,2)} side=${sg(side,0)} sev=${f(h.severity,6)} yaw=${sg(h.yaw,6)} kick=${sg(h.kick,6)} spin=${h.spin?1:0} nose=${h.noseFirst?1:0} mul=${f(h.speedMul,6)} slip=${sg(h.slipVel,6)} hdg=${sg(h.heading,6)}`);
  }
  for (const fb of [false,true]) {
    const t = solveTrafficImpact({closing:H.trafficClosingFull,heading:0.2,shove:1,fromBehind:fb,crashResist:0});
    out.push(`traffic fromBehind=${fb?1:0} sev=${f(t.severity,6)} yaw=${sg(t.yaw,6)} kick=${sg(t.kick,6)} spin=${t.spin?1:0}`);
  }
  out.push(`scrape ${f(scrapeDrag(0),6)} ${f(scrapeDrag(1),6)}`);
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(ladder().join("\n"));
