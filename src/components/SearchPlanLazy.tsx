"use client";

import dynamic from "next/dynamic";

/**
 * SearchPlan — the share panel under /search's results — in a script of its
 * own, fetched the first time there are results to share.
 *
 * It pays for what 8 October put on /search: the greeting reading, «قريب
 * مني», a part of Kuwait with nothing in it, the word a place did not answer
 * — about 3.8K gzipped, against a route that sat 0.4K under its 176K budget.
 * The panel is the right thing to defer: it sits BELOW the result list, it
 * needs the results to exist, and on a phone it is under the fold when they
 * arrive, so a chunk that lands a beat after them is not seen landing. /search
 * went from 179.2K to under the budget; the panel's code (~6K with
 * hangout.ts) is paid by whoever searches, once, and never by a page that
 * shows no results.
 *
 * `ssr: false` costs nothing here: /search is a static export with no query
 * in its HTML, so the panel was never in the server markup — it only ever
 * rendered on the client, after the first search. The place page's own
 * panel is NOT deferred: its shell is in the HTML on purpose (3 October).
 *
 * Not precached by the service worker (gen-sw keeps only what a page's HTML
 * references), so offline the panel does not load; sharing needs the network
 * anyway.
 */
const SearchPlan = dynamic(() => import("@/components/SearchPlan"), {
  ssr: false,
  loading: () => (
    <section
      aria-busy="true"
      data-share-loading=""
      className="mt-6 min-h-40 rounded-3xl border border-line bg-white shadow-xs"
    />
  ),
});

export default SearchPlan;
