"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { IconSearch } from "@/components/icons";

/**
 * Site-wide search, opened with ⌘K / Ctrl+K or the navbar button.
 *
 * Only the button and the shortcut live here. The dialog — and with it the
 * search engine, the place data and every place's artwork — is fetched on
 * first open, because the navbar is in the root layout and every page was
 * paying for a catalogue it does not show. Reading the privacy policy should
 * not cost the same JavaScript as searching.
 */
const SearchPaletteDialog = dynamic(() => import("@/components/SearchPaletteDialog"), {
  ssr: false,
});

export default function SearchPalette() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="بحث"
        className="flex min-h-11 items-center gap-2 rounded-full border border-line-control bg-white/80 px-4 text-sm font-semibold text-ink-500 transition hover:border-sea-300 hover:text-ink-700"
      >
        <IconSearch className="size-4" />
        <span className="hidden sm:inline">بحث</span>
        <kbd className="hidden rounded border border-line-strong bg-sand-100 px-1.5 text-2xs font-semibold text-ink-500 lg:inline" dir="ltr">
          ⌘K
        </kbd>
      </button>

      {open && <SearchPaletteDialog onClose={close} />}
    </>
  );
}
