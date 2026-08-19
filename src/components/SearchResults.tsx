"use client";

import Link from "next/link";
import CategoryIcon from "@/components/CategoryIcon";
import PlaceIcon from "@/components/PlaceIcon";
import { IconCompass, IconGo, IconPinSolid, IconStar } from "@/components/icons";
import { getCategory, places, toArabicDigits } from "@/lib/places";
import { highlight, type DocKind, type SearchHit } from "@/lib/search";

const KIND_LABEL: Record<DocKind, string> = {
  place: "مكان",
  category: "تصنيف",
  area: "منطقة",
  page: "صفحة",
};

const KIND_TONE: Record<DocKind, string> = {
  place: "bg-coral-50 text-coral-700",
  category: "bg-sea-50 text-sea-700",
  area: "bg-palm-500/12 text-palm-700",
  page: "bg-sand-200 text-ink-600",
};

/** Wrap matched words so it is obvious why a result came back. */
function Marked({ text, matched }: { text: string; matched: string[] }) {
  return (
    <>
      {highlight(text, matched).map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded bg-sun-200/70 px-0.5 text-ink-900">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  );
}

function Thumb({ hit }: { hit: SearchHit }) {
  const { doc } = hit;
  if (doc.kind === "place") {
    return (
      <span
        aria-hidden="true"
        className="grid size-11 shrink-0 place-items-center rounded-xl bg-sand-100 text-ink-700"
      >
        <PlaceIcon slug={doc.id.replace(/^place:/, "")} className="size-7" />
      </span>
    );
  }
  if (doc.kind === "category" && doc.category) {
    return (
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-sea-50 text-sea-700">
        <CategoryIcon name={getCategory(doc.category)?.icon ?? "all"} className="size-6" />
      </span>
    );
  }
  if (doc.kind === "area") {
    return (
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-palm-500/12 text-palm-700">
        <IconPinSolid className="size-5" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-sand-100 text-ink-500">
      <IconCompass className="size-5" />
    </span>
  );
}

/**
 * Rating and price for a place hit. A result row is wide and carried only a
 * name and one subtitle line, so most of it was empty — and the reader still
 * had to open a place to learn the two things that decide whether it is worth
 * opening. Shown only for places; the other kinds have no rating to give.
 */
function PlaceMeta({ id }: { id: string }) {
  const place = places.find((p) => p.slug === id.replace(/^place:/, ""));
  if (!place) return null;
  return (
    <span className="hidden shrink-0 items-center gap-3 sm:flex">
      <span
        className="flex items-center gap-1 text-xs font-bold text-ink-700"
        aria-label={`التقييم ${place.rating} من ٥`}
      >
        <IconStar className="size-3.5 text-sun-500" />
        {toArabicDigits(place.rating.toFixed(1))}
      </span>
      <span
        className="flex items-center gap-1 text-[11px] font-semibold text-sand-700"
        aria-label={`مستوى السعر ${place.priceLevel} من ٣`}
      >
        <span className="flex gap-0.5" aria-hidden="true">
          {[1, 2, 3].map((i) => (
            <span
              key={i}
              className={`size-1.5 rounded-full ${
                i <= place.priceLevel ? "bg-sand-600" : "bg-sand-300"
              }`}
            />
          ))}
        </span>
        د.ك
      </span>
    </span>
  );
}

export default function SearchResults({
  hits,
  activeIndex = -1,
  onNavigate,
}: {
  hits: SearchHit[];
  activeIndex?: number;
  onNavigate?: () => void;
}) {
  return (
    <ul className="space-y-2">
      {hits.map((hit, i) => (
        <li key={hit.doc.id}>
          <Link
            href={hit.doc.url}
            onClick={onNavigate}
            data-result-index={i}
            className={`group flex items-center gap-3 rounded-2xl border p-3 transition ${
              i === activeIndex
                ? "border-sea-300 bg-sea-50/60 ring-2 ring-sea-100"
                : "border-sand-200 bg-white hover:border-sand-300 hover:bg-sand-100"
            }`}
          >
            <Thumb hit={hit} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate font-bold text-ink-900">
                  <Marked text={hit.doc.title} matched={hit.matched} />
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${KIND_TONE[hit.doc.kind]}`}>
                  {KIND_LABEL[hit.doc.kind]}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink-500">
                <Marked text={hit.doc.subtitle} matched={hit.matched} />
              </span>
            </span>
            {hit.doc.kind === "place" && <PlaceMeta id={hit.doc.id} />}
            <IconGo className="size-4 shrink-0 text-sand-400 transition group-hover:-translate-x-1 group-hover:text-coral-600" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
