"use client";

import Link from "next/link";
import PlaceIcon from "@/components/PlaceIcon";
import { SpeakButton } from "@/components/VoiceControls";
import { IconShouq } from "@/components/icons";
import { WAIN_AI_COPY } from "@/lib/wain-ai";
import type { SpeechPart } from "@/lib/voice-lines";

/**
 * شوق's answer, on the page instead of only in the air.
 *
 * `answerParts` builds a real reply to every search — it names the best place
 * and says why, gives the best time to go, warns about the Kuwaiti summer when
 * the place is open to it, and offers exactly one alternative. The search page
 * has always computed that and then done one thing with it: `speak()`.
 *
 * صوت وين is off unless you turn it on, so for almost everyone the answer was
 * computed and thrown away. شوق hands you to this page — «the search page's
 * own summary is the reply», says the call — and the summary was inaudible and
 * invisible at the same time. A typed search met a list of cards and no sign
 * that anybody had been asked anything.
 *
 * So the parts are rendered. Same sentences, same order, same source: there is
 * no second copy of what she says, which is the only way the spoken and the
 * written answer cannot drift.
 *
 * ## Why the lines are links
 *
 * Two of her parts are about a specific place — the recommendation and the
 * alternative — and `answerParts` says which by keying them `place-<slug>` and
 * `name-<slug>`. A sentence recommending a place, that you cannot press, is a
 * dead end in the middle of the answer. Those lines become links; the rest
 * stay text, because «أحلى وقت» is not somewhere you can go.
 */

/** The slug a part is about, if it is about one. */
function slugOf(key: string | undefined): string | null {
  if (!key) return null;
  const m = /^(?:place|name)-(.+)$/.exec(key);
  return m ? m[1] : null;
}

/** The heat warnings, which have to read as caution rather than as prose. */
const isWarning = (key: string | undefined) => key?.startsWith("summer-") ?? false;

export default function ShouqAnswer({ parts }: { parts: SpeechPart[] }) {
  if (parts.length === 0) return null;

  return (
    <section
      aria-label={`${WAIN_AI_COPY.name} — ${WAIN_AI_COPY.role}`}
      /**
       * The one live region on this page.
       *
       * The result count used to be the only thing announced, so a screen
       * reader heard «٧ نتيجة» and nothing about what any of them were. Two
       * polite regions on one page announce twice per query, so this takes the
       * role and the count gives it up: the answer names the top place, which
       * is strictly more than a number.
       *
       * `aria-atomic` because half an updated sentence is worse than a whole
       * one repeated.
       */
      aria-live="polite"
      aria-atomic="true"
      className="mb-5 rounded-3xl border border-coral-200 bg-gradient-to-b from-coral-50/80 to-white p-4 shadow-sm standalone:mb-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-coral-800">
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-coral-600 text-white">
            <IconShouq className="size-5" />
          </span>
          {WAIN_AI_COPY.name}
        </h2>
        {/* The same parts, out loud. Not a second answer — the same one. */}
        <SpeakButton parts={parts} label="اسمعها" />
      </div>

      <div className="mt-3 space-y-1.5">
        {parts.map((part, i) => {
          const slug = slugOf(part.key);

          if (slug) {
            return (
              <Link
                key={i}
                href={`/places/${slug}/`}
                className="group flex items-start gap-2.5 rounded-2xl px-2 py-1.5 -mx-2 transition hover:bg-coral-100/60"
              >
                <span aria-hidden="true" className="mt-0.5 shrink-0 text-coral-700">
                  <PlaceIcon slug={slug} className="size-5" />
                </span>
                <span className="text-sm font-semibold leading-relaxed text-ink-900 group-hover:text-coral-800">
                  {part.text}
                </span>
              </Link>
            );
          }

          if (isWarning(part.key)) {
            return (
              <p
                key={i}
                className="rounded-2xl bg-sun-500/12 px-3 py-2 text-sm leading-relaxed text-sun-800"
              >
                {part.text}
              </p>
            );
          }

          return (
            <p
              key={i}
              // The echo — what she heard you ask — is the only part with no
              // key at all, and it is a question, not advice. Quieter, so the
              // answer under it is the thing that reads first.
              className={
                part.optional
                  ? "px-2 text-xs text-coral-700/80"
                  : "px-2 text-sm leading-relaxed text-ink-600"
              }
            >
              {part.text}
            </p>
          );
        })}
      </div>
    </section>
  );
}
