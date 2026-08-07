"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import SearchResults from "@/components/SearchResults";
import { IconSearch } from "@/components/icons";
import { usePlaces } from "@/lib/usePlaces";
import { buildIndex, search } from "@/lib/search";

/**
 * Site-wide search, opened with ⌘K / Ctrl+K or the navbar button.
 *
 * The index is built lazily on first open — a visitor who never searches never
 * pays for it — and results are keyboard-navigable so the whole flow works
 * without touching the mouse.
 */
export default function SearchPalette() {
  const router = useRouter();
  const { places } = usePlaces();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const index = useMemo(() => (open ? buildIndex(places) : null), [open, places]);
  const hits = useMemo(
    () => (index ? search(q, index, { limit: 8 }) : []),
    [q, index]
  );

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

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
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="بحث"
        className="flex min-h-11 items-center gap-2 rounded-full border border-sand-200 bg-white/80 px-4 text-sm font-semibold text-ink-500 transition hover:border-sea-300 hover:text-ink-700"
      >
        <IconSearch className="size-4" />
        <span className="hidden sm:inline">بحث</span>
        <kbd className="hidden rounded border border-sand-300 bg-sand-50 px-1.5 text-[10px] font-semibold text-ink-500 lg:inline" dir="ltr">
          ⌘K
        </kbd>
      </button>

      {open && (
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
            className="relative w-full max-w-xl overflow-hidden rounded-3xl border border-sand-200 bg-white shadow-2xl"
          >
            <div className="relative border-b border-sand-200">
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
                className="block w-full border-t border-sand-200 bg-sand-50 px-4 py-3 text-center text-sm font-bold text-ink-700 transition hover:bg-sand-100"
              >
                شوف كل النتائج
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
