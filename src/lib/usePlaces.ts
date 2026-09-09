"use client";

import { useEffect, useState } from "react";
import { places as snapshot, type Place } from "@/lib/places";
import { loadSupabase, rowToPlace, supabaseEnabled, type PlaceRow } from "@/lib/supabase";

/**
 * Places for the public site.
 *
 * Starts from the build-time snapshot so the first paint is instant, correct
 * and crawlable — the HTML already contains it. If Supabase is configured we
 * then fetch the live rows and swap them in, so an admin edit shows up without
 * waiting for a redeploy.
 *
 * Every surface that shows a place reads this: /explore, /search, the ⌘K
 * palette, and — since PlaceLive — the place's own page. An edit reaches all of
 * them at once, which is the point; a corrected name that showed in the results
 * and not on the page they led to was worse than one that showed nowhere.
 *
 * What this cannot do is conjure a page that was never built. A place added in
 * the admin appears in these listings immediately, but /places/<new-slug>/ is
 * emitted by generateStaticParams at build time, so it 404s until the next
 * deploy. The admin's publish button exists for exactly that.
 */
export function usePlaces(): { places: Place[]; live: boolean } {
  const [data, setData] = useState<Place[]>(snapshot);
  const [live, setLive] = useState(false);

  useEffect(() => {
    // The early return matters more than it looks: with no URL and key
    // configured this never touches loadSupabase, so the 60KB client chunk is
    // never even requested.
    if (!supabaseEnabled) return;
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      const sb = await loadSupabase();
      if (cancelled || !sb) return;
      // Aborted on unmount so a slow reply cannot land on a component that is
      // gone. Not wrapped in retry(): this is a GET, and postgrest-js already
      // retries those — see the note in net.ts about not stacking.
      const { data: rows, error } = await sb
        .from("places")
        .select("*")
        .eq("published", true)
        .order("sort_order", { ascending: true })
        .abortSignal(controller.signal);
      // On any failure keep the snapshot: stale data beats an empty site.
      if (cancelled || error || !rows?.length) return;
      setData((rows as PlaceRow[]).map(rowToPlace));
      setLive(true);
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return { places: data, live };
}
