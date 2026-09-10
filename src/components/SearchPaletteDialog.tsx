"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SearchResults, { optionId } from "@/components/SearchResults";
import SearchHub from "@/components/SearchHub";
import { IconSearch } from "@/components/icons";
import { usePlaces } from "@/lib/usePlaces";
import { buildIndex, search } from "@/lib/search";
import { useListboxKeys } from "@/lib/useListboxKeys";

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
/** One listbox per surface, named so the input can point at the same element. */
const LISTBOX_ID = "wain-palette-results";

export default function SearchPaletteDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { places } = usePlaces();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const index = useMemo(() => buildIndex(places), [places]);
  const hits = useMemo(() => search(q, index, { limit: 8 }), [q, index]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => {
    setQ("");
    closeRef.current();
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Enter opens the arrowed result, or — with nothing arrowed to — carries the
  // query to the full page, which is where a search that needs filters goes.
  const choose = useCallback(
    (i: number) => {
      const target = hits[i]?.doc.url ?? (q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : null);
      if (!target) return;
      close();
      router.push(target);
    },
    [hits, q, close, router]
  );

  const { active, onKeyDown } = useListboxKeys({
    count: hits.length,
    onChoose: choose,
    resetOn: q,
    optionIdAt: useCallback((i: number) => optionId(LISTBOX_ID, i), []),
  });

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
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls={LISTBOX_ID}
            aria-autocomplete="list"
            aria-activedescendant={hits.length ? optionId(LISTBOX_ID, active) : undefined}
            aria-label="ابحث في وين"
            placeholder="دوّر عن مكان، منطقة، أو جو…"
            className="w-full bg-transparent py-4 pe-4 ps-12 text-base text-ink-800 outline-none placeholder:text-ink-500/60"
          />
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-3">
          {q.trim() === "" ? (
            /* The palette opens with the caret already in the box, so
               «اكتب عشان تدوّر» was telling the visitor to do the thing the
               dialog had just done for them. The ask goes here instead —
               the same question the home page's band and /search put to
               them — and the scope it used to carry stays underneath,
               because «all of wain» is the part the placeholder does not
               say. */
            <div className="px-2 py-6 text-center">
              <p className="text-base font-semibold text-ink-800">شنو تدوّر؟</p>
              <p className="mt-1 text-sm text-ink-500">ندوّر لك في كل أماكن وين.</p>
              {/* The question, and then the answers to it. This dialog is
                  reachable from every route — it is the only control that is —
                  so it is where the site's moves belong, and it used to offer
                  none of them: a visitor who opened ⌘K without a word in mind
                  read a sentence and closed it again. */}
              <SearchHub className="mt-6" onNavigate={close} />
            </div>
          ) : hits.length ? (
            <SearchResults hits={hits} activeIndex={active} onNavigate={close} listboxId={LISTBOX_ID} />
          ) : (
            /* «ما لقينا شي.» on its own was the dead end /search had already
               been given a way out of, still being drawn here. Same way out,
               same component. */
            <div className="px-2 py-6 text-center">
              <p className="text-sm text-ink-500">ما لقينا شي.</p>
              <SearchHub className="mt-6" onNavigate={close} />
            </div>
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
