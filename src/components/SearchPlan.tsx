"use client";

import { useMemo } from "react";
import Link from "next/link";
import ShareHangout from "@/components/ShareHangout";
import { IconBag, IconClock, IconGo } from "@/components/icons";
// From place-kit, not orders.ts/queue.ts: both of those are `"use client"`
// modules carrying the Supabase bridge, and this page only asks the question.
import { acceptsOrders, takesQueue } from "@/lib/place-kit";
import type { Place } from "@/lib/places";

/**
 * Act on a search result without leaving the search.
 *
 * The site is built on one promise — «خلّ الجروب يرتاح — لقِ طلعة الليلة في
 * أقل من دقيقة» — and search delivered only the first half of it. Forty
 * results, every one a link, and the thing the visitor came to do lived two
 * navigations away: open the place, scroll past the order and queue panels,
 * pick a time, send. Under a minute was not true.
 *
 * It is worse coming from شوق. She calls `show_places`, says «حطيتهم لك على
 * الخريطة», and the visitor is looking at a list they cannot do anything with
 * while she is still on the line. Her whole job is to end the argument in the
 * group, and the last step of ending it was somewhere else.
 *
 * So the panel that ends it moves here. Not a copy of it — the same
 * `ShareHangout` the place page renders, given a list of places to choose
 * between. The time rules, the summer rule, the expiring hours and the message
 * format stay in one file where they can only be right or wrong once.
 *
 * Ordering and the queue are links rather than panels, and that is deliberate:
 * an order is a menu, quantities and a collection time, which is a page's worth
 * of decisions and does not belong inside a result row. What belongs here is
 * knowing the place takes orders at all — the thing you would otherwise open
 * fifty-two pages to discover.
 */
export default function SearchPlan({
  places,
  activeSlug,
  onActiveSlug,
}: {
  /** Place hits, in result order. */
  places: Place[];
  /** Whatever the map and the list are pointing at, so all three agree. */
  activeSlug: string | null;
  onActiveSlug: (slug: string | null) => void;
}) {
  /**
   * The place this plan is about.
   *
   * The active one when there is one — pointing at a pin or a row is already
   * the gesture for «this one» on this page, and answering it here is what
   * makes the map, the list and this panel one view rather than three. The top
   * result otherwise, because a panel that asks the visitor to choose before it
   * will show them anything is a panel that does nothing on arrival, which is
   * exactly the moment شوق hands them over.
   */
  const target = useMemo(
    () => places.find((p) => p.slug === activeSlug) ?? places[0],
    [places, activeSlug]
  );

  /**
   * The switchable places: the first few, plus the target wherever it came
   * from. Without that second half, tapping a pin far down a long list moved
   * the panel to a place whose chip was not in the row — so the selected chip
   * was invisible and the row looked like it had lost its selection.
   */
  const choices = useMemo(() => {
    if (!target) return [];
    const top = places.slice(0, 5);
    return top.some((p) => p.slug === target.slug) ? top : [target, ...top.slice(0, 4)];
  }, [places, target]);

  if (!target) return null;

  const canOrder = acceptsOrders(target);
  const canQueue = takesQueue(target);

  return (
    <div className="mb-7">
      <ShareHangout place={target} choices={choices} onChoose={onActiveSlug} />

      {/* Only where the business actually switched them on. A greyed «اطلب» on
          a place that does not take orders teaches the visitor to ignore the
          row, and every place here is one of the fifty-two that has not. */}
      {(canOrder || canQueue) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {canOrder && (
            <Link
              href={`/places/${target.slug}/`}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300 hover:text-sea-700"
            >
              <IconBag className="size-4 text-sea-700" />
              اطلب من {target.nameAr}
              <IconGo className="size-4 text-sand-400" />
            </Link>
          )}
          {canQueue && (
            <Link
              href={`/places/${target.slug}/`}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300 hover:text-sea-700"
            >
              <IconClock className="size-4 text-sea-700" />
              خذ دورك
              <IconGo className="size-4 text-sand-400" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
