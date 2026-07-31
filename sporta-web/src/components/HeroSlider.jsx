import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { IconArrowRight } from './icons'

// The home hero: three slides — strength, cardio, and the multi-sport arena
// (football / kickboxing / swimming).
//
// THE ARTWORK IS A FALLBACK, exactly like the category tiles. Each slide
// probes for the owner's photograph first:
//
//   /hero/mobile/<id>.jpg   and   /hero/desktop/<id>.jpg
//   ids: strength, cardio, arena
//
// Those files live ONLY on the server (upload them in hPanel File Manager;
// a publish never touches /hero because dist never contains those names).
// Until they exist, the slide shows the drawn scene: pictogram athletes —
// deliberately stylised, in the black kit + ember-orange language of the
// brand — because shipping nothing while the photography is pending is worse,
// and shipping fake "photos" of people who do not exist is not this brand.
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

  const paused = hovered || focused || stopped || hidden || reduced

  useEffect(() => {
    const onVis = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    if (paused) return undefined
    const id = setInterval(() => setIndex((i) => (i + 1) % SLIDE_IDS.length), INTERVAL_MS)
    return () => clearInterval(id)
  }, [paused])

  const goTo = (i) => setIndex((i + SLIDE_IDS.length) % SLIDE_IDS.length)

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
        {SLIDE_IDS.map((id, i) => (
          <Slide key={id} id={id} copy={T.slides[i]} active={i === index} first={i === 0}
                 label={`${i + 1} / ${SLIDE_IDS.length}`} />
        ))}
      </div>

      {/* prev / next. Physical chevrons flipped by the flip-x convention, so
          "next" always points in the reading direction. */}
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

      {/* dots + pause */}
      <div className="absolute bottom-5 start-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rtl:translate-x-1/2">
        {SLIDE_IDS.map((id, i) => (
          <button
            key={id}
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

function Slide({ id, copy, active, first, label }) {
  const Scene = SCENES[id]
  const [photoOk, setPhotoOk] = useState(true)
  const photoM = `${PHOTO_DIR}/mobile/${id}${PHOTO_EXT}`
  const photoD = `${PHOTO_DIR}/desktop/${id}${PHOTO_EXT}`
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
              onError={() => setPhotoOk(false)}
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
      <div className="relative mx-auto flex min-h-[540px] max-w-7xl items-center px-4 py-16 md:min-h-[640px] md:px-6 2xl:min-h-[720px]">
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
// The drawn scenes. One visual language across all three: athletes in black
// kit (near-black strokes, round caps — sport-pictogram idiom, not failed
// realism), a single ember-orange rim glow, and a floor of warm light. All
// figures live in the END half of the 1440-unit canvas so a phone, which
// crops the start side, keeps the primary athlete in frame.
// ---------------------------------------------------------------------------
const K = '#0b0d10' // the kit — black clothing as silhouette
const EMBER = '#ff7b17'

function SceneShell({ children, glowId }) {
  return (
    <svg
      viewBox="0 0 1440 640"
      preserveAspectRatio="xMaxYMax meet"
      className="absolute bottom-0 right-0 h-full w-auto"
      aria-hidden="true"
    >
      <defs>
        <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor={EMBER} floodOpacity="0.4" />
        </filter>
        <radialGradient id={`${glowId}-floor`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={EMBER} stopOpacity="0.28" />
          <stop offset="100%" stopColor={EMBER} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="1080" cy="588" rx="470" ry="38" fill={`url(#${glowId}-floor)`} />
      {children}
    </svg>
  )
}

// Shared stroke presets: torso reads heavier than limbs, limbs than hair.
const torso = { stroke: K, strokeWidth: 40, strokeLinecap: 'round', fill: 'none' }
const limb = { stroke: K, strokeWidth: 24, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }
const arm = { ...limb, strokeWidth: 20 }
const hair = { stroke: K, strokeWidth: 11, strokeLinecap: 'round', fill: 'none' }

// 1 — STRENGTH. A man mid-deadlift (side view: the plate reads as a disc at
// his hands) and a woman locking out an overhead press.
function SceneStrength() {
  return (
    <SceneShell glowId="hg-str">
      {/* the man — deadlift */}
      <g filter="url(#hg-str)">
        <circle cx="1086" cy="318" r="30" fill={K} />
        <path d="M1122 352 L1226 414" {...torso} />
        <path d="M1226 414 L1186 486 L1196 560" {...limb} />
        <path d="M1230 418 L1210 490 L1218 562" {...limb} strokeWidth="22" opacity="0.85" />
        <path d="M1188 560 L1160 566" {...limb} strokeWidth="18" />
        <path d="M1212 562 L1240 568" {...limb} strokeWidth="18" opacity="0.85" />
        <path d="M1126 356 L1142 492" {...arm} />
        <path d="M1142 360 L1156 494" {...arm} opacity="0.85" />
        {/* the loaded bar, seen down its axis: one big plate disc */}
        <circle cx="1150" cy="500" r="56" fill={K} />
        <circle cx="1150" cy="500" r="56" fill="none" stroke={EMBER} strokeWidth="3" opacity="0.5" />
        <circle cx="1150" cy="500" r="12" fill="none" stroke={EMBER} strokeWidth="4" opacity="0.6" />
      </g>

      {/* the woman — overhead press, front on */}
      <g filter="url(#hg-str)">
        <circle cx="935" cy="296" r="26" fill={K} />
        <path d="M956 282 C 984 288 992 314 982 338" {...hair} strokeWidth="13" />
        <path d="M935 340 L935 430" {...torso} strokeWidth="34" />
        <path d="M935 430 L935 446" stroke={K} strokeWidth="46" strokeLinecap="round" fill="none" />
        <path d="M912 344 L884 282 L884 218" {...arm} />
        <path d="M958 344 L986 282 L986 218" {...arm} />
        <path d="M860 210 L1010 210" stroke={K} strokeWidth="9" strokeLinecap="round" />
        <circle cx="850" cy="210" r="26" fill={K} />
        <circle cx="1020" cy="210" r="26" fill={K} />
        <circle cx="850" cy="210" r="26" fill="none" stroke={EMBER} strokeWidth="2.5" opacity="0.45" />
        <circle cx="1020" cy="210" r="26" fill="none" stroke={EMBER} strokeWidth="2.5" opacity="0.45" />
        <path d="M924 446 L918 510 L912 574" {...limb} />
        <path d="M946 446 L954 510 L960 574" {...limb} />
        <path d="M904 574 L878 578" {...limb} strokeWidth="16" />
        <path d="M968 574 L994 578" {...limb} strokeWidth="16" />
      </g>
    </SceneShell>
  )
}

// 2 — CARDIO. Two sprinters at full stride, the woman leading, ember speed
// lines trailing off the end side.
function SceneCardio() {
  return (
    <SceneShell glowId="hg-car">
      {/* speed lines */}
      <g strokeLinecap="round" stroke={EMBER}>
        <path d="M640 356 L880 356" strokeWidth="12" opacity="0.4" />
        <path d="M600 400 L860 400" strokeWidth="10" opacity="0.28" />
        <path d="M672 444 L900 444" strokeWidth="8" opacity="0.18" />
      </g>

      {/* the woman — leading */}
      <g filter="url(#hg-car)">
        <circle cx="1108" cy="300" r="26" fill={K} />
        <path d="M1122 284 C 1158 268 1180 274 1192 292" {...hair} strokeWidth="12" />
        <path d="M1140 330 L1204 408" {...torso} strokeWidth="36" />
        <path d="M1204 408 L1140 452 L1152 520" {...limb} />
        <path d="M1152 520 L1130 532" {...limb} strokeWidth="18" />
        <path d="M1204 408 L1266 462 L1312 540" {...limb} />
        <path d="M1312 540 L1334 548" {...limb} strokeWidth="18" />
        <path d="M1140 334 L1096 372 L1120 410" {...arm} />
        <path d="M1150 340 L1198 356 L1226 320" {...arm} opacity="0.9" />
      </g>

      {/* the man — a stride behind */}
      <g filter="url(#hg-car)">
        <circle cx="864" cy="296" r="28" fill={K} />
        <path d="M894 326 L950 402" {...torso} />
        <path d="M950 402 L886 446 L900 516" {...limb} />
        <path d="M900 516 L878 528" {...limb} strokeWidth="18" />
        <path d="M950 402 L1010 458 L1052 536" {...limb} />
        <path d="M1052 536 L1074 544" {...limb} strokeWidth="18" />
        <path d="M896 330 L850 366 L876 404" {...arm} />
        <path d="M906 336 L952 350 L980 314" {...arm} opacity="0.9" />
      </g>
    </SceneShell>
  )
}

// 3 — THE ARENA. A footballer striking, a kickboxer at head height, a swimmer
// cutting through a water band along the floor.
function SceneArena() {
  return (
    <SceneShell glowId="hg-are">
      {/* the kickboxer — roundhouse, lead guard up, rear hand chambered low
          so the head stays a clean read; ponytail behind the neck, never
          above the crown (drawn there it read as a horn). */}
      <g filter="url(#hg-are)">
        <circle cx="924" cy="252" r="25" fill={K} />
        <path d="M944 262 C 958 272 960 290 954 306" {...hair} strokeWidth="9" />
        <path d="M916 286 L896 370" {...torso} strokeWidth="34" />
        <path d="M896 370 L900 450 L902 526" {...limb} />
        <path d="M894 526 L868 532" {...limb} strokeWidth="18" />
        <path d="M896 370 L830 372 L764 330" {...limb} />
        <circle cx="754" cy="326" r="13" fill={K} />
        <path d="M910 292 L872 314 L850 284" {...arm} />
        <circle cx="846" cy="278" r="15" fill={K} />
        <path d="M920 300 L952 326 L938 354" {...arm} opacity="0.9" />
        <circle cx="936" cy="360" r="14" fill={K} />
      </g>

      {/* the footballer — volley */}
      <g filter="url(#hg-are)">
        <circle cx="1266" cy="252" r="27" fill={K} />
        <path d="M1252 288 L1222 372" {...torso} strokeWidth="38" />
        <path d="M1222 372 L1218 456 L1214 536" {...limb} />
        <path d="M1206 536 L1180 542" {...limb} strokeWidth="18" />
        <path d="M1222 372 L1150 410 L1096 350" {...limb} />
        <path d="M1096 350 L1080 330" {...limb} strokeWidth="18" />
        <path d="M1250 292 L1198 314 L1166 288" {...arm} />
        <path d="M1258 296 L1302 330 L1324 374" {...arm} opacity="0.9" />
        {/* the ball, mid-flight off his boot */}
        <circle cx="1042" cy="296" r="30" fill={K} />
        <circle cx="1042" cy="296" r="30" fill="none" stroke={EMBER} strokeWidth="2.5" opacity="0.55" />
        <path d="M1022 278 Q1042 296 1026 316 M1058 276 Q1048 298 1062 314" stroke={EMBER} strokeWidth="2.5" opacity="0.45" fill="none" />
        <path d="M1078 330 L1066 314 M1096 316 L1082 302" stroke={EMBER} strokeWidth="4" strokeLinecap="round" opacity="0.35" />
      </g>

      {/* the water, and the swimmer in it. Three layers, in paint order:
          the back sheet with a lit crest, the swimmer, then a FRONT sheet
          over his lower body — the occlusion is what makes him read as IN
          the water rather than lying on the floor (the first draft skipped
          it and he looked collapsed on the ground). */}
      <g>
        <path d="M0 556 Q120 544 240 556 T480 556 T720 556 T960 556 T1200 556 T1440 556 L1440 640 L0 640 Z" fill="#ffffff" opacity="0.07" />
        <path d="M0 556 Q120 544 240 556 T480 556 T720 556 T960 556 T1200 556 T1440 556" fill="none" stroke="#ffffff" strokeWidth="2.5" opacity="0.2" />
      </g>
      <g filter="url(#hg-are)">
        <circle cx="966" cy="556" r="21" fill={K} />
        <path d="M992 564 L1112 578" {...torso} strokeWidth="28" />
        <path d="M996 560 L944 516 L896 550" {...arm} />
        <path d="M1112 578 L1164 570 L1204 560" {...limb} strokeWidth="20" />
        <circle cx="888" cy="562" r="6" fill="#ffffff" opacity="0.55" />
        <circle cx="876" cy="550" r="4" fill="#ffffff" opacity="0.45" />
        <circle cx="1214" cy="554" r="5" fill="#ffffff" opacity="0.5" />
        <circle cx="1228" cy="564" r="3.5" fill="#ffffff" opacity="0.4" />
      </g>
      <g>
        <path d="M0 572 Q120 562 240 572 T480 572 T720 572 T960 572 T1200 572 T1440 572 L1440 640 L0 640 Z" fill="#10141b" opacity="0.85" />
        <path d="M0 572 Q120 562 240 572 T480 572 T720 572 T960 572 T1200 572 T1440 572" fill="none" stroke={EMBER} strokeWidth="2" opacity="0.25" />
        <path d="M0 600 Q120 592 240 600 T480 600 T720 600 T960 600 T1200 600 T1440 600" fill="none" stroke="#ffffff" strokeWidth="2" opacity="0.08" />
      </g>
    </SceneShell>
  )
}
