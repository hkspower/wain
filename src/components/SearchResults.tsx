"use client";

import Link from "next/link";
import CategoryIcon from "@/components/CategoryIcon";
import { IconCompass, IconGo, IconPinSolid } from "@/components/icons";
import { getCategory } from "@/lib/places";
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
  if (doc.kind === "place" && doc.category) {
    const cat = getCategory(doc.category);
    return (
      <span
        aria-hidden="true"
        className="grid size-11 shrink-0 place-items-center rounded-xl bg-sand-100 text-xl"
      >
        {doc.emoji ?? "📍"}
        <span className="sr-only">{cat?.ar}</span>
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
                : "border-sand-200 bg-white hover:border-sand-300 hover:bg-sand-50"
            }`}
          >
            <Thumb hit={hit} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="truncate font-bold text-ink-900">
                  <Marked text={hit.doc.title} matched={hit.matched} />
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${KIND_TONE[hit.doc.kind]}`}>
                  {KIND_LABEL[hit.doc.kind]}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-xs text-ink-500">
                <Marked text={hit.doc.subtitle} matched={hit.matched} />
              </span>
            </span>
            <IconGo className="size-4 shrink-0 text-sand-400 transition group-hover:-translate-x-1 group-hover:text-coral-600" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
