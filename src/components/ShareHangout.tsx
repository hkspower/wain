"use client";

import { useEffect, useMemo, useState } from "react";
import AddToCalendar from "@/components/AddToCalendar";
import { IconCheck, IconSend } from "@/components/icons";
import { backendEnabled } from "@/lib/backend";
import { haptic } from "@/lib/haptics";
import type { Place } from "@/lib/places";
import {
  SHORTLIST_MAX,
  defaultWhen,
  defaultWhenFor,
  hangoutMessage,
  hangoutTitle,
  inviteUrl,
  kuwaitDay,
  mapsUrl,
  msToNextKuwaitHour,
  planPhrase,
  shareHangout,
  shortlistMessage,
  shortlistTitle,
  fitShortlist,
  newPollId,
  shortlistUrl,
  whenOptions,
  whenOptionsFor,
  type Day,
  type ShareOutcome,
  type WhenId,
} from "@/lib/hangout";

/**
 * «رسّلها للربع» — send this place to the group, with a time on it.
 *
 * Inline rather than a dialog, like the order and queue panels beside it. A
 * modal would need a focus trap and a way out for one decision with four taps
 * in it, and it would cover the page the visitor is still deciding about.
 *
 * The time is chosen before sending and never after, because the message is
 * composed from it — there is no editing a WhatsApp message once it is in
 * somebody's chat.
 *
 * `choices` is the search page's addition, and it is why this panel is one
 * component rather than two. There, the place is not settled — the visitor is
 * looking at forty results — so the panel asks WHICH before it asks WHEN. On a
 * place page the question is already answered by the URL, nothing is passed,
 * and the row does not render. Two copies of the time rules is the thing this
 * avoids: the summer rule, the expiring hours and the message format are
 * subtle enough that a second implementation would drift within a week.
 */
/** The time this device sent last, kept on the device only (7 October): the
 *  next plan starts from it when it is still offered. */
const USUAL_WHEN_KEY = "wain:usual-when";
function readUsualWhen(): WhenId | null {
  try {
    return (localStorage.getItem(USUAL_WHEN_KEY) as WhenId | null) ?? null;
  } catch {
    return null;
  }
}
function rememberUsualWhen(when: WhenId): void {
  try {
    localStorage.setItem(USUAL_WHEN_KEY, when);
  } catch {
    /* storage refused: the next plan starts from the rules alone */
  }
}

