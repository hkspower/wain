import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { IconArrowRight } from './icons'
import { phpSlides } from '../lib/backend'

// The home hero, in three tiers, first one that exists wins:
//
//   1. THE OWNER'S SLIDES, from /backends -> Slides. Rows in the database,
//      served by api.php?r=slide_image. Any number, with their own words.
//   2. THE SHIPPED BANNER (see BANNER below) — finished artwork in the
//      package, one per language, one crop per device. This is what the shop
//      launches with and what most visitors will actually see.
//   3. THE DRAWN SCENES — strength, cardio, and the multi-sport arena
//      (football / kickboxing / swimming), rendered as SVG. They are the
//      last resort now rather than the default: they exist so that a server
//      missing /hero still shows a hero rather than a black box.
//
// The drawn scenes probe for the owner's photograph first:
//
//   /hero/mobile/<id>.jpg   and   /hero/desktop/<id>.jpg
//   ids: strength, cardio, arena
//
// Those files live ONLY on the server (upload them in hPanel File Manager;
// a publish never touches /hero because dist never contains those names).
// Until they exist, the slide shows the drawn scene: anatomically
// proportioned athletes as backlit silhouettes (heroFigures.js) with rim
// light, contact shadows and film grain — the sports-poster treatment,
// because shipping nothing while the photography is pending is worse, and
// shipping fake "photos" of people who do not exist is not this brand.
//
// Accessibility is the WAI carousel pattern plus WCAG 2.2.2: auto-advance
// pauses on hover and on keyboard focus, there is an explicit pause button,
// and prefers-reduced-motion disables the autoplay entirely (the slides are
// still reachable through the controls). Slide 1's title is the page h1 —
// the other slides use a styled <p>, so the page keeps exactly one h1 with
// stable content.
const PHOTO_DIR = '/hero'
const PHOTO_EXT = '.jpg'
const DESKTOP_AT = '(min-width: 768px)'
const INTERVAL_MS = 6500

const SLIDE_IDS = ['strength', 'cardio', 'arena']

// THE SHIPPED BANNER — what a visitor sees before the owner has uploaded
// anything, and the hero this shop actually launches with.
//
// It ships in the package (unlike /hero/<id>.jpg above, which is server-side
// only) because it is finished artwork, not a placeholder: brand.hero's
// build-banner.py composes it from the studio photograph with the headline set
// as outlines. Two languages, because the headline is IN the picture — an
// Arabic visitor cannot be shown Latin type — and two crops, because the
// desktop banner is 2.53:1 and a phone's hero is about 0.72:1, so a cover-crop
// of one for the other shows a quarter of it.
//
// The database still wins. The moment /backends has a slide, this is gone.
const BANNER = (device, lang) => `/hero/${device}/banner-${lang}.webp`

// THE HERO'S HEIGHT IS DECIDED BEFORE THE FIRST PAINT, NOT HERE.
//
// It is a fixed minimum rather than anything fluid because the hero is the
// first thing that paints, and a height that resolves after the font or the
// photograph loads is a layout shift on the most-viewed element of the site —
// a previous version measured CLS 0.0456 in Arabic for exactly that reason.
//
// The owner's chosen size, though, arrives with /api?r=slides, which lands
// AFTER the paint. Applying it on arrival re-ran the same mistake: the hero
// grew, the whole page moved down, and CLS measured 0.042 in one jump at 3.3s.
// So the boot script in index.html reads the last known size from
// localStorage and writes --hero-h before anything renders; this class simply
// consumes it. A change by the owner is cached below and takes effect on the
// NEXT load, rather than by moving the page under whoever is reading it.
const HERO_HEIGHT = 'min-h-[var(--hero-h,540px)] md:min-h-[var(--hero-h-md,640px)]'

// Kept so the cached value can be validated — an unknown string in storage
// must fall back, not produce an invalid CSS length.
const SIZES = ['short', 'tall', 'full']

