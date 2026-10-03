/**
 * The real network modules, on a page, pointed at a fake back end.
 *
 * Nothing is reimplemented here: this bundles src/lib/net.ts, backend.ts,
 * orders.ts and queue.ts exactly as they ship and hands them to the test, which
 * plays the server with Playwright's request interception. So the retry rule,
 * the deadline and the "the server saying duplicate means the order already
 * exists" rule are checked as the browser will really run them, rather than as
 * a description of what they are supposed to do.
 */
import * as net from "@/lib/net";
import * as backend from "@/lib/backend";
import * as orders from "@/lib/orders";
import * as queue from "@/lib/queue";

declare global {
  interface Window {
    wain: typeof net & typeof orders & { backend: typeof backend };
    q: typeof queue;
  }
}

window.wain = { ...net, ...orders, backend };
// Kept separate: queue.ts and orders.ts both export normalisePhone, and
// spreading them together would let one silently shadow the other — which is
// exactly the kind of thing a test suite should not be quietly wrong about.
window.q = queue;
