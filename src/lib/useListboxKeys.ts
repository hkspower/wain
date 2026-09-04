"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Arrow keys for a combobox whose results are a listbox.
 *
 * Two surfaces search this site — the ⌘K palette and the /search page — and
 * only one of them answered the keyboard. The palette moved a highlight with
 * ↑ and ↓; the page, which is the one built for searching, did nothing at all,
 * so anyone who learned the keys in the overlay lost them on arrival. Shared
 * here because two implementations of "what does ↓ do" is how they drift.
 *
 * What it does beyond moving an integer, and why each part is not optional:
 *
 *   Home / End      A long result list is reachable in two keys instead of
 *                   twenty. Guarded on there being results, so the keys keep
 *                   their normal meaning inside the text when the list is
 *                   empty.
 *   clamp on shrink The list changes under the cursor with every keystroke.
 *                   Typing one more letter can cut nine results to two while
 *                   `active` sits at 6, and Enter then opens `hits[6]` —
 *                   undefined — so the press does nothing at all and the
 *                   search feels broken rather than empty.
 *   scroll into view Arrowing past the bottom of a scrolling panel used to
 *                   move the selection somewhere the reader could not see.
 *                   `block: "nearest"` scrolls only when it has to, so the
 *                   list does not jump on every press.
 *
 * `aria-activedescendant` is the caller's job, but this is what makes it
 * truthful: the id it names has to exist and has to be the one that moved.
 */
export function useListboxKeys({
  count,
  onChoose,
  resetOn,
  optionIdAt,
}: {
  count: number;
  /** Enter, with the index the reader had arrowed to. */
  onChoose: (index: number) => void;
  /** Changing this puts the cursor back at the top — the query, normally. */
  resetOn: unknown;
  /** Element id for an index, so the active option can be scrolled to. */
  optionIdAt?: (index: number) => string;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    setActive(0);
  }, [resetOn]);

  // The list shrank under the cursor. Without this, Enter reaches past the
  // end of the array and silently does nothing.
  useEffect(() => {
    setActive((i) => (count === 0 ? 0 : Math.min(i, count - 1)));
  }, [count]);

  useEffect(() => {
    if (!optionIdAt || count === 0) return;
    document.getElementById(optionIdAt(active))?.scrollIntoView({ block: "nearest" });
  }, [active, count, optionIdAt]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (count === 0 ? 0 : Math.min(i + 1, count - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === "Home" && count > 0) {
        e.preventDefault();
        setActive(0);
      } else if (e.key === "End" && count > 0) {
        e.preventDefault();
        setActive(count - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onChoose(active);
      }
    },
    [count, active, onChoose]
  );

  return { active, setActive, onKeyDown };
}
