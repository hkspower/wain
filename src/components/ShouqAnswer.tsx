"use client";

import Link from "next/link";
import { SpeakButton } from "@/components/VoiceControls";
import { IconSend, IconShouq } from "@/components/icons";
import { WAIN_AI_COPY } from "@/lib/wain-ai";
import type { SpeechPart } from "@/lib/voice-lines";

/**
 * شوق's answer, on the page instead of only in the air.
 *
 * `answerParts` builds a real reply to every search — the place to try and
 * where it is, then when to go, or the Kuwaiti summer's warning instead when
 * the place is open to it. The search page has always computed that and then
 * done one thing with it: `speak()`.
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
 * ## Why the line is a link
 *
 * One of her parts is about a specific place — «جرّب …» — and `answerParts`
 * says which by keying it `try-<slug>`. A sentence recommending a place, that
 * you cannot press, is a dead end in the middle of the answer. That line is a
 * link; the rest stay text, because «روح بالليل» is not somewhere you can go.
 * (There used to be two: the alternative, «وإذا تبي غيره», was cut from the
 * answer on 3 October — it is the second card in the list underneath.)
 */

/** The slug a part is about, if it is about one. */
function slugOf(key: string | undefined): string | null {
  if (!key) return null;
  const m = /^try-(.+)$/.exec(key);
  return m ? m[1] : null;
}

/** The heat warnings, which have to read as caution rather than as prose. */
const isWarning = (key: string | undefined) => key?.startsWith("summer-") ?? false;

/**
 * One line first, the rest a tap away — 3 October, on request.
 *
 * The whole answer used to be drawn open: intro, recommendation, best time,
 * the heat warning, «وإذا تبي غيره» and the alternative. On a 390 phone that
 * was ~320px of card, and the first result row started at ~640px — under the
 * card, which named the same two places the list was about to. So the card
 * leads with the one line that answers the question (her recommendation, or
 * on a miss the line saying what to try), keeps a heat warning visible
 * because it is a caution rather than detail, and folds the rest into a
 * native <details>. Every part is still rendered — the spoken answer and the
 * written one are still the same parts — only the reading order changed.
 *
 * Since the answer was shortened (3 October) «the rest» is the best time, or
 * nothing: a heat line replaces the best time, and it is shown, not folded.
 * The header is her name alone; «— أقترح عليك:» beside it went with the
 * spoken intro it echoed.
 */
export default function ShouqAnswer({
  parts,
  query,
  onShare,
}: {
  parts: SpeechPart[];
  /** The question, for «كمّل مع سالم» — the same question, in his chat. */
  query?: string;
  /** «رسّلها للربع» for the place she named: the page's own share panel, on it. */
  onShare?: (slug: string) => void;
}) {
  if (parts.length === 0) return null;

  // The recommendation if there is one, else the first thing she actually
  // says (the echo of a spoken question is not an answer, so it is skipped).
  const placeAt = parts.findIndex((p) => p.key?.startsWith("try-"));
  const lead = placeAt >= 0 ? placeAt : parts.findIndex((p) => !p.optional && !isWarning(p.key));
  const warnings = parts.filter((p) => isWarning(p.key));
  const rest = parts.filter((p, i) => i !== lead && !isWarning(p.key));
  const recommended = placeAt >= 0 ? slugOf(parts[placeAt].key) : null;

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
      className="mb-4 rounded-2xl border border-coral-200 bg-gradient-to-b from-coral-50/80 to-white p-3 shadow-sm"
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden="true" className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-coral-600 text-white">
          <IconShouq className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-xs font-semibold text-coral-800">{WAIN_AI_COPY.name}</h2>
          {lead >= 0 && <Part part={parts[lead]} lead />}
        </div>
      </div>

      {warnings.map((part, i) => (
        <Part key={i} part={part} />
      ))}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {rest.length > 0 ? (
          <details className="group/more min-w-0 flex-1">
            <summary className="inline-flex min-h-tap cursor-pointer list-none items-center gap-1 text-xs font-semibold text-coral-700 underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="transition group-open/more:rotate-90">‹</span>
              جوابها كامل
            </summary>
            <div className="mt-1 space-y-1.5">
              {rest.map((part, i) => (
                <Part key={i} part={part} />
              ))}
            </div>
          </details>
        ) : (
          <span />
        )}
        {/* The same parts, out loud. Not a second answer — the same one. */}
        <SpeakButton parts={parts} label="اسمعها" />
      </div>

      {/* Where to go from her answer, 3 October, on request: send the place
          she named to the group (a call used to end on this page with the
          share panel a screen further down, unmentioned), or carry on with
          سالم — the same question, typed, with his memory of it. */}
      {(recommended || query) && (
        <div className="mt-2 flex flex-wrap gap-2 border-t border-coral-100 pt-2">
          {recommended && onShare && (
            <button
              type="button"
              onClick={() => onShare(recommended)}
              className="inline-flex min-h-tap items-center gap-1.5 rounded-xl bg-coral-700 px-3 text-sm font-semibold text-white transition hover:bg-coral-800"
            >
              <IconSend className="size-4" aria-hidden="true" />
              رسّلها للربع
            </button>
          )}
          {query && (
            <Link
              href={`/salem/?q=${encodeURIComponent(query)}`}
              className="inline-flex min-h-tap items-center rounded-xl border border-coral-200 bg-white px-3 text-sm font-semibold text-coral-800 transition hover:border-coral-300"
            >
              كمّل مع سالم
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

function Part({ part, lead = false }: { part: SpeechPart; lead?: boolean }) {
  const slug = slugOf(part.key);

  // Only the lead names a place now: the second place, which was drawn here
  // as a link with its icon, left the answer on 3 October.
  if (slug) {
    return (
      <Link
        href={`/places/${slug}/`}
        className="group mt-0.5 -mx-1 flex items-start gap-2 rounded-xl px-1 py-0.5 transition hover:bg-coral-100/60"
      >
        <span className="text-sm font-semibold leading-relaxed text-ink-900 group-hover:text-coral-800">
          {part.text}
        </span>
      </Link>
    );
  }

  if (isWarning(part.key)) {
    return (
      <p className="mt-2 rounded-xl bg-sun-500/12 px-3 py-2 text-sm leading-relaxed text-sun-800">
        {part.text}
      </p>
    );
  }

  return (
    <p
      // The echo — what she heard you ask — is the only part with no key at
      // all, and it is a question, not advice. Quieter, so the answer under
      // it is the thing that reads first.
      className={
        part.optional
          ? "px-2 text-xs text-coral-700/80"
          : lead
            ? "mt-0.5 text-sm font-semibold leading-relaxed text-ink-900"
            : "px-2 text-sm leading-relaxed text-ink-600"
      }
    >
      {part.text}
    </p>
  );
}