export default function ShareHangout({
  place,
  choices,
  onChoose,
  id,
}: {
  place: Place;
  /** An anchor for links that land on this panel — the place page's is
   *  «share», which a finished call's «رسّلها للربع» opens. */
  id?: string;
  /** Places the visitor may switch between. Fewer than two renders no row. */
  choices?: Place[];
  onChoose?: (slug: string) => void;
}) {
  const [when, setWhen] = useState<WhenId | null>(null);
  const [outcome, setOutcome] = useState<ShareOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  // What was last sent — the text, for the one outcome where nothing took
  // it and the visitor needs to see it; the plan, for the calendar button.
  const [sent, setSent] = useState<{ text: string; when: WhenId; day: Day; list: boolean } | null>(null);

  /**
   * «خلّهم يختارون» — send two or three of the choices and let the group pick
   * (see shortlistMessage). Offered only where there is a choice to hand on;
   * a place page has one place and no row.
   */
  const canList = (choices?.length ?? 0) >= 2;
  const [mode, setMode] = useState<"one" | "list">("one");
  const [picked, setPicked] = useState<string[]>([]);
  const listMode = canList && mode === "list";
  const listed = useMemo(
    () => (choices ?? []).filter((c) => picked.includes(c.slug)),
    [choices, picked]
  );
  // The first few, until the visitor says otherwise; re-seeded when the
  // results under the panel change, so it never lists places no longer shown.
  const choiceKey = (choices ?? []).map((c) => c.slug).join(",");
  const [now, setNow] = useState<Date | null>(null);
  const clockKnown = now !== null;
  useEffect(() => {
    // Places that go together for one evening (fitShortlist), once the hour
    // that decides «together» is known; the first few until then.
    const list = choices ?? [];
    setPicked((now ? fitShortlist(list, now) : list.slice(0, SHORTLIST_MAX)).map((c) => c.slug));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the slugs and the clock arriving, not identities
  }, [choiceKey, clockKnown]);

  // The plan is shown ready, as one line, and the chips only on «غيّر»
  // (7 October, on request): most people send the plan they are offered,
  // and nine time chips and a mode switch stood between them and the button.
  const [open, setOpen] = useState(false);

  /**
   * A result from the last place is not a result about this one.
   *
   * Without this, sending «مقاهي المباركية» and then switching the target left
   * «انتسخت — الصقها بالجروب» sitting under a different name, which reads as a
   * claim that the new place was sent too.
   */
  useEffect(() => setOutcome(null), [place.slug, mode, picked]);

  // The hour decides both which options exist and which is preselected, and
  // the hour is not knowable while this is prerendered — the exported HTML is
  // shared by everybody, so a default baked in at build time would be wrong
  // for every visitor after the one whose build it was. Chosen on mount.
  useEffect(() => setNow(new Date()), []);

  // A link to `#share` arrives before this panel exists (it renders after
  // mount, below), so the browser found no anchor to scroll to. Once drawn,
  // it scrolls itself there.
  useEffect(() => {
    if (!now || !id || window.location.hash !== `#${id}`) return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when first drawn
  }, [now === null]);

  /**
   * The hour keeps moving, and this panel used to stop watching it.
   *
   * hangout.ts drops each evening option as it passes, «because offering ٧
   * مساءً at nine o'clock is offering a plan that already failed» — and it did
   * that once, on mount, and never again. A place page is exactly the kind of
   * page somebody leaves open while the group argues, so one opened at 18:55
   * was still offering «الليلة الساعة ٧» at half past seven, still had it
   * selected, and would still send it. The guarantee was real and honoured for
   * a single instant.
   *
   * One timeout to the next Kuwait hour rather than a ticking interval: every
   * boundary in that list is on the hour, so there is nothing in between worth
   * a render. A second past it, so a slow timer cannot land on the wrong side.
   */
  useEffect(() => {
    if (!now) return;
    const id = window.setTimeout(() => setNow(new Date()), msToNextKuwaitHour(now) + 1_000);
    return () => window.clearTimeout(id);
  }, [now]);

  // The place is passed so the summer rule reaches the chips: an unshaded
  // place in July stops offering «الحين» rather than offering a plan the rest
  // of the site would refuse to make. See whenOptions.
  const options = useMemo(
    () => (now ? (listMode ? whenOptionsFor(listed, now) : whenOptions(now, place)) : []),
    [now, place, listMode, listed]
  );

  // Picks the first time, and re-picks when the chosen one expires — which is
  // the half that matters. An expired selection is not merely shown, it is
  // what gets sent: the chip disappears from the row while `when` still holds
  // its id, and the message is composed from `when`.
  useEffect(() => {
    if (!now) return;
    // Checked against the same list the chips are drawn from — place included.
    // Without the place this asked a different question than the row answered,
    // so a slot the summer rule had just removed still counted as valid and
    // still got sent.
    const valid = listMode ? whenOptionsFor(listed, now) : whenOptions(now, place);
    if (when === null || !valid.some((o) => o.id === when)) {
      // The time this device usually sends, when it is still on offer —
      // checked against the same list, so a habit never sends a time the
      // rules above have removed (an evening hour gone, the midday heat).
      const usual = readUsualWhen();
      setWhen(
        usual && valid.some((o) => o.id === usual)
          ? usual
          : listMode ? defaultWhenFor(listed, now) : defaultWhen(place, now)
      );
    }
  }, [now, when, place, listMode, listed]);

  const send = async () => {
    if (!when || busy) return;
    if (listMode && listed.length < 2) return;
    setBusy(true);
    setOutcome(null);
    haptic("tap");
    // Canonical, and carrying the time AND the day — see inviteUrl. Built
    // here rather than in an effect so it is composed at the moment of
    // sending, from the choice that is actually selected.
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const day = kuwaitDay();
    const text = listMode
      ? shortlistMessage({
          places: listed,
          when,
          // A fresh poll per message, so /pick can count this group's votes.
          url: shortlistUrl(listed, when, origin, day, backendEnabled ? newPollId() : null),
        })
      : hangoutMessage({ place, when, url: inviteUrl(place, when, origin, day) });
    setSent({ text, when, day, list: listMode });
    const result = await shareHangout({ text, title: listMode ? shortlistTitle() : hangoutTitle(place) });
    if (result === "shared" || result === "whatsapp" || result === "copied") {
      haptic("success");
      rememberUsualWhen(when);
    }
    setOutcome(result);
    setBusy(false);
  };

  // The chips wait for the clock — rendering them with a build-time hour
  // would show «٧ مساءً» to somebody at midnight — but the panel itself does
  // not: it used to render nothing until mount, so a place page drew its
  // whole lower half and then grew a panel into it (3 October). The shell is
  // in the HTML; the chip row is `aria-busy` until the hour is known.
  const ready = now !== null && when !== null;

  return (
    <section id={id} className="mt-5 scroll-mt-4 rounded-3xl border border-line bg-white p-4 sm:p-5 shadow-xs">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink-900">
        <IconSend className="size-5 text-coral-700" />
        رسّلها للربع
      </h2>
      {/* The plan, ready: what and when, in one line, with «غيّر» for the
          chips. Not a live region: on /search it would be a second announcer
          beside شوق's answer (shouq-search counts them), and a chip already
          says it was chosen through aria-pressed. */}
      <div className="mt-3 flex items-start justify-between gap-3 rounded-2xl bg-sand-100 p-3" data-plan-line="">
        <div className="min-w-0">
          <p className="truncate font-semibold text-ink-900" data-plan-what="">
            {listMode ? listed.map((c) => c.nameAr).join("، ") : place.nameAr}
          </p>
          <p className="mt-0.5 text-sm text-ink-600" data-plan-when="">
            {ready && when ? planPhrase(when, now ? kuwaitDay(now) : null, now ?? undefined) : "…"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => { haptic("select"); setOpen((o) => !o); }}
          aria-expanded={open}
          aria-controls={id ? `${id}-choices` : undefined}
          className="inline-flex min-h-tap shrink-0 items-center gap-1 rounded-full px-3 text-sm font-semibold text-sea-700 transition hover:bg-sea-50"
        >
          {open ? "تمام" : "غيّر"}
          <span aria-hidden="true" className={`transition ${open ? "-rotate-90" : ""}`}>‹</span>
        </button>
      </div>

      <div id={id ? `${id}-choices` : undefined} hidden={!open}>
      {/* Which place — only where the place is still in question. The chips
          match the filter chips above the results rather than inventing a
          second selected-chip style for the same page. */}
      {canList && (
        <div className="mt-4 inline-flex rounded-full bg-sand-100 p-1" role="group" aria-label="كم مكان ترسل؟">
          {(
            [
              ["one", "مكان واحد"],
              ["list", "خلّهم يختارون"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => { haptic("select"); setMode(id); }}
              aria-pressed={mode === id}
              className={`min-h-tap rounded-full px-4 text-sm font-semibold transition ${
                mode === id ? "bg-white text-ink-900 shadow-sm" : "text-ink-600 hover:text-ink-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {choices && choices.length > 1 && (
        <fieldset className="mt-4">
          <legend className="text-xs font-semibold text-ink-600">
            {listMode ? "أي أماكن؟ (لين ٣)" : "أي مكان؟"}
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {choices.map((c) => {
              const inList = picked.includes(c.slug);
              const active = listMode ? inList : c.slug === place.slug;
              // A fourth place is not offered: the list is full at three.
              const full = listMode && !inList && picked.length >= SHORTLIST_MAX;
              return (
                <button
                  key={c.slug}
                  type="button"
                  disabled={full}
                  onClick={() => {
                    haptic("select");
                    if (!listMode) return onChoose?.(c.slug);
                    setPicked((prev) => (inList ? prev.filter((x) => x !== c.slug) : [...prev, c.slug]));
                  }}
                  aria-pressed={active}
                  className={`min-h-tap max-w-full truncate rounded-full px-4 text-sm font-semibold transition disabled:opacity-40 ${
                    active
                      ? "bg-ink-900 text-white"
                      : "border border-line-control bg-white text-ink-600 hover:border-sea-300"
                  }`}
                >
                  {c.nameAr}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      <fieldset className="mt-4">
        <legend className="text-xs font-semibold text-ink-600">متى؟</legend>
        <div className="mt-2 flex min-h-tap flex-wrap gap-2" aria-busy={!ready}>
          {options.map((o) => {
            const active = o.id === when;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => { setWhen(o.id); setOutcome(null); }}
                aria-pressed={active}
                className={`min-h-tap rounded-full px-4 text-sm font-semibold transition ${
                  active
                    ? "bg-coral-700 text-white shadow-sm"
                    : "border border-line-control bg-sand-100 text-ink-700 hover:bg-sand-200"
                }`}
              >
                {o.labelAr}
              </button>
            );
          })}
        </div>
      </fieldset>
      </div>

      {listMode && listed.length < 2 && (
        <p className="mt-3 text-sm text-ink-600" role="status">اختر مكانين على الأقل.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={send}
          disabled={!ready || busy || (listMode && listed.length < 2)}
          className="inline-flex min-h-tap items-center gap-2 rounded-xl bg-coral-700 px-6 text-base font-semibold text-white shadow-sm transition hover:bg-coral-800 disabled:opacity-60"
        >
          <IconSend className="size-4" />
          {busy ? "لحظة…" : listMode ? "رسّل القائمة" : "رسّلها"}
        </button>
        {/* The other way to send, without opening the chips: a list for the
            group to vote on, or back to one place. */}
        {canList && !open && (
          <button
            type="button"
            onClick={() => { haptic("select"); setMode(listMode ? "one" : "list"); }}
            className="inline-flex min-h-tap items-center text-sm font-semibold text-ink-600 underline underline-offset-4 transition hover:text-ink-900"
          >
            {listMode ? "مكان واحد بس" : "خلّهم يختارون"}
          </button>
        )}
      </div>

      {/* Only ever one line, and never one that scolds somebody for changing
          their mind — a cancelled share sheet says nothing at all. */}
      {outcome === "copied" && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-palm-700" role="status">
          <IconCheck className="size-4" />
          انتسخت — الصقها بالجروب.
        </p>
      )}
      {outcome === "whatsapp" && (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-palm-700" role="status">
          <IconCheck className="size-4" />
          فتحنا لك واتساب.
        </p>
      )}
      {/* Nothing took it — no share sheet, a blocked popup, no clipboard. It
          used to say «انسخ الرابط من فوق», which on /search and in سالم's
          chat pointed at an address bar holding no invitation at all. The
          message is the thing they need, so here it is, with its own copy. */}
      {outcome === "failed" && sent && (
        <div className="mt-3" role="alert">
          <p className="text-sm font-semibold text-ink-600">ما قدرنا نرسلها — هذا النص، انسخه والصقه بالجروب.</p>
          <textarea
            readOnly
            value={sent.text}
            rows={6}
            aria-label="نص الرسالة"
            onFocus={(e) => e.currentTarget.select()}
            className="mt-2 w-full rounded-xl border border-line bg-sand-100 p-2 text-sm leading-relaxed text-ink-800"
          />
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(sent.text);
                haptic("success");
                setOutcome("copied");
              } catch {
                /* the text is already on screen, selectable */
              }
            }}
            className="mt-2 inline-flex min-h-tap items-center gap-1.5 rounded-xl border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300 hover:text-sea-700"
          >
            انسخ
          </button>
        </div>
      )}
      {/* The sender's own copy of the plan, once it has gone out. Not for a
          shortlist: nobody has chosen yet, so there is no plan to keep. */}
      {sent && !sent.list && (outcome === "shared" || outcome === "whatsapp" || outcome === "copied") && (
        <AddToCalendar
          className="mt-3"
          place={place}
          when={sent.when}
          day={sent.day}
          phrase={planPhrase(sent.when, sent.day)}
          url={inviteUrl(place, sent.when, typeof window === "undefined" ? "" : window.location.origin, sent.day)}
          mapsUrl={mapsUrl(place)}
        />
      )}
    </section>
  );
}
