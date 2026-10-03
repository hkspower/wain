/**
 * Where this device keeps its live orders and queue tickets, and the one
 * question the root layout asks of them: is there anything there at all?
 *
 * `LiveTray` is mounted on every page and used to import `orders.ts` and
 * `queue.ts` to find out — about 4K gzipped, paid by every visitor to every
 * route, for a feature 0 of 52 places offer. The keys live here, with no
 * other import, so the tray can read the raw value for free and load the two
 * modules only on the device that has actually placed something.
 */
export const ORDERS_STORE_KEY = "wain:orders";
export const QUEUE_STORE_KEY = "wain:queue";

/** True when the key holds something that might be a record — the modules
 *  decide what it is; this only decides whether to load them. */
export function hasStored(key: string): boolean {
  try {
    const raw = localStorage.getItem(key);
    return !!raw && raw !== "[]";
  } catch {
    return false;
  }
}
