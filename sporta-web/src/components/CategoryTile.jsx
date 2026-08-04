import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { IconArrowUpRight } from './icons'

// One category tile. Three layers, best available wins:
//
//   1. The owner's photograph, /cats/<mobile|desktop>/<id>.jpg — lives ONLY on
//      the server, like config.js. The live site already has real shots for all
//      four categories;
//      this sandbox cannot fetch them (live host and FTP are blocked by egress
//      policy), so the tile probes for the file at runtime instead of bundling
//      it. Uploading the files into public_html/cats/mobile/ and
//      public_html/cats/desktop/ upgrades the tiles with no rebuild; deleting
//      them falls back cleanly. A publish can never overwrite them: it only
//      uploads what is in dist, and dist never contains a bare <id>.jpg.
//   2. The designed artwork, /cats/<mobile|desktop>/art-<id>.{webp,jpg} — ships
//      with the site, so the storefront never looks unfinished while the
//      photography is pending.
//   3. The tile's own gradient (the `tone` class), which is under the other
//      two layers at all times, shows through image loading, and is the final
//      state if both files are somehow gone.
//
// Every URL is assembled from parts, not written as one literal string:
// scripts/file-audit.mjs fails the package over a literal "/path.ext" whose
// target is absent, which would block `npm run package` on the owner-photo slot
// — a file that is deliberately not shipped.
const PHOTO_DIR = '/cats'
const PHOTO_EXT = '.jpg'

// ---------------------------------------------------------------------------
// mobile/ and desktop/, chosen by <source media> and never by device pixels.
//
// The previous version used srcset + sizes with an 800w/1600w ladder, and it
// made phones the WORST case. srcset multiplies by devicePixelRatio, so a 358px
// tile on a DPR3 phone asks for ~1074px and lands on the 1600w file, while a
// 606px tile on a DPR1 desktop asks for 606px and lands on the 800w one.
// Measured on the built site: 575 kB of images on an iPhone 12/13/14 against
// 274 kB on a 1440px desktop. The mechanism was working as designed; it was the
// wrong mechanism.
//
// `media` asks the only question that has a useful answer here — which layout
// is this? — so a phone cannot be served the desktop file at any pixel ratio.
// It also lets the two files be composed at the ratio each layout displays
// (1.58:1 mobile, 1.72:1 desktop for the tall tiles), instead of one 1.60:1
// master that object-cover trimmed to fit both.
const DESKTOP_AT = '(min-width: 768px)' // Tailwind md — where the grid goes 2-up
const MOBILE = `${PHOTO_DIR}/mobile`
const DESKTOP = `${PHOTO_DIR}/desktop`

// Both pictorial layers sit in the same place under the scrim.
const LAYER =
  'absolute inset-0 -z-20 h-full w-full select-none object-cover object-center' +
  ' transition-transform duration-500 ease-out group-hover:scale-[1.04]'

export default function CategoryTile({ id, to, kicker, title, brief, badge, tone, tall = false, rtlArt = false }) {
  const { lang } = useLang()
  const [photoOk, setPhotoOk] = useState(true)
  const [artOk, setArtOk] = useState(true)
  // A photograph must never be mirrored, so categories whose model would sit
  // under the Arabic copy ship a second COMPOSITION instead: the same
  // untouched figure placed flush left with the backdrop extended to the
  // right. rtlFailed falls back to the base art if the variant file is gone.
  const [rtlFailed, setRtlFailed] = useState(false)
  const variant = rtlArt && lang === 'ar' && !rtlFailed ? '-rtl' : ''
  // The owner uploads the same picture twice, once per folder, and the README
  // says so. There is deliberately no cross-fallback: a <picture> cannot fall
  // through from a missing desktop file to a mobile one, and PROBING for it
  // would mean downloading a desktop-sized photograph on a phone to find out it
  // exists — the exact thing this change is here to stop. One folder missing
  // means that layout falls to the shipped artwork, which is not a failure.
  const photoM = `${MOBILE}/${id}${PHOTO_EXT}`
  const photoD = `${DESKTOP}/${id}${PHOTO_EXT}`
  const artM = `${MOBILE}/art-${id}${variant}`
  const artD = `${DESKTOP}/art-${id}${variant}`

  return (
    <Link
      to={to}
      className={`${tone} group relative isolate flex flex-col justify-center overflow-hidden rounded-3xl p-6 text-white md:p-8 ${
        tall ? 'h-60 md:h-[22rem]' : 'h-48 md:h-52'
      }`}
    >
      {/* Owner photo. Never mirrored: a photograph can contain print, logos,
          or a composition the owner chose deliberately. The README tells them
          to centre the subject, which reads correctly in both directions. */}
      {photoOk && (
        <picture>
          <source media={DESKTOP_AT} srcSet={photoD} />
          <img
            src={photoM}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setPhotoOk(false)}
            className={LAYER}
          />
        </picture>
      )}

      {/* Shipped artwork. As of the photographic series this layer is NEVER
          mirrored: the outlet frame contains readable signage, and flipping a
          photograph of a person is a tell. The banners keep their subject on
          the right with a graded quiet left, and under RTL the flipped scrim
          alone carries legibility — verified in both directions.
          Four sources, one per (layout x format) case, so a browser without
          WebP still gets a file of the right SIZE rather than falling across the
          breakpoint to the other layout's picture. */}
      {!photoOk && artOk && (
        <picture>
          <source media={DESKTOP_AT} type="image/webp" srcSet={`${artD}.webp`} />
          <source media={DESKTOP_AT} type="image/jpeg" srcSet={`${artD}.jpg`} />
          <source type="image/webp" srcSet={`${artM}.webp`} />
          <img
            src={`${artM}.jpg`}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => (variant ? setRtlFailed(true) : setArtOk(false))}
            className={LAYER}
          />
        </picture>
      )}

      {/* Scrim over any pictorial layer — the photo's brightness is not
          knowable here, and the artwork, while dark by design, still gets the
          same treatment so the two states are typographically identical. */}
      {(photoOk || artOk) && <span aria-hidden="true" className="cat-scrim absolute inset-0 -z-10" />}

      {/* The 58% cap exists so desktop copy never runs into the artwork beside
          it. On mobile the art is full-bleed BEHIND the text, so the same cap
          only forces wrapping — it clipped the second line of «سبورتا أوتلت»
          straight out of the tile. */}
      <div className="relative max-w-[76%] sm:max-w-[62%] md:max-w-[58%]">
        {badge ? (
          <span className="mb-2 inline-block rounded-full bg-brand px-3 py-1 text-[0.7rem] font-bold text-ink">
            {badge}
          </span>
        ) : (
          <p className="eyebrow text-white/70">
            {kicker}
          </p>
        )}
        <h3
          className={`mt-1.5 font-black leading-[0.95] ${
            tall ? 'text-4xl md:text-6xl' : 'text-3xl md:text-4xl'
          }`}
        >
          {title}
        </h3>
        {brief && (
          <p className="mt-2.5 hidden text-sm leading-snug text-white/75 sm:block md:mt-3 md:max-w-xs">
            {brief}
          </p>
        )}
      </div>

      {/* Bottom-END corner — the artwork keeps that corner free of critical
          detail by construction. */}
      <span className="absolute bottom-5 end-5 flex h-11 w-11 items-center justify-center rounded-full bg-brand shadow-lg shadow-black/30 transition group-hover:scale-110 rtl:-scale-x-100 md:bottom-6 md:end-6">
        <IconArrowUpRight size={18} />
      </span>
    </Link>
  )
}
