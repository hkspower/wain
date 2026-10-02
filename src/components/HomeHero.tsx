import Link from "next/link";
import { HOME_HERO as H } from "@/lib/home-hero.g";

/**
 * The home page's hero: one finished picture, with its sun as the button.
 *
 * It replaced a hand-drawn SVG skyline (`KuwaitSkyline`, 1,058 lines, git has
 * it) on 2 October, on request: the owner supplied the illustration and asked
 * for it as it is. So the wordmark and «وين الطلعة اليوم؟» are in the picture,
 * and on the page they are only for a screen reader — drawing them a second
 * time would put two of each on screen.
 *
 * **The picture is never cropped, and it is the full width at every size.**
 * It is 9:16, so on a computer it is about two and a half screens tall and the
 * page scrolls through it — the owner's choice (2 October) over standing it at
 * the screen's height with its edge colours carried out to the sides, which
 * is how it shipped first. Cropping it to fill a wide screen would cut the
 * wordmark or the sea, whichever end lost. The master is 1080px wide, so past
 * that width the browser scales it up; there is no larger source.
 *
 * **Everything on it is placed in the picture's own coordinates**, from the
 * generated module, so it lands on the same spot at every size: the box is a
 * size container, positions are % of it, sizes are `cqw` of its width. The
 * sun's disc is the link to /find; the label sits on the part of the disc
 * nothing stands in front of (left of the Kuwait Towers, right of the
 * Liberation Tower's pod). `audit:home-hero` samples the master under it at
 * 14 widths. Nothing else goes on the picture: «دوّر باسم المكان» sat on the
 * sea for a day and was moved under it on request — see app/page.tsx.
 */
export default function HomeHero() {
  // Where the label's centre is, as % of the sun link's own box — the link is
  // a square, so its height is its width, and the picture's height is
  // H.height / H.width of its width.
  const ratio = H.height / H.width;
  const linkTopW = (H.sun.y / 100) * ratio - H.sun.r / 100; // in picture widths
  const labelCx = ((H.label.x0 + H.label.x1) / 2 - (H.sun.x - H.sun.r)) / (2 * H.sun.r);
  const labelCy = (((H.label.y0 + H.label.y1) / 200) * ratio - linkTopW) / ((2 * H.sun.r) / 100);
  const labelW = (H.label.x1 - H.label.x0) / (2 * H.sun.r);
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  const sizes = "100vw";

  return (
    <section className="relative overflow-hidden">
      {/* The picture says both; these say them to everyone who does not see it. */}
      <h1 className="sr-only">وين</h1>
      <p className="sr-only">وين الطلعة اليوم؟</p>

      <div className="home-hero relative aspect-[9/16] w-full">
        <picture>
          <source type="image/avif" srcSet={H.avif} sizes={sizes} />
          <source type="image/webp" srcSet={H.webp} sizes={sizes} />
          {/* A plain <img>, for PlacePhoto's reason: a static export has no
              optimiser, and the sizes were made at build time by
              `npm run home-hero`. Not lazy — it is the first thing painted.
              (no-img-element does not fire inside <picture>.) */}
          <img
            src={H.src}
            width={H.width}
            height={H.height}
            alt=""
            fetchPriority="high"
            className="absolute inset-0 size-full select-none"
            draggable={false}
          />
        </picture>

        {/* The sun. Same name as the dial it replaces, so what it leads to is
            said once, in the link, for the visitor who hears it. */}
        <Link
          href="/find"
          aria-label="إلى وين؟ — اكتب أو كلّم شوق"
          className="group absolute aspect-square rounded-full transition focus-visible:ring-offset-0"
          style={{
            left: `${H.sun.x - H.sun.r}%`,
            width: `${2 * H.sun.r}%`,
            top: `calc(${H.sun.y}% - ${H.sun.r}cqw)`,
          }}
        >
          {/* A ring that breathes out from the disc's rim, so the sun reads as
              something to press. A ring and not a fill: a fill would wash
              yellow over the Kuwait Towers standing in front of it. */}
          <span aria-hidden="true" className="absolute inset-0 rounded-full ring-4 ring-sun-200 animate-pulse-ring" />
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-white/0 transition group-hover:bg-white/10 group-active:bg-ink-900/5"
          />
          <span
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-[2cqw] text-center"
            style={{ left: pct(labelCx), top: pct(labelCy), width: pct(labelW) }}
          >
            <span className="home-hero-title font-display font-bold text-ink-900">إلى وين؟</span>
            <span className="home-hero-go rounded-full bg-ink-900 font-semibold text-sun-100 shadow-sm transition group-hover:bg-ink-800">
              ابدأ
            </span>
          </span>
        </Link>

      </div>
    </section>
  );
}
