import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { PRODUCTS } from '../lib/products'
import ProductCard from '../components/ProductCard'
import { IconTruck, IconReturn, IconArrowUpRight, IconArrowRight } from '../components/icons'
import { usePageMeta } from '../lib/seo'

export default function Home() {
  const { t } = useLang()
  // Reset canonical/title/robots after client-side navigation back home.
  usePageMeta({ path: '/' })
  const featured = PRODUCTS.slice(0, 4)

  // Men and women carry the owner's silhouette artwork (recoloured to the
  // brand orange, background removed, text stripped — the source banners baked
  // an Arabic-only title into the pixels, which cannot serve the English side
  // of the site). Width/height are the intrinsic 2x-retina pixel sizes so the
  // browser reserves space before the image arrives.
  //
  // `artH` is per-figure on purpose. The two silhouettes have opposite aspect
  // ratios — the flexing figure is 1.39:1 wide, the runner is 0.66:1 tall — so
  // one shared height would give them wildly different visual mass sitting
  // side by side. Sized so both read as the same weight in their tile.
  const hero = [
    { id: 'men', to: '/shop', ...t.cats.men, tile: 'tile-men', art: '/cats/men.webp', w: 548, h: 394, artH: 'h-[58%] md:h-[62%]' },
    { id: 'women', to: '/shop', ...t.cats.women, tile: 'tile-women', art: '/cats/women.webp', w: 526, h: 800, artH: 'h-[82%] md:h-[86%]' },
  ]

  return (
    <>
      {/* Hero — dramatic charcoal + fire-orange */}
      <section className="relative overflow-hidden bg-ink text-white">
        <div className="hero-glow absolute inset-0 opacity-90" />
        <div className="relative mx-auto flex max-w-7xl flex-col items-center gap-6 px-4 py-28 2xl:py-40 text-center">
          <span className="rounded-full bg-brand px-4 py-1 text-xs font-bold uppercase tracking-wide">
            {t.hero.kicker}
          </span>
          <h1 className="text-6xl font-extrabold leading-none drop-shadow md:text-8xl 2xl:text-9xl">
            {t.hero.line1}
            <br />
            {t.hero.line2}
          </h1>
          <p className="max-w-md text-lg text-white/85">{t.hero.subtitle}</p>
          <Link
            to="/shop"
            className="btn btn-light"
          >
            {t.hero.cta} <IconArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* Summer offers banner */}
      <section className="mx-auto max-w-7xl px-4 pt-10 pb-4 md:px-6 md:pt-14 md:pb-6">
        <Link
          to="/shop"
          className="flex flex-col items-center justify-between gap-3 rounded-3xl bg-gradient-to-br from-brand to-brand-dark p-8 text-white transition hover:shadow-2xl md:flex-row md:p-10"
        >
          <div className="text-center md:text-start">
            <p className="text-xs font-semibold uppercase tracking-wide text-white/80">{t.offer.badge}</p>
            <h2 className="mt-1 text-3xl font-extrabold md:text-4xl">{t.offer.title}</h2>
          </div>
          <span className="flex items-center gap-1.5 font-bold underline underline-offset-4">{t.offer.cta} <IconArrowRight size={16} /></span>
        </Link>
      </section>

      {/* Category tiles.
          Two tiers, not four equal bars. Men and women are the tiles that carry
          artwork, so they get the large half-width cells; accessories and the
          outlet sit under them as a shorter secondary row. The old layout ran
          all four full width at the same height, which left roughly 800px of
          empty gradient between the figure and the title in every tile and gave
          the section no hierarchy at all. */}
      <section className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
        <h2 className="mb-5 text-2xl font-extrabold text-slate-900 md:mb-7 md:text-3xl">
          {t.cats.title}
        </h2>

        <div className="grid gap-4 md:grid-cols-2 md:gap-5">
          {hero.map((c) => (
            <Link
              key={c.id}
              to={c.to}
              className={`${c.tile} group relative isolate flex h-60 overflow-hidden rounded-3xl p-6 text-white md:h-[22rem] md:p-8`}
            >
              {/* Anchored to the bottom-start corner and allowed to fill the
                  cell height, so the composition reads on a diagonal — figure
                  low and leading, title high and trailing. */}
              <img
                src={c.art}
                alt=""
                width={c.w}
                height={c.h}
                loading="lazy"
                decoding="async"
                className={`pointer-events-none absolute bottom-0 start-4 -z-10 w-auto max-w-[60%] select-none object-contain object-bottom drop-shadow-[0_10px_30px_rgba(255,123,23,0.28)] transition-transform duration-500 ease-out group-hover:scale-[1.06] md:start-8 ${c.artH}`}
              />
              <div className="ms-auto text-end">
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-white/60 md:text-xs">
                  {c.k}
                </p>
                <h3 className="mt-1.5 text-4xl font-extrabold leading-[0.95] md:text-6xl">{c.t}</h3>
              </div>
              {/* Bottom-END corner: the old bottom-start position put this chip
                  directly on top of the figure's feet, and on the RTL side it
                  landed on the runner's leg. */}
              <span className="absolute bottom-5 end-5 flex h-11 w-11 items-center justify-center rounded-full bg-brand shadow-lg shadow-black/30 transition group-hover:scale-110 rtl:-scale-x-100 md:bottom-6 md:end-6">
                <IconArrowUpRight size={18} />
              </span>
            </Link>
          ))}

          {/* Accessories + outlet — secondary row, deliberately shorter so the
              two illustrated categories stay dominant. */}
          {/* The one orange-dominant tile, so it takes near-black text rather
              than white: white on #E0561C is 3.81:1, which fails AA for the
              eyebrow line, and the brand rule is near-black on these oranges.
              Near-black measures 4.59:1 here. The arrow chip inverts too — an
              orange chip on an orange tile is invisible. */}
          <Link
            to="/shop"
            className="tile-acc group relative flex h-36 items-center overflow-hidden rounded-3xl p-6 text-ink md:h-40 md:p-8"
          >
            <div className="text-start">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-ink/75 md:text-xs">
                {t.cats.acc.k}
              </p>
              <h3 className="mt-1.5 text-3xl font-extrabold leading-none md:text-4xl">{t.cats.acc.t}</h3>
            </div>
            <span className="absolute bottom-5 end-5 flex h-11 w-11 items-center justify-center rounded-full bg-ink text-white shadow-lg shadow-black/25 transition group-hover:scale-110 rtl:-scale-x-100 md:bottom-6 md:end-6">
              <IconArrowUpRight size={18} />
            </span>
          </Link>

          <Link
            to="/shop"
            className="group relative flex h-36 items-center overflow-hidden rounded-3xl bg-ink-soft p-6 text-white md:h-40 md:p-8"
          >
            <div className="text-start">
              <span className="inline-block rounded-full bg-brand px-3 py-1 text-[0.7rem] font-bold text-ink">
                {t.cats.discount}
              </span>
              <h3 className="mt-2 text-3xl font-extrabold leading-none md:text-4xl">{t.cats.outlet.t}</h3>
            </div>
            <span className="absolute bottom-5 end-5 flex h-11 w-11 items-center justify-center rounded-full bg-brand shadow-lg shadow-black/30 transition group-hover:scale-110 rtl:-scale-x-100 md:bottom-6 md:end-6">
              <IconArrowUpRight size={18} />
            </span>
          </Link>
        </div>
      </section>

      {/* Services row */}
      <section className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-10">
        <div className="grid gap-4 sm:grid-cols-2 md:gap-5">
          {[t.services.returns, t.services.delivery].map((s, i) => (
            <div key={i} className="flex flex-col items-center gap-2 rounded-3xl border border-black/10 bg-sand-light p-6 text-center md:p-8">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand/15 text-xl text-brand">
                {i === 0 ? <IconReturn size={22} /> : <IconTruck size={22} />}
              </span>
              <p className="font-bold text-slate-900">{s.t}</p>
              <p className="text-sm text-slate-500">{s.s}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Essentials */}
      <section className="mx-auto max-w-7xl px-4 py-10 md:px-6 md:py-14">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand">{t.ess.kicker}</p>
          <h2 className="text-3xl font-extrabold text-slate-900">{t.ess.title}</h2>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-4 md:gap-x-4">
          {featured.map((p) => (
            <ProductCard key={p.slug} product={p} />
          ))}
        </div>
      </section>
    </>
  )
}
