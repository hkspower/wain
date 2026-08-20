"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SearchResults from "@/components/SearchResults";
import { IconSearch } from "@/components/icons";
import { usePlaces } from "@/lib/usePlaces";
import { buildIndex, search } from "@/lib/search";

/**
 * The searching half of the command palette.
 *
 * Split out of SearchPalette so it loads on first open rather than on every
 * page. It is the expensive half: the search engine, all place data and
 * SearchResults — which reaches PlaceIcon and every place's artwork. The
 * navbar sits in the root layout, so before this split the privacy policy
 * downloaded and parsed the whole catalogue in order to render a search
 * button.
 *
 * The index is still built lazily on top of that: mounting this dialog is
 * what pays for it, and a visitor who never searches never does.
 */
export default function SearchPaletteDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { places } = usePlaces();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const index = useMemo(() => buildIndex(places), [places]);
  const hits = useMemo(() => search(q, index, { limit: 8 }), [q, index]);

  const close = useCallback(() => {
    setQ("");
    setActive(0);
    onClose();
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => setActive(0), [q]);

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = hits[active]?.doc.url ?? (q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : null);
      if (target) {
        close();
        router.push(target);
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[10vh]">
      <button
        type="button"
        aria-label="إغلاق البحث"
        onClick={close}
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="بحث"
        className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-line bg-white shadow-2xl"
      >
        <div className="relative border-b border-line">
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-4 flex items-center text-ink-500">
            <IconSearch className="size-5" />
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            aria-label="ابحث في وين"
            placeholder="دوّر عن مكان، منطقة، أو جو…"
            className="w-full bg-transparent py-4 pe-4 ps-12 text-base text-ink-800 outline-none placeholder:text-ink-500/60"
          />
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-3">
          {q.trim() === "" ? (
            <p className="px-2 py-6 text-center text-sm text-ink-500">
              اكتب عشان تدوّر في كل أماكن وين.
            </p>
          ) : hits.length ? (
            <SearchResults hits={hits} activeIndex={active} onNavigate={close} />
          ) : (
            <p className="px-2 py-6 text-center text-sm text-ink-500">ما لقينا شي.</p>
          )}
        </div>

        {q.trim() && (
          <button
            type="button"
            onClick={() => {
              close();
              router.push(`/search?q=${encodeURIComponent(q.trim())}`);
            }}
            className="block w-full border-t border-line bg-sand-100 px-4 py-3 text-center text-sm font-semibold text-ink-700 transition hover:bg-sand-200"
          >
            شوف كل النتائج
          </button>
        )}
      </div>
    </div>
  );
}
