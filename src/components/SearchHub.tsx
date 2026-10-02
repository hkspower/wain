"use client";

import Link from "next/link";
import CategoryIcon from "@/components/CategoryIcon";
import { IconCall, IconCompass, IconPinSolid } from "@/components/icons";
import { categories } from "@/lib/place-kit";
import { CALL_ACTION, ROUTE_ACTIONS } from "@/lib/wain-hub";

/**
 * Everything وين can do, drawn wherever the search box has nothing to show.
 *
 * The search button is the one control on every route, so it is the middle of
 * the site — and until now it was the middle of nothing: the ⌘K palette met an
 * empty box with a sentence and a failed query with «ما لقينا شي.», which is a
 * dead end drawn twice. /search had already been given a way on (categories,
 * then شوق); this is that same way on, extracted, so the palette gets it too
 * and the two cannot drift into two different answers to one question.
 *
 * The order is not decorative. Categories first because they are the cheapest
 * move on the site — eight taps, no permission, no waiting, and a visitor who
 * knows what they want is gone before they read further. شوق second because
 * she costs a microphone and a moment. The plain links last, because they are
 * for somebody who has decided this search is not going to work.
 *
 * Drawn from `lib/wain-hub.ts`, which the MCP server bundles as well, so
 * `list_actions` over stdio and this component are the same list.
 */
export default function SearchHub({
  /** Close the surface this is drawn in, if it is one that closes. */
  onNavigate,
  className = "",
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <div className={`text-center ${className}`}>
      <h3 className="text-sm font-semibold text-ink-700">دوّر بالتصنيف</h3>
      <ul className="mx-auto mt-3 flex max-w-lg flex-wrap justify-center gap-2">
        {categories.map((cat) => (
          <li key={cat.id}>
            {/* Straight to /explore with the filter already applied, rather
                than putting the category's name back in the box: re-searching
                the word that just failed is the one move guaranteed to land
                here again. */}
            <Link
              href={`/explore/?category=${cat.id}`}
              onClick={onNavigate}
              className="flex min-h-6 items-center gap-2 rounded-full border border-line-control bg-white px-3.5 text-sm font-semibold text-ink-700 transition hover:border-sea-300 hover:text-sea-700"
            >
              <CategoryIcon name={cat.icon} className="size-4 text-ink-500" />
              {cat.ar}
            </Link>
          </li>
        ))}
      </ul>

      {/* «or» drawn as a rule rather than written as a sentence, so the two
          offers read as alternatives at a glance instead of a list to work
          through. */}
      <div className="mx-auto mt-6 flex max-w-xs items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line-strong" />
        <span className="text-2xs font-semibold text-ink-500">أو</span>
        <span className="h-px flex-1 bg-line-strong" />
      </div>

      {/* A link to /find, not a call button. The call has one button on the
          site — /find's — and this row is the way to it. It used to be a
          second ShouqCallButton, and before that the /search box held a third;
          one offer drawn three times, until the owner asked for one. */}
      <div className="mt-4 flex justify-center">
        <Link
          href={CALL_ACTION.href}
          onClick={onNavigate}
          className="inline-flex min-h-6 items-center gap-2 rounded-full bg-coral-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-coral-700"
        >
          <IconCall className="size-4" aria-hidden="true" />
          {CALL_ACTION.hintAr}
        </Link>
      </div>

      <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
        {ROUTE_ACTIONS.map((action) => (
          <li key={action.id}>
            <Link
              href={action.href}
              onClick={onNavigate}
              className="inline-flex min-h-6 items-center gap-2 text-sm font-semibold text-ink-500 underline underline-offset-4 transition hover:text-ink-700"
            >
              {action.icon === "compass" ? (
                <IconCompass className="size-4" aria-hidden="true" />
              ) : (
                <IconPinSolid className="size-4" aria-hidden="true" />
              )}
              {action.ar}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
