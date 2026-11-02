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
// and vanishes on the charcoal canvas, logo-white.png is the opposite. Each is
// declared at its REAL pixel size (logo.png 800x246, logo-white 600x184), so the
// ratio the browser reserves is the file's own and the plate never resizes when
// the file lands. The CSS sets the height (h-7 = 28px, about 91px wide). logo-white
// has a WebP twin; the black one does not, so it is served as PNG rather than
// pretending.
//
// The black mark is what a shopper sees on this plate in the light theme. The
// plate is bg-white, and index.css turns every bg-white dark in the dark theme,
// so the white mark is the one that belongs on it there.
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
          <img src="/logo-white.png" alt="Sporta Sports Wear" width="600" height="184" loading="lazy" decoding="async" className="h-7 w-auto shrink-0" />
        </picture>
      ) : (
        <img src="/logo.png" alt="Sporta Sports Wear" width="800" height="246" loading="lazy" decoding="async" className="h-7 w-auto shrink-0" />
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
              // A brand logo has no fixed shape, and before it loads an <img>
              // with only a height and width:auto has no width at all, so the
              // row grew sideways when the logo arrived. The box is fixed here
              // (96x24) and the logo is fitted inside it with object-contain,
              // so nothing moves whatever the logo's proportions are.
              width="96"
              height="24"
              loading="lazy"
              decoding="async"
              className="h-6 w-24 max-w-full shrink-0 object-contain"
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
