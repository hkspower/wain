import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLang } from '../i18n/LanguageContext'
import { PRODUCTS, loadProducts } from '../lib/products'
import ProductCard from '../components/ProductCard'
import CategoryTile from '../components/CategoryTile'
import HeroSlider from '../components/HeroSlider'
import { IconTruck, IconReturn, IconArrowRight } from '../components/icons'
import { usePageMeta } from '../lib/seo'

const INFOBAR_DESKTOP_AT = '(min-width: 640px)'

export default function Home() {
  const { t } = useLang()
  // Reset canonical/title/robots after client-side navigation back home.
  usePageMeta({ path: '/', description: t.seo.home })
  // The four products this row shows.
  //
  // Starts as the first four of the shipped catalogue so the grid paints
  // immediately with the right number of cards — a row that appears after a
  // fetch is a layout shift halfway down the home page. Then, if the admin has
  // marked anything Featured, those replace them in the order it chose.
  const [featured, setFeatured] = useState(() => PRODUCTS.slice(0, 4))
  useEffect(() => {
    let alive = true
    loadProducts()
      .then((all) => {
        if (!alive) return
        const picked = all
          .filter((p) => p.featured)
          .sort((a, b) => (a.featured_sort ?? 0) - (b.featured_sort ?? 0))
        // Never fewer than four: a "Featured" row with one card in it looks
        // broken rather than curated, so the rest of the catalogue fills in.
        const rest = all.filter((p) => !p.featured)
        setFeatured([...picked, ...rest].slice(0, 4))
      })
      .catch(() => {})
    return () => { alive = false }
  }, [])

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
      {/* Hero — three slides: strength, cardio, the arena. Each prefers the
          owner's photograph from /hero/<mobile|desktop>/<id>.jpg (server-only,
          like /cats) and falls back to the drawn scene — see HeroSlider. */}
      <HeroSlider />

      {/* Summer offers banner */}
      <section className="mx-auto max-w-7xl px-4 pt-10 pb-4 md:px-6 md:pt-14 md:pb-6">
        <Link
          to="/shop"
          className="flex flex-col items-center justify-between gap-3 rounded-3xl bg-gradient-to-br from-brand to-brand-dark p-8 text-white transition hover:shadow-2xl md:flex-row md:p-10"
        >
          <div className="text-center md:text-start">
            <p className="eyebrow text-white/80">{t.offer.badge}</p>
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
          {/* mobile/ and desktop/ chosen by viewport, not by device pixels —
              see components/CategoryTile.jsx for why srcset was the wrong tool
              here. This band is the starkest case for two files: it renders
              380x160 (2.4:1) on a phone and 1232x124 (9.9:1) on a desktop, so
              one master meant object-cover discarding 84% of its height in one
              layout or the other. */}
          <picture>
            <source media={INFOBAR_DESKTOP_AT} type="image/webp" srcSet="/cats/desktop/infobar.webp" />
            <source media={INFOBAR_DESKTOP_AT} type="image/jpeg" srcSet="/cats/desktop/infobar.jpg" />
            <source type="image/webp" srcSet="/cats/mobile/infobar.webp" />
            <img
              src="/cats/mobile/infobar.jpg"
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 -z-20 h-full w-full select-none object-cover object-center"
            />
          </picture>
          <span
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-gradient-to-r from-ink/95 via-ink/80 to-ink/50 rtl:bg-gradient-to-l"
          />
          <div className="grid gap-6 p-6 sm:grid-cols-2 md:p-10">
            {[t.services.returns, t.services.delivery].map((s, i) => (
              <div key={i} className="flex items-center gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-ink">
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
          <p className="eyebrow text-accent">{t.ess.kicker}</p>
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
