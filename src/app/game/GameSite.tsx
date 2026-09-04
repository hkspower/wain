"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  CTA, DISTRICTS, FAQ, FLEET, GALLERY, HOWTO, INTRO, LABELS, LENGTHS,
  NAME, PILLARS, RIVALS_SECTION, ROAD, ROAD_NAMES, TAGLINE, type Bi,
} from "@/lib/gameSite";

type Lang = "en" | "ar";

export interface CarRow {
  id: string; name: string; ar: string; cls: string;
  price: number; topSpeedKmh: number; lengthM: number; locked: number;
}
export interface RivalRow {
  order: number; id: string; name: string; ar: string; crew: string; area: string;
  carName: string; carAr: string; carId: string;
  distance: string; distanceAr: string; km: number; topSpeedKmh: number;
}
export interface DistanceRow {
  id: string; km: number; name: string; ar: string; blurb: string; blurbAr: string;
}

const KEY = "gulf-road-nights-site-lang";

/**
 * Numbers in the reader's own digits.
 *
 * The game writes Arabic-Indic — ٨٫٥ كيلومتر, ٥:٥٠ — and a page that
 * says "the road is ٨٫٥ km long" in its prose and "8.5" in the card
 * beside it is two different documents sharing a screen. `ar-EG` is the
 * locale that produces those digits; `ar` alone resolves per-platform
 * and has given Western digits on some builds, which is the bug this
 * argument exists to avoid.
 */
const fmt = (n: number, lang: Lang, opts?: Intl.NumberFormatOptions) =>
  n.toLocaleString(lang === "ar" ? "ar-EG" : "en-US", opts);

