/**
 * The real network modules, on a page, pointed at a fake Supabase.
 *
 * Nothing is reimplemented here: this bundles src/lib/net.ts and
 * src/lib/orders.ts exactly as they ship and hands them to the test, which
 * plays the server with Playwright's request interception. So the retry rule,
 * the deadline and the "a duplicate key means the order already exists" rule
 * are checked as the browser will really run them, rather than as a
 * description of what they are supposed to do.
 */
import * as net from "@/lib/net";
import * as orders from "@/lib/orders";
import { loadSupabase } from "@/lib/supabase";

declare global {
  interface Window {
    wain: typeof net & typeof orders & { loadSupabase: typeof loadSupabase };
  }
}

window.wain = { ...net, ...orders, loadSupabase };