// The slides the admin has uploaded, plus how they should play.
//
// Until there are any, this returns null and the component renders the three
// drawn scenes it ships with — the same fallback the category tiles use. A
// home page that renders nothing while the photography is pending is worse
// than one that renders the artwork.
function useHeroConfig() {
  const [config, setConfig] = useState(null)
  useEffect(() => {
    let alive = true
    phpSlides()
      .then((d) => { if (alive && d) setConfig(d) })
      // No /api (the html5 fallback, a preview server, a half-set-up host) is
      // not an error here: it means "use the artwork", which is what null does.
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return config
}

// A stable shuffle: the order is decided ONCE per mount, not on every render.
// Re-shuffling on a re-render would move the slide out from under whoever was
// reading it, which is the opposite of what the setting is for.
function shuffled(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
const TONE = { strength: 'hero-strength', cardio: 'hero-cardio', arena: 'hero-arena' }
const SCENES = { strength: SceneStrength, cardio: SceneCardio, arena: SceneArena }

export default function HeroSlider() {
  const { t, lang } = useLang()
  const T = t.heroSlides
  const rtl = lang === 'ar'
  const [index, setIndex] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [stopped, setStopped] = useState(false) // the explicit pause button
  const [hidden, setHidden] = useState(false) // background tab
  // Read once: a user who toggles the OS setting mid-visit will get the new
  // behaviour on the next page, which is soon enough.
  const reduced = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ).current

  // What the admin has set up, if anything.
  const config = useHeroConfig()

  // Remember the size for the next visit. Deliberately NOT applied now — see
  // the note on HERO_HEIGHT: applying it here is what caused the shift.
  useEffect(() => {
    const size = config?.hero?.size
    if (!SIZES.includes(size)) return
    try {
      if (localStorage.getItem('sporta_hero_size') !== size) {
        localStorage.setItem('sporta_hero_size', size)
      }
    } catch { /* storage disabled */ }
  }, [config])
  const hero = config?.hero ?? {}
  const intervalMs = Math.max(2000, Number(hero.speed_ms) || INTERVAL_MS)

  // The slide list: the admin's, or the drawn scenes. Built once per config so
  // the shuffle does not re-roll on every render and move the slide out from
  // under whoever is reading it.
  // If the shipped banner is not on the server — someone extracted the zip
  // without /hero, or deleted it — the drawn scenes come back rather than the
  // hero going blank. It is the same reasoning as the -rtl probe below.
  const [bannerOk, setBannerOk] = useState(true)
  const items = useMemo(() => {
    const uploaded = config?.slides ?? []
    const base = uploaded.length
      ? uploaded.map((s) => ({ kind: 'photo', ...s }))
      : bannerOk
        ? [{ kind: 'banner', id: 'banner' }]
        : SLIDE_IDS.map((id) => ({ kind: 'drawn', id }))
    return hero.shuffle ? shuffled(base) : base
  }, [config, hero.shuffle, bannerOk])

  const count = items.length
  // Autoplay is a setting; pausing is not. Hover, focus, a background tab and
  // prefers-reduced-motion all still stop it, because WCAG 2.2.2 requires
  // moving content to be pausable however the shop has configured it.
  const paused = hovered || focused || stopped || hidden || reduced || hero.autoplay === false

  useEffect(() => {
    const onVis = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    if (paused || count < 2) return undefined
    const id = setInterval(() => setIndex((i) => (i + 1) % count), intervalMs)
    return () => clearInterval(id)
  }, [paused, count, intervalMs])

  // A shorter list than the one that was showing must not leave the index past
  // its end — deleting the last slide in the admin would otherwise blank the
  // hero until a reload.
  useEffect(() => { setIndex((i) => (i < count ? i : 0)) }, [count])

  const goTo = (i) => setIndex((i + count) % count)

  // Swipe. The side arrows are desktop-only (on a phone they sat on top of
  // the copy), so touch gets the gesture it expects instead. Horizontal-only,
  // 48px threshold; "next" is a swipe toward the reading direction's start,
  // which flips under RTL along with everything else.
  const touch = useRef(null)
  const onTouchStart = (e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY } }
  const onTouchEnd = (e) => {
    const start = touch.current
    touch.current = null
    if (!start) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return
    const forward = rtl ? dx > 0 : dx < 0
    goTo(index + (forward ? 1 : -1))
  }

  // In RTL the flex track lays slides right-to-left, so the same index moves
  // the track the other way. Percent units, so no resize listener is needed.
  const offset = index * 100 * (rtl ? 1 : -1)

  return (
    <section
      aria-roledescription="carousel"
      aria-label={T.aria}
      className="group relative isolate overflow-hidden bg-ink text-white"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false) }}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div
        // aria-live only while the rotation is stopped — announcing every
        // auto-advance would talk over the reader (WAI carousel pattern).
        aria-live={paused ? 'polite' : 'off'}
        className={`flex ${reduced ? '' : 'transition-transform duration-700 ease-out'}`}
        style={{ transform: `translateX(${offset}%)` }}
      >
        {items.map((item, i) => (
          <Slide
            key={item.kind === 'photo' ? `p${item.id}` : item.id}
            item={item}
            // The shipped copy belongs to the shipped scenes. An uploaded slide
            // carries its own words, and falls back to nothing rather than to
            // somebody else's headline.
            copy={item.kind === 'drawn' ? T.slides[SLIDE_IDS.indexOf(item.id)] : null}
            size={HERO_HEIGHT}
            active={i === index}
            first={i === 0}
            label={`${i + 1} / ${count}`}
            onBannerMissing={() => setBannerOk(false)}
          />
        ))}
      </div>

      {/* prev / next. Physical chevrons flipped by the flip-x convention, so
          "next" always points in the reading direction. Hidden entirely for a
          single slide: a control that cannot do anything is worse than none. */}
      {count > 1 && (<>
      <button
        type="button"
        onClick={() => goTo(index - 1)}
        aria-label={T.prev}
        className="absolute start-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition hover:bg-brand hover:text-ink md:flex md:start-5"
      >
        <IconArrowRight size={18} className="rotate-180 rtl:rotate-0" />
      </button>
      <button
        type="button"
        onClick={() => goTo(index + 1)}
        aria-label={T.next}
        className="absolute end-3 top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition hover:bg-brand hover:text-ink md:flex md:end-5"
      >
        <IconArrowRight size={18} className="rtl:rotate-180" />
      </button>
      </>)}

      {/* dots + pause */}
      <div className={`absolute bottom-5 start-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rtl:translate-x-1/2 ${count > 1 ? '' : 'hidden'}`}>
        {items.map((item, i) => (
          <button
            key={item.kind === 'photo' ? `p${item.id}` : item.id}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`${T.goTo} ${i + 1}`}
            aria-current={i === index || undefined}
            className={`h-2.5 rounded-full transition-all ${
              i === index ? 'w-7 bg-brand' : 'w-2.5 bg-white/40 hover:bg-white/70'
            }`}
          />
        ))}
        {!reduced && (
          <button
            type="button"
            onClick={() => setStopped((s) => !s)}
            aria-label={stopped ? T.play : T.pause}
            className="ms-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition hover:bg-white/25"
          >
            {stopped ? (
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
                <path d="M4 2.5v11l9-5.5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
                <path d="M4 2h3v12H4zM9 2h3v12H9z" />
              </svg>
            )}
          </button>
        )}
      </div>
    </section>
  )
}

