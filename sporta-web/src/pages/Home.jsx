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

  const cats = [
    { id: 'men', to: '/shop', ...t.cats.men, tile: 'tile-men' },
    { id: 'women', to: '/shop', ...t.cats.women, tile: 'tile-women' },
    { id: 'acc', to: '/shop', ...t.cats.acc, tile: 'tile-acc' },
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

      {/* Category tiles */}
      <section className="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-6">
        <div className="grid gap-4 md:gap-5">
          {cats.map((c) => (
            <Link
              key={c.id}
              to={c.to}
              className={`${c.tile} group relative flex h-40 items-center overflow-hidden rounded-3xl p-6 text-white md:h-48 md:p-8`}
            >
              <span className="absolute bottom-4 start-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white transition group-hover:scale-110">
                <IconArrowUpRight size={18} />
              </span>
              <div className="ms-auto text-end">
                <p className="text-sm tracking-widest text-white/70">{c.k}</p>
                <h3 className="text-4xl font-extrabold md:text-5xl">{c.t}</h3>
              </div>
            </Link>
          ))}
          {/* Outlet — discount tile */}
          <Link
            to="/shop"
            className="group relative flex h-40 items-center overflow-hidden rounded-3xl bg-ink-soft p-6 text-white md:h-48 md:p-8"
          >
            <span className="absolute bottom-4 start-4 flex h-10 w-10 items-center justify-center rounded-full bg-brand text-white transition group-hover:scale-110"><IconArrowUpRight size={18} /></span>
            <div className="ms-auto text-end">
              <span className="inline-block rounded-full bg-brand px-3 py-1 text-xs font-bold">{t.cats.discount}</span>
              <h3 className="mt-2 text-4xl font-extrabold md:text-5xl">{t.cats.outlet.t}</h3>
            </div>
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
