"use client";

import { useEffect, useState } from "react";
import { places as snapshot, type Place } from "@/lib/places";
import { getSupabase, rowToPlace, supabaseEnabled, type PlaceRow } from "@/lib/supabase";

/**
 * Places for the public site.
 *
 * Starts from the build-time snapshot so the first paint is instant, correct
 * and crawlable — the HTML already contains it. If Supabase is configured we
 * then fetch the live rows and swap them in, so an admin edit shows up without
 * waiting for a redeploy.
 *
 * A place added in the admin appears in these listings immediately, but its own
 * /places/<slug>/ page is generated at build time, so it only becomes reachable
 * after the next deploy. The admin's publish button exists for exactly that.
 */
export function usePlaces(): { places: Place[]; live: boolean } {
  const [data, setData] = useState<Place[]>(snapshot);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!supabaseEnabled) return;
    const sb = getSupabase();
    if (!sb) return;
    let cancelled = false;

    (async () => {
      const { data: rows, error } = await sb
        .from("places")
        .select("*")
        .eq("published", true)
        .order("sort_order", { ascending: true });
      // On any failure keep the snapshot: stale data beats an empty site.
      if (cancelled || error || !rows?.length) return;
      setData((rows as PlaceRow[]).map(rowToPlace));
      setLive(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { places: data, live };
}
