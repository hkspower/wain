import { useLang } from '../i18n/LanguageContext'
import { useTheme } from '../lib/theme'
import { brandLogoUrl } from '../lib/brands'

// The brand plate that sits directly under the product photograph.
//
// Two brands are true of one garment and both belong here: SPORTA is who you
// are buying from, AHED is who made it. The plate reads Sporta mark · AHED ·
// Collection, which is the order a shopper needs them in.
//
// THE LOGO IS THEME-AWARE, and it has to be: logo.png is black-on-transparent
// and vanishes on the charcoal canvas, logo-white.png is the opposite. The mark
// is 132x41 in both, declared on the element so the plate never resizes when
// the file lands. logo-white has a WebP twin; the black one does not, so it is
// served as PNG rather than pretending.
export default function BrandPlate({ detail, brand }) {
  const { lang, t } = useLang()
  const { theme } = useTheme()
  const dark = theme === 'dark'
  // THE MAKER'S OWN MARK. Three brands can be true of one garment and they are
  // not the same claim: SPORTA is who you buy from, the maker's mark is whose
  // product it is, AHED is who supplied it.
  //
  // It arrives WITH the product — joined into ?r=products — so this component
  // fetches nothing. It used to call ?r=brands on mount, which was a second
  // round trip on a page whose request budget has two to spare, for a slug, two
  // names and a hash.
  const logo = brandLogoUrl(brand)

  return (
    <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-black/10 bg-white px-4 py-3">
      {dark ? (
        <picture>
          <source type="image/webp" srcSet="/logo-white.webp" />
          <img src="/logo-white.png" alt="Sporta Sports Wear" width="132" height="41" className="h-7 w-auto" />
        </picture>
      ) : (
        <img src="/logo.png" alt="Sporta Sports Wear" width="132" height="41" className="h-7 w-auto" />
      )}

      {/* The maker, between the shop's mark and the supplier line. A brand
          with no logo uploaded yet shows its NAME rather than a gap — the row
          exists in the database either way, and "Vanquish" is more use to a
          shopper than an empty space where a picture was planned. */}
      {brand && (
        <span className="flex min-w-0 shrink items-center gap-2">
          {logo ? (
            <img
              src={logo}
              alt={brand.name[lang]}
              // No width/height: a brand logo has no fixed shape and the row is
              // already the height of the Sporta mark beside it, so the height
              // constraint does the reserving instead.
              height="28"
              loading="lazy"
              decoding="async"
              className="h-6 w-auto max-w-24 object-contain"
            />
          ) : (
            <span className="truncate text-sm font-extrabold text-slate-900">{brand.name[lang]}</span>
          )}
        </span>
      )}

      {detail && (
        <p className="flex min-w-0 items-center gap-2 text-end">
          {/* .eyebrow handles the tracking per direction — Arabic is never
              letter-spaced, it joins. */}
          <span className="eyebrow text-accent shrink-0">{detail.brand[lang]}</span>
          <span className="text-black/20" aria-hidden>·</span>
          <span className="truncate text-sm font-extrabold text-slate-900">
            {detail.collection[lang]}
          </span>
        </p>
      )}
      {!detail && <span className="text-xs font-semibold text-slate-600">{t.spec.authentic}</span>}
    </div>
  )
}