export default function GameSite({
  cars, rivals, distances,
}: {
  cars: CarRow[];
  rivals: RivalRow[];
  distances: DistanceRow[];
}) {
  // English on the first paint, on both the server and the client,
  // because a hydration mismatch here would swap the whole page's
  // direction under the reader. The stored choice and the browser's own
  // language are applied in an effect, one frame later.
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "ar" || saved === "en") {
        setLang(saved);
        return;
      }
    } catch {}
    // No stored choice: follow the browser. Someone arriving with an
    // Arabic browser should not have to find the switch.
    if (typeof navigator !== "undefined" && /^ar\b/i.test(navigator.language || "")) {
      setLang("ar");
    }
  }, []);

  const choose = (l: Lang) => {
    setLang(l);
    try {
      localStorage.setItem(KEY, l);
    } catch {}
  };

  const ar = lang === "ar";
  const t = (b: Bi) => b[lang];
  /** The class that makes Arabic set like Arabic — cursive joins intact,
   *  no tracking, no synthesised slant. Nothing in English mode. */
  const arc = ar ? "grn-ar" : "";

  return (
    <div
      dir={ar ? "rtl" : "ltr"}
      lang={lang}
      className={`grn-bilingual bg-night-950 text-white ${arc}`}
    >
      {/* ------------------------------------------------------- HERO */}
      <section className="relative isolate overflow-hidden">
        <img
          src="/game/night.webp"
          srcSet="/game/night@800.webp 800w, /game/night.webp 1600w"
          sizes="100vw"
          alt={t({
            en: "Arabian Gulf Street at night, seen from behind a car",
            ar: "شارع الخليج العربي ليلا من خلف سيارة",
          })}
          width={1600}
          height={900}
          className="absolute inset-0 -z-10 size-full object-cover opacity-45"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-night-950/70 via-night-950/80 to-night-950" />

        <div className="mx-auto max-w-6xl px-4 pb-20 pt-14 sm:px-6 sm:pb-28 sm:pt-20">
          <div className="flex items-center justify-between gap-4">
            <span className="grn-label rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[0.7rem] text-white/70">
              🇰🇼 {t({ en: "Kuwait, after midnight", ar: "الكويت، بعد منتصف الليل" })}
            </span>
            <LangSwitch lang={lang} onChange={choose} />
          </div>

          <h1 className="mt-10 text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-7xl">
            {ar ? (
              <span className="grn-ar-display block">{NAME.ar}</span>
            ) : (
              <span className="block">{NAME.en}</span>
            )}
            {/* w-fit, not a bare block. A block-level span carrying the
                OTHER language's direction fills the line and then aligns
                its text to its own side, which put the Arabic title hard
                against the right edge of the page while the English one
                sat at the left — the two halves of one heading at
                opposite ends of the screen. Shrinking the box to its
                text leaves the box where the heading's own direction
                puts it, and the text inside it still reads correctly. */}
            <span
              className={`mt-3 block w-fit text-2xl font-semibold text-sodium-400 sm:text-3xl ${ar ? "" : "grn-ar"}`}
              lang={ar ? "en" : "ar"}
              dir={ar ? "ltr" : "rtl"}
            >
              {ar ? NAME.en : NAME.ar}
            </span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg text-white/80">{t(TAGLINE)}</p>
          <p className="mt-4 max-w-2xl leading-7 text-white/65">{t(INTRO)}</p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/race"
              className="rounded-xl bg-sodium-500 px-7 py-3 font-bold text-night-950 shadow-lg shadow-sodium-500/20 transition hover:bg-sodium-400"
            >
              {t(CTA.play)} →
            </Link>
            <Link
              href="/hub"
              className="rounded-xl border border-white/20 px-7 py-3 font-semibold text-white/85 transition hover:border-white/45 hover:text-white"
            >
              {t(CTA.hub)}
            </Link>
          </div>

          <dl className="mt-12 grid max-w-2xl grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
            <Stat n={fmt(cars.length, lang)} label={t(LABELS.cars)} />
            <Stat n={fmt(rivals.length, lang)} label={t(LABELS.rivals)} />
            <Stat n={fmt(8.5, lang)} label={t(LABELS.lapKm)} />
            {/* Narrower than the other three: this one is a range, not a
                figure, and at text-3xl it wrapped mid-range onto two
                lines. */}
            <Stat n={ar ? "٠٠:٠٠ – ٥:٥٠" : "00:00 – 05:50"} label={t(LABELS.window)} small />
          </dl>
        </div>
      </section>

      {/* ---------------------------------------------------- PILLARS */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="grid gap-5 sm:grid-cols-2">
          {PILLARS.map((p) => (
            <div
              key={p.title.en}
              className="rounded-2xl border border-white/10 bg-steel-900/60 p-6"
            >
              <span className="text-2xl">{p.icon}</span>
              <h3 className="mt-3 text-lg font-bold">{t(p.title)}</h3>
              <p className="mt-2 leading-7 text-white/65">{t(p.body)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------------------------------------------------- GALLERY */}
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <SectionHead title={t(LABELS.gallery)} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {GALLERY.map((shot, i) => (
            <figure
              key={shot.src}
              className={`overflow-hidden rounded-2xl border border-white/10 bg-steel-900/60 ${
                i === 0 ? "sm:col-span-2" : ""
              }`}
            >
              <img
                src={`/game/${shot.src}`}
                srcSet={`/game/${shot.src.replace(".webp", "@800.webp")} 800w, /game/${shot.src} 1600w`}
                sizes={i === 0 ? "(min-width: 640px) 66vw, 100vw" : "(min-width: 640px) 33vw, 100vw"}
                alt={t(shot.alt)}
                width={1600}
                height={900}
                loading={i === 0 ? "eager" : "lazy"}
                className="aspect-video w-full object-cover"
              />
              <figcaption className="px-4 py-3 text-sm leading-6 text-white/60">
                {t(shot.caption)}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------- ROAD */}
      <section className="border-y border-white/10 bg-night-900">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <SectionHead title={t(ROAD.heading)} />
          <p className="max-w-3xl leading-7 text-white/70">{t(ROAD.body)}</p>

          <h3 className="grn-label mt-9 text-[0.72rem] text-white/50">
            {t(ROAD.roadsLabel)}
          </h3>
          <div className="mt-3 flex flex-wrap gap-3">
            {ROAD_NAMES.map((r) => (
              <span
                key={r.en}
                className="rounded-xl border border-sodium-400/30 bg-sodium-500/10 px-4 py-2 font-semibold text-sodium-300"
              >
                {t(r)}
              </span>
            ))}
          </div>

          <h3 className="grn-label mt-8 text-[0.72rem] text-white/50">
            {t(ROAD.districtsLabel)}
          </h3>
          <ol className="mt-3 flex flex-wrap gap-2">
            {DISTRICTS.map((d, i) => (
              <li
                key={d.en}
                className="rounded-lg border border-white/12 bg-white/5 px-3 py-1.5 text-sm text-white/75"
              >
                <span className="me-1.5 text-white/35">{fmt(i + 1, lang)}</span>
                {t(d)}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------ FLEET */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <SectionHead title={t(FLEET.heading)} />
        <p className="max-w-3xl leading-7 text-white/70">{t(FLEET.body)}</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cars.map((c) => (
            <article
              key={c.id}
              className="overflow-hidden rounded-2xl border border-white/10 bg-steel-900/60"
            >
              <img
                src={`/cars/${c.id}.webp`}
                alt={ar ? c.ar : c.name}
                width={480}
                height={180}
                loading="lazy"
                className="w-full bg-night-900 object-cover"
              />
              <div className="p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-bold" dir="ltr">{c.name}</h3>
                  <span className="grn-ar text-sm text-white/70" lang="ar">{c.ar}</span>
                </div>
                <p className="grn-label mt-1 text-[0.68rem] text-white/45">
                  {t(FLEET.classes[c.cls] ?? { en: c.cls, ar: c.cls })}
                </p>
                <dl className="mt-3 space-y-1 text-sm text-white/65">
                  <Row
                    k={t(LABELS.price)}
                    v={c.price === 0 ? t(LABELS.free) : `${fmt(c.price, lang)} ${t(LABELS.kd)}`}
                  />
                  <Row k={t(LABELS.topSpeed)} v={`${fmt(c.topSpeedKmh, lang)} ${t(LABELS.kmh)}`} />
                  <Row
                    k={t(LABELS.length)}
                    v={`${fmt(c.lengthM, lang, { minimumFractionDigits: 2 })} ${t(LABELS.m)}`}
                  />
                </dl>
                {c.locked > 0 && (
                  <p className="mt-3 rounded-lg border border-sodium-400/25 bg-sodium-500/10 px-3 py-2 text-xs leading-5 text-sodium-300">
                    🔒 {t(FLEET.locked)}
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------- RIVALS */}
      <section className="border-y border-white/10 bg-night-900">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <SectionHead title={t(RIVALS_SECTION.heading)} />
          <p className="max-w-3xl leading-7 text-white/70">{t(RIVALS_SECTION.body)}</p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {rivals.map((r) => (
              <article
                key={r.id}
                className="flex gap-4 rounded-2xl border border-white/10 bg-steel-900/60 p-4"
              >
                <span className="grn-display mt-0.5 text-3xl font-bold text-white/20">
                  {fmt(r.order, lang)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-bold" dir="ltr">{r.name}</h3>
                    <span className="grn-ar text-sm text-sodium-300" lang="ar">{r.ar}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-white/50" dir="ltr">
                    {r.crew} · {r.area}
                  </p>
                  <dl className="mt-3 space-y-1 text-sm text-white/65">
                    <Row k={t(RIVALS_SECTION.carLabel)} v={ar ? r.carAr : r.carName} />
                    <Row
                      k={t(RIVALS_SECTION.callsLabel)}
                      v={`${fmt(r.km, lang)} ${t(LABELS.km)} — ${ar ? r.distanceAr : r.distance}`}
                    />
                    <Row
                      k={t(LABELS.topSpeed)}
                      v={`${fmt(r.topSpeedKmh, lang)} ${t(LABELS.kmh)}`}
                    />
                  </dl>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- LENGTHS */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <SectionHead title={t(LENGTHS.heading)} />
        <p className="max-w-3xl leading-7 text-white/70">{t(LENGTHS.body)}</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {distances.map((d) => (
            <div key={d.id} className="rounded-2xl border border-white/10 bg-steel-900/60 p-5">
              <p className="grn-display text-3xl font-bold text-sodium-400">
                {fmt(d.km, lang)}
                <span className="ms-1 text-base text-white/45">{t(LABELS.km)}</span>
              </p>
              <h3 className="mt-2 font-bold">{ar ? d.ar : d.name}</h3>
              <p className="mt-1 text-sm leading-6 text-white/60">{ar ? d.blurbAr : d.blurb}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------ HOWTO */}
      <section className="border-y border-white/10 bg-night-900">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <SectionHead title={t(HOWTO.heading)} />
          <div className="grid gap-5 sm:grid-cols-3">
            {HOWTO.steps.map((s) => (
              <div key={s.title.en} className="rounded-2xl border border-white/10 bg-steel-900/60 p-6">
                <span className="grn-display grid size-9 place-items-center rounded-full bg-sodium-500 font-bold text-night-950">
                  {fmt(Number(s.icon), lang)}
                </span>
                <h3 className="mt-3 font-bold">{t(s.title)}</h3>
                <p className="mt-2 leading-7 text-white/65">{t(s.body)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <SectionHead title={t(LABELS.faq)} />
        <div className="divide-y divide-white/10 border-y border-white/10">
          {FAQ.map((f) => (
            <details key={f.q.en} className="group py-4">
              <summary className="cursor-pointer list-none font-semibold text-white/90 transition group-open:text-sodium-300">
                {t(f.q)}
              </summary>
              <p className="mt-3 leading-7 text-white/65">{t(f.a)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* -------------------------------------------------------- CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-steel-800 to-night-900 px-6 py-14 text-center">
          <h2 className="text-3xl font-bold sm:text-4xl">{t(CTA.heading)}</h2>
          <p className="mx-auto mt-3 max-w-md text-white/60">{t(CTA.body)}</p>
          <Link
            href="/race"
            className="mt-8 inline-block rounded-xl bg-sodium-500 px-8 py-3 font-bold text-night-950 transition hover:bg-sodium-400"
          >
            {t(CTA.play)} →
          </Link>
        </div>
      </section>
    </div>
  );
}

function LangSwitch({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  // Both options are always shown, each written in its own language and
  // its own script. A single toggle labelled with the language you are
  // NOT reading is a puzzle in the one place a reader cannot afford one.
  return (
    <div className="flex overflow-hidden rounded-lg border border-white/15 text-sm">
      <button
        type="button"
        onClick={() => onChange("en")}
        aria-pressed={lang === "en"}
        className={`px-3 py-1.5 font-semibold transition ${
          lang === "en" ? "bg-white text-night-950" : "text-white/60 hover:text-white"
        }`}
      >
        English
      </button>
      <button
        type="button"
        onClick={() => onChange("ar")}
        aria-pressed={lang === "ar"}
        lang="ar"
        className={`grn-ar px-3 py-1.5 font-semibold transition ${
          lang === "ar" ? "bg-white text-night-950" : "text-white/60 hover:text-white"
        }`}
      >
        العربية
      </button>
    </div>
  );
}

function SectionHead({ title }: { title: string }) {
  return <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>;
}

function Stat({ n, label, small }: { n: string; label: string; small?: boolean }) {
  return (
    <div>
      <dt
        className={`grn-display font-bold text-white ${small ? "whitespace-nowrap text-xl sm:text-2xl" : "text-3xl"}`}
      >
        {n}
      </dt>
      <dd className="grn-label mt-0.5 text-[0.68rem] text-white/45">{label}</dd>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-white/40">{k}</dt>
      <dd className="text-white/80">{v}</dd>
    </div>
  );
}
