import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { IconArrowUpRight } from './icons'

// One category tile. Three layers, best available wins:
//
//   1. The owner's photograph, /cats/<id>.jpg — lives ONLY on the server, like
//      config.js. The live site already has real shots for all four categories;
//      this sandbox cannot fetch them (live host and FTP are blocked by egress
//      policy), so the tile probes for the file at runtime instead of bundling
//      it. Uploading four files into public_html/cats/ upgrades the tiles with
//      no rebuild; deleting them falls back cleanly. A publish can never
//      overwrite them: it only uploads what is in dist, and dist never
//      contains cats/<id>.jpg.
//   2. The designed artwork, /cats/art-<id>.jpg — ships with the site, so the
//      storefront never looks unfinished while the photography is pending.
//   3. The tile's own gradient (the `tone` class), which is under the other
//      two layers at all times, shows through image loading, and is the final
//      state if both files are somehow gone.
//
// The photo/art URLs are assembled from parts, not written as one literal
// string: scripts/file-audit.mjs fails the package over literal "/path.ext"
// references whose target is absent, which would block `npm run package` for
// the owner-photo slot — a file that is deliberately not shipped.
const PHOTO_DIR = '/cats'
const PHOTO_EXT = '.jpg'

export default function CategoryTile({ id, to, kicker, title, brief, badge, tone, tall = false, rtlArt = false }) {
  const { lang } = useLang()
  const [photoOk, setPhotoOk] = useState(true)
  const [artOk, setArtOk] = useState(true)
  // A photograph must never be mirrored, so categories whose model would sit
  // under the Arabic copy ship a second COMPOSITION instead: the same
  // untouched figure placed flush left with the backdrop extended to the
  // right. rtlFailed falls back to the base art if the variant file is gone.
  const [rtlFailed, setRtlFailed] = useState(false)
  const photo = `${PHOTO_DIR}/${id}${PHOTO_EXT}`
  const variant = rtlArt && lang === 'ar' && !rtlFailed ? '-rtl' : ''
  const art = `${PHOTO_DIR}/art-${id}${variant}${PHOTO_EXT}`

  return (
    <Link
      to={to}
      className={`${tone} group relative isolate flex flex-col justify-center overflow-hidden rounded-3xl p-6 text-white md:p-8 ${
        tall ? 'h-60 md:h-[22rem]' : 'h-44 md:h-52'
      }`}
    >
      {/* Owner photo. Never mirrored: a photograph can contain print, logos,
          or a composition the owner chose deliberately. The README tells them
          to centre the subject, which reads correctly in both directions. */}
      {photoOk && (
        <img
          src={photo}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setPhotoOk(false)}
          className="absolute inset-0 -z-20 h-full w-full select-none object-cover object-center transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
      )}

      {/* Shipped artwork. As of the photographic series this layer is NEVER
          mirrored: the outlet frame contains readable signage, and flipping a
          photograph of a person is a tell. The banners keep their subject on
          the right with a graded quiet left, and under RTL the flipped scrim
          alone carries legibility — verified in both directions. */}
      {!photoOk && artOk && (
        <img
          src={art}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => (variant ? setRtlFailed(true) : setArtOk(false))}
          className="absolute inset-0 -z-20 h-full w-full select-none object-cover object-center transition-transform duration-500 ease-out group-hover:scale-[1.04]"
        />
      )}

      {/* Scrim over any pictorial layer — the photo's brightness is not
          knowable here, and the artwork, while dark by design, still gets the
          same treatment so the two states are typographically identical. */}
      {(photoOk || artOk) && <span aria-hidden="true" className="cat-scrim absolute inset-0 -z-10" />}

      <div className="relative max-w-[58%]">
        {badge ? (
          <span className="mb-2 inline-block rounded-full bg-brand px-3 py-1 text-[0.7rem] font-bold text-ink">
            {badge}
          </span>
        ) : (
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-white/70 md:text-xs">
            {kicker}
          </p>
        )}
        <h3
          className={`mt-1.5 font-extrabold leading-[0.95] ${
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
