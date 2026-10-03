"use client";

import { useEffect, useState } from "react";
import { places as snapshot, type Place } from "@/lib/places";
import { backendEnabled, call } from "@/lib/backend";
import { rowToPlace, type PlaceRow } from "@/lib/place-rows";

/**
 * Places for the public site.
 *
 * Starts from the build-time snapshot so the first paint is instant, correct
 * and crawlable — the HTML already contains it. If the back end is on we then
 * fetch the live rows and swap them in, so an admin edit shows up without
 * waiting for a redeploy.
 *
 * Every surface that shows a place reads this: /explore, /search, شوق's tools,
 * and — since PlaceLive — the place's own page. An edit reaches all of them at
 * once, which is the point; a corrected name that showed in the results and
 * not on the page they led to was worse than one that showed nowhere.
 *
 * What this cannot do is conjure a page that was never built. A place added in
 * the admin appears in these listings immediately, but /places/<new-slug>/ is
 * emitted by generateStaticParams at build time, so it 404s until the next
 * deploy. The admin's publish button exists for exactly that.
 *
 * An empty answer keeps the snapshot too: a server whose `places` table has
 * not been seeded yet (`php wain.php seed`) must not blank the site.
 */
export function usePlaces(): { places: Place[]; live: boolean } {
  const [data, setData] = useState<Place[]>(snapshot);
  const [live, setLive] = useState(false);

  useEffect(() => {
    // The early return matters: with the back end off this never touches the
    // network, and the page is exactly the static export.
    if (!backendEnabled) return;
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      let result;
      try {
        // Aborted on unmount so a slow reply cannot land on a component that
        // is gone. Not retried: a listing is re-asked on the next mount, and
        // the snapshot is a fine answer in the meantime.
        result = await call<{ places: PlaceRow[] }>("places", undefined, { signal: controller.signal });
      } catch {
        return;
      }
      // On any failure keep the snapshot: stale data beats an empty site.
      if (cancelled || !result.ok || !Array.isArray(result.places) || result.places.length === 0) return;
      setData(result.places.map(rowToPlace));
      setLive(true);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return { places: data, live };
}