function Slide({ item, copy, size, active, first, label, onBannerMissing }) {
  const { lang, t } = useLang()
  if (item.kind === 'banner') {
    return (
      <BannerSlide size={size} active={active} first={first} label={label}
                   lang={lang} t={t} onMissing={onBannerMissing} />
    )
  }
  // An uploaded slide is a photograph and its own words. It skips the drawn
  // scene, the -rtl composition probe and the /hero file lookup entirely —
  // there is nothing to fall back to, because the picture is right there.
  if (item.kind === 'photo') {
    return <PhotoSlide slide={item} size={size} active={active} first={first} label={label} lang={lang} t={t} />
  }
  const id = item.id
  const Scene = SCENES[id]
  const [photoOk, setPhotoOk] = useState(true)
  // A photograph is never mirrored — under RTL the copy moves to the other
  // side, so Arabic prefers a second COMPOSITION, <id>-rtl.jpg, with the same
  // untouched subject placed on the opposite side (the category tiles'
  // pattern). If the server has no -rtl file, the base photo serves.
  const [rtlFailed, setRtlFailed] = useState(false)
  const variant = lang === 'ar' && !rtlFailed ? '-rtl' : ''
  const photoM = `${PHOTO_DIR}/mobile/${id}${variant}${PHOTO_EXT}`
  const photoD = `${PHOTO_DIR}/desktop/${id}${variant}${PHOTO_EXT}`
  const Title = first ? 'h1' : 'p'

  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={label}
      aria-hidden={!active}
      className={`relative w-full shrink-0 ${TONE[id]}`}
    >
      {/* overflow-hidden is load-bearing: the scene svg keeps its 2.25:1
          ratio at full slide height, so it is WIDER than the slide and must be
          clipped here — without this, slide 2's runners bleed across slide 1
          (measured on a 390px viewport). */}
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        {/* The S mark — the real file, never redrawn, never mirrored. Behind
            the athletes, so it reads as a watermark, not a wash over them. */}
        <img
          src="/favicon.png"
          alt=""
          width="512"
          height="512"
          loading="lazy"
          decoding="async"
          className="absolute -end-[5%] top-1/2 h-[85%] w-auto -translate-y-1/2 select-none opacity-[0.05]"
        />

        {/* The drawn scene. Mirrored under RTL so the athletes keep to the end
            side — these are pictograms with no lettering, so a mirror is safe
            (a PHOTOGRAPH never gets this treatment, which is why the photo
            layer below sits outside this wrapper). */}
        <div className="absolute inset-0 rtl:-scale-x-100">
          <Scene />
        </div>

        {/* The owner's photograph, when the server has one. */}
        {photoOk && (
          <picture>
            <source media={DESKTOP_AT} srcSet={photoD} />
            <img
              src={photoM}
              alt=""
              loading={first ? 'eager' : 'lazy'}
              decoding="async"
              onError={() => (variant ? setRtlFailed(true) : setPhotoOk(false))}
              className="absolute inset-0 h-full w-full select-none object-cover object-center"
            />
          </picture>
        )}

        {/* Start-edge scrim so the copy stays legible over either pictorial
            layer — same reasoning as the category tiles' cat-scrim. */}
        <span className="absolute inset-0 bg-gradient-to-r from-ink/85 via-ink/40 to-transparent rtl:bg-gradient-to-l" />
      </div>

      {/* A FIXED slide height, deliberately: with content-driven padding the
          Arabic font swap changed the copy height a few pixels and shifted
          the whole page below the hero (CLS 0.0456, measured). Centred copy
          inside a constant box cannot move anything. */}
      <div className={`relative mx-auto flex ${size} max-w-7xl items-center px-4 py-16 md:px-6`}>
        <div className="max-w-xl text-start">
          <span className="flex items-center gap-3">
            <img src="/favicon.png" alt="" width="512" height="512" className="h-9 w-9 select-none" />
            <span className="on-brand rounded-full bg-brand px-4 py-1 text-xs font-bold uppercase tracking-wide">
              {copy.kicker}
            </span>
          </span>
          <Title className="mt-5 text-5xl font-extrabold leading-none drop-shadow md:text-7xl">
            {copy.title}
          </Title>
          <p className="mt-4 max-w-md text-lg text-white/85">{copy.sub}</p>
          <Link to="/shop" className="btn btn-light mt-7 inline-flex" tabIndex={active ? undefined : -1}>
            {copy.cta} <IconArrowRight size={16} className="rtl:rotate-180" />
          </Link>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The drawn scenes — the sports-poster treatment: anatomically proportioned
// athletes as backlit silhouettes (filled outlines from heroFigures.js, NOT
// stick strokes), a single ember key light from the end side, a warm rim on
// each lit edge, contact shadows, atmosphere haze and film grain. The idiom
// is deliberately "photograph turned to silhouette": it is the most real a
// build can be without an actual photo, and the photo slots stay wired above.
// All figures live in the END half of the 1440-unit canvas so a phone, which
// crops the start side, keeps the primary athletes in frame.
// ---------------------------------------------------------------------------
import { FIGURES } from './heroFigures'

const EMBER = '#ff7b17'

// One athlete: an ember rim copy of the WHOLE body shifted toward the key
// light, under fully opaque body fills — so the warm sliver traces only the
// silhouette's outer lit edge. Both halves of that sentence were learned the
// hard way: per-part rims + translucent far limbs drew orange seams through
// the inside of the figure.
function Athlete({ parts, p }) {
  return (
    <g>
      <g transform="translate(6 -3)" fill={EMBER} opacity="0.5">
        {parts.map((part, i) => (
          <path key={i} d={part.d} />
        ))}
      </g>
      {parts.map((part, i) => (
        <path key={i} d={part.d} fill={`url(#${p}-${part.far ? 'bodyFar' : 'body'})`} />
      ))}
    </g>
  )
}

// The S mark printed on a shirt: the REAL file, placed on the torso and
// rotated to the body's tilt. The scene mirrors under RTL but a logo never
// does, so the image itself counter-flips in place (mark-unflip) while its
// parent <g> keeps the mirrored position and tilt — the print stays on the
// mirrored chest, reading the right way round.
function ChestMark({ x, y, angle, size = 30 }) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`} opacity="0.85">
      <image
        href="/favicon.png"
        x={-size / 2}
        y={-size / 2}
        width={size}
        height={size}
        className="mark-unflip"
      />
    </g>
  )
}

// The photographic stage: key-light pool on the floor, haze, a horizon line,
// grain over everything. Ids are prefixed per scene — all three svgs are in
// the DOM at once, and duplicate ids would silently cross-wire the fills.
function SceneShell({ p, children }) {
  return (
    <svg
      viewBox="0 0 1440 640"
      preserveAspectRatio="xMaxYMax meet"
      className="absolute bottom-0 right-0 h-full w-auto"
      aria-hidden="true"
    >
      <defs>
        {/* the body: near-black with a faint cool top light, like unlit kit */}
        <linearGradient id={`${p}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#171b21" />
          <stop offset="55%" stopColor="#0b0d11" />
          <stop offset="100%" stopColor="#060708" />
        </linearGradient>
        {/* far-side limbs: a step lighter but OPAQUE — depth without letting
            the rim light show through the body */}
        <linearGradient id={`${p}-bodyFar`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22262d" />
          <stop offset="55%" stopColor="#14171c" />
          <stop offset="100%" stopColor="#0b0d10" />
        </linearGradient>
        <radialGradient id={`${p}-floor`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={EMBER} stopOpacity="0.3" />
          <stop offset="100%" stopColor={EMBER} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${p}-haze`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={EMBER} stopOpacity="0.1" />
          <stop offset="100%" stopColor={EMBER} stopOpacity="0" />
        </radialGradient>
        <filter id={`${p}-soft`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id={`${p}-grain`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer><feFuncA type="linear" slope="0.5" /></feComponentTransfer>
          <feComposite operator="in" in2="SourceGraphic" />
        </filter>
      </defs>

      {/* atmosphere: haze behind the athletes, the key-light pool, a horizon */}
      <ellipse cx="1120" cy="380" rx="560" ry="300" fill={`url(#${p}-haze)`} />
      <ellipse cx="1080" cy="588" rx="480" ry="40" fill={`url(#${p}-floor)`} />
      <path d="M0 580 L1440 580" stroke="#000000" strokeWidth="1.5" opacity="0.25" />

      {children}

      {/* film grain, over everything — flat vector reads as render; grain
          reads as photograph. Cheap: painted once, never animated. */}
      <rect width="1440" height="640" filter={`url(#${p}-grain)`} opacity="0.05" />
    </svg>
  )
}

// A soft contact shadow where a foot meets the floor — without it a figure
// floats, and floating is the single biggest giveaway of fake compositing.
const Shadow = ({ cx, rx, p, o = 0.5 }) => (
  <ellipse cx={cx} cy="582" rx={rx} ry="10" fill="#000000" opacity={o} filter={`url(#${p}-soft)`} />
)

// 1 — STRENGTH. A man mid-deadlift (the loaded bar reads as one plate disc,
// seen down its axis) and a woman locking out an overhead press.
function SceneStrength() {
  const p = 'hg-str'
  return (
    <SceneShell p={p}>
      <Shadow cx="1195" rx="115" p={p} />
      <Shadow cx="932" rx="70" p={p} o="0.45" />

      {/* her bar, behind her hands */}
      <path d="M850 118 L992 118" stroke="#0a0c0f" strokeWidth="8" strokeLinecap="round" />
      <circle cx="846" cy="118" r="23" fill={`url(#${p}-body)`} />
      <circle cx="996" cy="118" r="23" fill={`url(#${p}-body)`} />
      <path d="M829.7 101.7 A 23 23 0 0 1 862.3 101.7" stroke={EMBER} strokeWidth="2.5" fill="none" opacity="0.5" />
      <path d="M979.7 101.7 A 23 23 0 0 1 1012.3 101.7" stroke={EMBER} strokeWidth="2.5" fill="none" opacity="0.5" />

      <Athlete parts={FIGURES.pressWoman} p={p} />
      <Athlete parts={FIGURES.deadliftMan} p={p} />
      {/* her chest, front on; his shoulder — a side-on deadlift shows the
          back of the shirt, so the print rides the shoulder panel */}
      <ChestMark x={936} y={274} angle={-4} size={26} />
      <ChestMark x={1136} y={352} angle={32} size={24} />

      {/* his plate, over the hands that grip it */}
      <circle cx="1094" cy="506" r="55" fill={`url(#${p}-body)`} />
      <path d="M1055.1 467.1 A 55 55 0 0 1 1132.9 467.1" stroke={EMBER} strokeWidth="3" fill="none" opacity="0.55" />
      <circle cx="1094" cy="506" r="11" fill="none" stroke={EMBER} strokeWidth="3.5" opacity="0.5" />
    </SceneShell>
  )
}

// 2 — CARDIO. Two sprinters at full stride, the woman a stride ahead; faint
// motion trails and kicked-up dust instead of graphic speed lines.
function SceneCardio() {
  const p = 'hg-car'
  return (
    <SceneShell p={p}>
      <Shadow cx="1170" rx="95" p={p} o="0.4" />
      <Shadow cx="895" rx="95" p={p} o="0.4" />

      <g stroke={EMBER} strokeLinecap="round">
        <path d="M660 340 L850 340" strokeWidth="9" opacity="0.16" />
        <path d="M630 388 L830 388" strokeWidth="7" opacity="0.11" />
        <path d="M700 436 L870 436" strokeWidth="6" opacity="0.08" />
      </g>

      <Athlete parts={FIGURES.sprintMan} p={p} />
      <Athlete parts={FIGURES.sprintWoman} p={p} />
      <ChestMark x={878} y={356} angle={-40} size={26} />
      <ChestMark x={1154} y={358} angle={-41} size={24} />

      {/* dust off the toe-off feet */}
      <g fill="#ffffff">
        <circle cx="1352" cy="560" r="4" opacity="0.14" />
        <circle cx="1368" cy="548" r="2.5" opacity="0.1" />
        <circle cx="1066" cy="556" r="4" opacity="0.12" />
        <circle cx="1082" cy="544" r="2.5" opacity="0.09" />
      </g>
    </SceneShell>
  )
}

// 3 — THE ARENA. A footballer through the strike, a kickboxer at head
// height, a swimmer mid-stroke half-submerged in the water band.
function SceneArena() {
  const p = 'hg-are'
  return (
    <SceneShell p={p}>
      <Shadow cx="1240" rx="85" p={p} />
      <Shadow cx="918" rx="70" p={p} o="0.45" />

      <Athlete parts={FIGURES.kicker} p={p} />
      <Athlete parts={FIGURES.striker} p={p} />
      <ChestMark x={917} y={334} angle={2} size={22} />
      <ChestMark x={1258} y={324} angle={8} size={24} />

      {/* the ball, just off his boot — a lit crescent and quiet seams, the
          way a real ball reads against a dark pitch */}
      <circle cx="1060" cy="304" r="30" fill={`url(#${p}-body)`} />
      <path d="M1038.8 282.8 A 30 30 0 0 1 1081.2 282.8" stroke={EMBER} strokeWidth="3" fill="none" opacity="0.6" />
      <path d="M1040 288 Q1060 304 1044 324 M1076 284 Q1066 306 1080 322" stroke="#000000" strokeWidth="2" opacity="0.5" fill="none" />

      {/* water: back sheet with a lit crest, the swimmer, then a FRONT sheet
          over his lower body — the occlusion is what makes him read as IN the
          water rather than lying on the floor. */}
      <g>
        <path d="M0 584 Q120 574 240 584 T480 584 T720 584 T960 584 T1200 584 T1440 584 L1440 640 L0 640 Z" fill="#ffffff" opacity="0.09" />
        <path d="M0 584 Q120 574 240 584 T480 584 T720 584 T960 584 T1200 584 T1440 584" fill="none" stroke="#ffffff" strokeWidth="2.5" opacity="0.3" />
      </g>
      <Athlete parts={FIGURES.swimmer} p={p} />
      <g fill="#ffffff">
        <circle cx="888" cy="584" r="6" opacity="0.5" />
        <circle cx="876" cy="572" r="4" opacity="0.4" />
        <circle cx="1214" cy="576" r="5" opacity="0.45" />
        <circle cx="1228" cy="586" r="3.5" opacity="0.35" />
      </g>
      <g>
        <path d="M0 596 Q120 588 240 596 T480 596 T720 596 T960 596 T1200 596 T1440 596 L1440 640 L0 640 Z" fill="#10141b" opacity="0.92" />
        <path d="M0 596 Q120 588 240 596 T480 596 T720 596 T960 596 T1200 596 T1440 596" fill="none" stroke={EMBER} strokeWidth="2" opacity="0.25" />
        <path d="M0 618 Q120 612 240 618 T480 618 T720 618 T960 618 T1200 618 T1440 618" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.08" />
      </g>
    </SceneShell>
  )
}

// A slide the owner uploaded.
//
// Everything about it comes from the database row: the photograph, both
// languages of copy, the button, and the focal point. The focal point is the
// one that earns its place — the image fills the slide and crops differently
// on a phone than on a desktop, so without it the athlete's face is the first
// thing to go.
//
// A slide with no headline renders no headline. It does NOT borrow the shipped
// copy: a photograph of swimming captioned "Train strength" is worse than a
// photograph with no caption.
// The shipped banner.
//
// Three things it deliberately does NOT do, each of which the uploaded-photo
// slide above does:
//
//   * NO SCRIM. PhotoSlide darkens its start edge because it is handed a
//     photograph nobody art-directed. This one was art-directed — its left
//     third is already a generated dark ground built to sit under type — and
//     laying another 85% ink over it would flatten the very thing it is for.
//   * NO OVERLAID HEADLINE. The words are outlines inside the picture, set to
//     the millimetre against the orange bar. A second copy in HTML on top of
//     them is two headlines.
//   * NO focal point. The two crops exist so the browser never has to guess.
//
// But the words still have to EXIST for anything that cannot see the picture,
// so they are the img's alt text and a visually-hidden h1 — which is also what
// keeps the home page's single h1 where the drawn scenes used to put it.
function BannerSlide({ size, active, first, label, lang, t, onMissing }) {
  const title = t.heroSlides.bannerTitle
  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={label}
      aria-hidden={!active}
      className="relative w-full shrink-0 bg-ink"
    >
      <div className="absolute inset-0 overflow-hidden">
        <picture>
          <source media={DESKTOP_AT} srcSet={BANNER('desktop', lang)} width="1600" height="633" />
          <img
            src={BANNER('mobile', lang)}
            alt={title}
            width="1080"
            height="1440"
            // This is the LCP element on the home page. It is never lazy and
            // never low priority, whichever slide index it happens to be.
            loading="eager"
            fetchPriority="high"
            decoding="async"
            onError={onMissing}
            className="absolute inset-0 h-full w-full select-none object-cover"
          />
        </picture>
      </div>

      <div className={`relative mx-auto flex ${size} max-w-7xl items-end px-4 pb-10 md:px-6 md:pb-14`}>
        <div className="w-full text-center md:w-auto md:text-start">
          {first && <h1 className="sr-only">{title}</h1>}
          <Link
            to="/shop"
            className="btn btn-primary inline-flex"
            tabIndex={active ? undefined : -1}
          >
            {t.heroSlides.bannerCta}
            <IconArrowRight size={16} className="rtl:rotate-180" />
          </Link>
        </div>
      </div>
    </div>
  )
}

function PhotoSlide({ slide, size, active, first, label, lang, t }) {
  const ar = lang === 'ar'
  const title = (ar ? slide.title_ar : slide.title_en) || ''
  const sub = (ar ? slide.subtitle_ar : slide.subtitle_en) || ''
  const cta = (ar ? slide.cta_label_ar : slide.cta_label_en) || ''
  // The first slide's title is the page h1, exactly as with the drawn scenes,
  // so the page keeps one h1 — but only when there IS a title to be one.
  const Title = first && title ? 'h1' : 'p'

  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={label}
      aria-hidden={!active}
      className="relative w-full shrink-0 bg-ink"
    >
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
        <img
          src={slide.image}
          alt=""
          width={slide.width ?? undefined}
          height={slide.height ?? undefined}
          // The first slide is the largest thing above the fold and is what
          // LCP measures; the rest can wait until they are swiped to.
          loading={first ? 'eager' : 'lazy'}
          fetchPriority={first ? 'high' : undefined}
          decoding="async"
          style={{ objectPosition: `${slide.focal_x ?? 50}% ${slide.focal_y ?? 50}%` }}
          className="absolute inset-0 h-full w-full select-none object-cover"
        />
        {/* The same start-edge scrim the drawn slides use. A photograph the
            shop did not art-direct can be bright anywhere, and white text over
            an unknown photo is the most common way a hero becomes unreadable. */}
        <span className="absolute inset-0 bg-gradient-to-r from-ink/85 via-ink/40 to-transparent rtl:bg-gradient-to-l" />
      </div>

      <div className={`relative mx-auto flex ${size} max-w-7xl items-center px-4 py-16 md:px-6`}>
        <div className="max-w-xl text-start">
          {title && (
            <Title className="text-5xl font-extrabold leading-none text-white drop-shadow md:text-7xl">
              {title}
            </Title>
          )}
          {sub && <p className="mt-4 max-w-md text-lg text-white/85">{sub}</p>}
          {slide.cta_href && (
            <Link
              to={slide.cta_href}
              className="btn btn-light mt-7 inline-flex"
              // Off-screen slides must not be tab stops, or keyboard focus
              // jumps into a slide nobody can see and drags the track with it.
              tabIndex={active ? undefined : -1}
            >
              {cta || t.heroSlides.slides[0].cta}
              <IconArrowRight size={16} className="rtl:rotate-180" />
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
