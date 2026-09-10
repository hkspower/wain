/**
 * What وين can do, as one list — read by the search hub and by the MCP server.
 *
 * The search button is the middle of this site: it is in the root layout, it
 * has ⌘K, and it is the only control on every route that leads somewhere the
 * navbar does not. So it is where the site's moves belong — and they were
 * spread over three places instead. /search's dead end offered categories and
 * a call to شوق, the palette offered a sentence and nothing else, and «سجّل
 * مكانك» existed only as a link in the footer. Three surfaces answering the
 * same question differently is three chances to answer it wrong.
 *
 * This module is the answer, once. `SearchHub` draws it; `mcp/wain-mcp.mjs`
 * bundles this same file and serves it as `list_actions`, so a client asking
 * what wain can do and a visitor opening the search box get the same set under
 * the same names, and neither can drift from the other without this file
 * changing.
 *
 * NOTHING HERE MAY IMPORT THE CATALOGUE — same rule as `place-kit.ts`, same
 * reason: the hub is reachable from the palette, the palette button is in the
 * root layout, and `npm run audit:js` fails if place records follow it there.
 *
 * WHAT IS DELIBERATELY ABSENT: ordering and the queue. Both are built, both
 * are inert — `acceptsOrders` needs a menu and `takesQueue` needs a salon
 * kind, and 0 of 52 places satisfy either, so a hub row for «طلباتي» would
 * advertise a door that opens onto nothing. `OrdersLink` already handles the
 * case that matters, appearing in the navbar only on a device that has a live
 * order. When a place takes orders, add the row here and both surfaces get it.
 */

// The one thing here that is already written somewhere else. `wain-ai.ts` has
// no imports of its own and reads a single NEXT_PUBLIC_ variable, so it costs
// nothing to either surface — and the call's hint has to be the same sentence
// on the button and in this list, or the hub says one thing and the button it
// draws says another.
import { WAIN_AI_COPY } from "@/lib/wain-ai";

/** The site these paths are absolute against, for anything off-browser. */
export const WAIN_ORIGIN = "https://www.wainkw.com";

export type HubActionKind =
  /** Goes to a page. */
  | "route"
  /** Places a call to شوق, in the browser, from the page named by `href`. */
  | "call";

export interface HubAction {
  id: string;
  /** What a visitor reads. */
  ar: string;
  /** One line saying what it does — the hint beside it, and the MCP blurb. */
  hintAr: string;
  /** What an MCP client reads, where Arabic is not the working language. */
  en: string;
  kind: HubActionKind;
  /** Site-relative, with the trailing slash `trailingSlash: true` requires. */
  href: string;
  /** Which mark `SearchHub` draws. Not an icon name — the hub owns that map. */
  icon: "shouq" | "compass" | "pin";
}

export const HUB_ACTIONS: HubAction[] = [
  {
    id: "call_shouq",
    ar: WAIN_AI_COPY.name,
    hintAr: WAIN_AI_COPY.callHint,
    en: "Call Shouq, the guide, and ask out loud",
    kind: "call",
    // /search rather than the current page: a call ends by handing its question
    // to the search box, so this is where the answer lands either way.
    href: "/search/",
    icon: "shouq",
  },
  {
    id: "explore",
    ar: "تصفّح كل الأماكن",
    hintAr: "كل أماكن وين، بالتصنيف والبحث",
    en: "Browse the whole catalogue",
    kind: "route",
    href: "/explore/",
    icon: "compass",
  },
  {
    id: "add_place",
    ar: "سجّل مكانك مجاناً",
    hintAr: "أي محل في الكويت يقدر يسجّل، بدون رسوم",
    en: "Register a Kuwait business on wain, free",
    kind: "route",
    href: "/add/",
    icon: "pin",
  },
];

/** The call action, which both surfaces treat differently from a link. */
export const CALL_ACTION = HUB_ACTIONS.find((a) => a.kind === "call")!;
/** Everything that is just a page, in the order it is drawn. */
export const ROUTE_ACTIONS = HUB_ACTIONS.filter((a) => a.kind === "route");
