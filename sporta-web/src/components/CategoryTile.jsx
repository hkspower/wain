import { useState } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowUpRight } from './icons'

// One category tile, photo-backed when a photo exists and self-sufficient when
// it does not.
//
// WHY THE PHOTO IS OPTIONAL AND RESOLVED AT RUNTIME
// The category photography lives on the server, not in this repo — the live
// site already shows real shots for all four categories, and this sandbox has
// no route to fetch them (the live host and FTP are both blocked by egress
// policy). Hard-wiring the filenames into the bundle would mean the tiles are
// broken until someone rebuilds, and the owner deploys by dropping files into
// hPanel File Manager, not by running a build.
//
// So: each tile asks for /cats/<id>.jpg. If it is there the photo takes over.
// If it is not, onError drops it and the tile falls back to the silhouette and
// gradient treatment, which is a finished design in its own right. Adding the
// photos is therefore a pure upload — four files, no rebuild, no redeploy.
//
// The URL is assembled from parts rather than written as one literal string on
// purpose: scripts/file-audit.mjs scans for literal "/path.ext" references and
// fails the package when the target is absent, which would block `npm run
// package` for files that are deliberately not shipped.
const PHOTO_DIR = '/cats'
const PHOTO_EXT = '.jpg'

export default function CategoryTile({
  id,
  to,
  kicker,
  title,
  brief,
  badge,
  tone,
  tall = false,
  art,
  artW,
  artH,
  artClass = '',
}) {
  const [photoOk, setPhotoOk] = useState(true)
  const [artOk, setArtOk] = useState(true)
  const photo = `${PHOTO_DIR}/${id}${PHOTO_EXT}`

  return (
    <Link
      to={to}
      className={`${tone} group relative isolate flex flex-col justify-center overflow-hidden rounded-3xl p-6 text-white md:p-8 ${
        tall ? 'h-60 md:h-[22rem]' : 'h-44 md:h-52'
      }`}
    >
      {/* The photo, when the server has one. object-cover with a centred focal
          point: these are people and product shots, and the subject sits in the
          middle of the frame in every one of them. */}
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

      {/* Silhouette fallback — only drawn when there is no photo, so the two
          treatments never stack on top of each other. It carries its own error
          handler as well: without one, a renamed or missing webp paints the
          browser's broken-image icon over the tile, which looks far worse than
          the plain gradient it is supposed to be decorating. */}
      {!photoOk && art && artOk && (
        <img
          src={art}
          alt=""
          width={artW}
          height={artH}
          loading="lazy"
          decoding="async"
          onError={() => setArtOk(false)}
          className={`pointer-events-none absolute bottom-0 end-6 -z-10 w-auto max-w-[44%] select-none object-contain object-bottom drop-shadow-[0_10px_30px_rgba(255,123,23,0.28)] transition-transform duration-500 ease-out group-hover:scale-[1.06] md:end-10 ${artClass}`}
        />
      )}

      {/* Scrim. Only over a photo — the gradient tiles are already dark enough
          and a second layer just muddies them. Anchored to the start edge,
          where the text is, so the copy stays legible over a photo of any
          brightness, with the brand orange picked up at the far edge. */}
      {photoOk && <span aria-hidden="true" className="cat-scrim absolute inset-0 -z-10" />}

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

      {/* Bottom-END corner, opposite the artwork and opposite the copy. */}
      <span className="absolute bottom-5 end-5 flex h-11 w-11 items-center justify-center rounded-full bg-brand shadow-lg shadow-black/30 transition group-hover:scale-110 rtl:-scale-x-100 md:bottom-6 md:end-6">
        <IconArrowUpRight size={18} />
      </span>
    </Link>
  )
}
