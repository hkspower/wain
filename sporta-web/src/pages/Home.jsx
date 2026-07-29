import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { PRODUCTS } from '../lib/products'
import ProductCard from '../components/ProductCard'
import CategoryTile from '../components/CategoryTile'
import { IconTruck, IconReturn, IconArrowRight } from '../components/icons'
import { usePageMeta } from '../lib/seo'

export default function Home() {
  const { t } = useLang()
  // Reset canonical/title/robots after client-side navigation back home.
  usePageMeta({ path: '/' })
  const featured = PRODUCTS.slice(0, 4)

  // Each tile prefers the owner's photo (/cats/<id>.jpg, server-only), then
  // the shipped artwork (/cats/art-<id>.jpg), then its gradient — see
  // CategoryTile for the full story.
  const cats = [
    { id: 'men', to: '/shop', ...t.cats.men, tone: 'tile-men', tall: true, rtlArt: true },
    { id: 'women', to: '/shop', ...t.cats.women, tone: 'tile-women', tall: true, rtlArt: true },
    { id: 'accessories', to: '/shop', ...t.cats.acc, tone: 'tile-acc' },
    { id: 'outlet', to: '/shop', ...t.cats.outlet, tone: 'tile-outlet', badge: t.cats.discount },
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
          Two tiers, not four equal bars: men and women take the large
          half-width cells, accessories and the outlet a shorter row beneath.
          The old layout ran all four full width at the same height, which left
          roughly 800px of empty gradient between the figure and the title in
          every tile and gave the section no hierarchy at all.

          Each tile prefers a real photo from /cats/<id>.jpg and falls back to
          the silhouette-and-gradient treatment when the server has none — see
          components/CategoryTile.jsx. */}
      <section className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
        <h2 className="mb-5 text-2xl font-extrabold text-slate-900 md:mb-7 md:text-3xl">
          {t.cats.title}
        </h2>

        <div className="grid gap-4 md:grid-cols-2 md:gap-5">
          {cats.map((c) => (
            <CategoryTile
              key={c.id}
              id={c.id}
              to={c.to}
              kicker={c.k}
              title={c.t}
              brief={c.d}
              badge={c.badge}
              tone={c.tone}
              tall={c.tall}
              rtlArt={c.rtlArt}
            />
          ))}
        </div>
      </section>

      {/* Services strip — the owner's flat-lay photograph (named infobar by
          them) under a dark wash. The gradient anchors dark at the start edge
          where the copy sits and flips under RTL; Tailwind gradient directions
          are physical, hence the explicit rtl: variant. */}
      <section className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-10">
        <div className="relative isolate overflow-hidden rounded-3xl bg-ink text-white">
          <img
            src="/cats/infobar.jpg"
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 -z-20 h-full w-full select-none object-cover object-center"
          />
          <span
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-gradient-to-r from-ink/95 via-ink/80 to-ink/50 rtl:bg-gradient-to-l"
          />
          <div className="grid gap-6 p-6 sm:grid-cols-2 md:p-10">
            {[t.services.returns, t.services.delivery].map((s, i) => (
              <div key={i} className="flex items-center gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-white">
                  {i === 0 ? <IconReturn size={22} /> : <IconTruck size={22} />}
                </span>
                <div>
                  <p className="font-bold">{s.t}</p>
                  <p className="text-sm text-white/70">{s.s}</p>
                </div>
              </div>
            ))}
          </div>
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
