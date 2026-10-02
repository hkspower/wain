import type { CSSProperties, SVGProps } from "react";
import CategoryIcon from "@/components/CategoryIcon";

/**
 * One bespoke line icon per place.
 *
 * Drawn on a 48×48 grid — double the 24 grid the UI icon set uses — so each
 * mark carries real architectural detail (the towers' three spheres, the wind
 * tower on a Freej courtyard house, the arcade roof of the Avenues) and stays
 * exact when a card renders it at 100px+.
 *
 * Every icon is a single colour and an outline: the stroke inherits
 * currentColor and nothing is filled (the 14% volume tint went on 2 October,
 * with the UI set's wash), so one class on the parent sets the whole set.
 * Shared geometry — a size-aware stroke (see below), round caps and joins, a
 * common 4px margin and a 40px baseline — keeps 52 subjects reading as one
 * family.
 */
type Props = SVGProps<SVGSVGElement> & { slug: string; className?: string };

const S = {
  viewBox: "0 0 48 48",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/**
 * Optical stroke weight.
 *
 * Stroke width is in viewBox units, so a fixed value means the rendered
 * weight is a fixed *fraction* of the display size. The UI set drew 1.8 on a
 * 24 grid — 0.075 of the size. This set drew 2.4 on a 48 grid — 0.050. Same
 * apparent size, two-thirds the weight: at size-4 the marks came out 0.80
 * device pixels against 1.20 for every icon beside them, which is a hairline,
 * not a light touch. In a search result row that put a starved mark next to a
 * normal one.
 *
 * So the weight follows the size instead of being constant. Small marks match
 * the UI family exactly; the weight eases off as the mark grows, which is what
 * optical sizing means and keeps the 80px hero at the 2.4 it was drawn for.
 *
 * Both ends came down by the same 1.5/1.8 on 2 October, when the UI set went
 * to 1.5: 3.0 at 16px (0.0625, the UI ratio again) and 2.0 at the hero.
 */
const HERO_PX = 80;
const SMALL_PX = 16;

/** Tailwind `size-N` is N × 4px. */
function renderedPx(className: string): number {
  const m = /(?:^|[\s:])size-(\d+(?:\.\d+)?)(?:\s|$)/.exec(className);
  return m ? parseFloat(m[1]) * 4 : 40;
}

function strokeFor(px: number): number {
  const t = Math.min(1, Math.max(0, (px - SMALL_PX) / (HERO_PX - SMALL_PX)));
  // 3.0 == 0.0625 × 48, the UI family's ratio. 2.0 is the hero's weight.
  return +(3.0 - t * 1.0).toFixed(3);
}

/**
 * Secondary detail lines sit at 2.2/2.4 of the main weight, at every size.
 * Presentation attributes can't resolve var(), so these ride on `style`.
 */
const DETAIL_RATIO = 2.2 / 2.4;
const DETAIL = { strokeWidth: "var(--w2)" } as const;

const GROUND = <path d="M6 40h36" opacity={0.45} />;

function Art({ slug }: { slug: string }) {
  switch (slug) {
    /* أبراج الكويت — the three tapered towers and their spheres */
    case "kuwait-towers":
      return (
        <>
          <circle cx="20" cy="17" r="7" />
          <circle cx="20" cy="7.5" r="3" />
          <path d="M20 10.5V10M17.6 23.6 16 40M22.4 23.6 24 40" />
          <circle cx="32" cy="27" r="4.4" />
          <path d="M32 22.6V19M30.5 31.2 29.5 40M33.5 31.2 34.5 40" />
          <path d="M10 40l1.5-13M14.5 40 13 27M12.25 27v-4" />
          {GROUND}
        </>
      );

    /* سوق المباركية — arcade of shop arches with a hanging lamp */
    case "souq-al-mubarakiya":
      return (
        <>
          <path d="M9 40V22a6 6 0 0 1 12 0v18" />
          <path d="M27 40V25a5 5 0 0 1 10 0v15" />
          <path d="M6 18h36" />
          <path d="M24 8v4" />
          <path d="M20.5 18 24 12l3.5 6" />
          {GROUND}
        </>
      );

    /* حديقة الشهيد — layered canopy over the park path */
    case "al-shaheed-park":
      return (
        <>
          <path d="M14 22a11 8 0 0 1 22 0" />
          <path d="M16 27a10 7 0 0 0 18 0" />
          <path d="M14.5 22h21" opacity={0.5} style={DETAIL} />
          <path d="M25 27v13" />
          <path d="M25 33l-4.5-4M25 36l4.5-4" style={DETAIL} />
          <path d="M6 30a5 4 0 0 1 10 0" />
          <path d="M7.5 32.5a4.5 3 0 0 0 7 0M11 32.5V40" style={DETAIL} />
          {GROUND}
        </>
      );

    /* ميس الغانم — skewers over the grill */
    case "mais-alghanim":
      return (
        <>
          <path d="M10 26h28l-2.5 10a4 4 0 0 1-4 3H16.5a4 4 0 0 1-4-3Z" />
          <path d="M7 26h34" />
          <path d="M17 21V9M24 21V7M31 21V9" style={DETAIL} />
          <circle cx="17" cy="15" r="2.6" style={DETAIL} />
          <circle cx="24" cy="13" r="2.6" style={DETAIL} />
          <circle cx="31" cy="15" r="2.6" style={DETAIL} />
        </>
      );

    /* فريج صويلح — courtyard house with a wind tower */
    case "freej-swaileh":
      return (
        <>
          <path d="M10 40V21h16v19" />
          <path d="M8 21h20" />
          <path d="M30 40V27h9v13" />
          <path d="M28.5 27h12" />
          <path d="M32 27V14h5v13M31 14h7" />
          <path d="M16 40v-8h5v8" />
          <path d="M13 26h2M21 26h2" />
          {GROUND}
        </>
      );

    /* مقاهي المباركية — dallah pouring into a finjan */
    case "mubarakiya-tea-houses":
      return (
        <>
          <path d="M16 17h12l2.4 17a4 4 0 0 1-4 4.6h-8.8a4 4 0 0 1-4-4.6Z" />
          <path d="M16.4 17 14 12h16l-2.4 5" />
          <path d="M20 8h4M22 8V5.5" />
          <path d="M30.4 21.5c3.4.6 5.6 2.5 5.6 5.2 0 2-1.4 3.6-3.8 4.3" />
          <path d="M13.6 21.5C10.6 20.4 9 18.2 9 15.6" />
          <path d="M34 34h8v3a4 4 0 0 1-8 0ZM33 41h10" style={DETAIL} />
        </>
      );

    /* شارع سالم المبارك — shopfronts under street lamps */
    case "salem-al-mubarak-street":
      return (
        <>
          <path d="M8 40V24h13v16" />
          <path d="M25 40V28h11v12" />
          <path d="M6 24h17M23 28h15" />
          <path d="M12 40v-7h5v7" />
          <path d="M41 40V16" />
          <circle cx="41" cy="12.5" r="3.5" />
          <path d="M28 34h5" style={DETAIL} />
          {GROUND}
        </>
      );

    /* الأفنيوز — barrel-vaulted mall arcade */
    case "the-avenues":
      return (
        <>
          <path d="M7 40V22a17 17 0 0 1 34 0v18" />
          <path d="M7 27h34M16 22.5V40M32 22.5V40" opacity={0.6} style={DETAIL} />
          <path d="M19 40v-9h10v9" />
          <path d="M24 31v9" style={DETAIL} />
          {GROUND}
        </>
      );

    /* سوق شرق — waterfront mall with a dhow sail */
    case "souq-sharq":
      return (
        <>
          <path d="M6 32V19h16v13" />
          <path d="M4 19h20M10 26h2M16 26h2" />
          <path d="M38 12v18M38 12 28 30h10" />
          <path d="M41 16v14" style={DETAIL} />
          <path d="M4 34c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" opacity={0.8} />
          <path d="M8 40c4 0 4 2.5 8 2.5" opacity={0} />
          <path d="M4 40c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" opacity={0.4} />
        </>
      );

    /* المسجد الكبير — dome, arches and minarets */
    case "grand-mosque":
      return (
        <>
          <path d="M24 9c1.6 8 9 10.5 9 17H15c0-6.5 7.4-9 9-17Z" />
          <path d="M24 9V5.5" />
          <path d="M14 40V31a10 6 0 0 1 20 0v9" />
          <path d="M19 40v-6a5 5 0 0 1 10 0v6" />
          <path d="M8 40V19M6.5 19h3l-1.5-4Z" />
          <path d="M40 40V19M38.5 19h3L40 15Z" />
          {GROUND}
        </>
      );

    /* شاطئ المارينا — parasol over the shoreline */
    case "marina-beach":
      return (
        <>
          <path d="M9 22a13 13 0 0 1 26 0Z" />
          <path d="M22 22v13" />
          <path d="M22 9V6" />
          <circle cx="38" cy="12" r="5" style={DETAIL} />
          <path d="M4 31c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" />
          <path d="M4 39c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" opacity={0.45} />
        </>
      );

    /* مركز الشيخ جابر الثقافي — the overlapping curved shells */
    case "jacc":
      return (
        <>
          <path d="M5 37c0-9 5-16 12-16s12 7 12 16" />
          <path d="M19 37c0-11 6-19 14-19s10 8 10 19" />
          <path d="M26 22.5V37" opacity={0.5} style={DETAIL} />
          <path d="M33 18v-4" />
          <path d="M17 21v-3" />
          <path d="M4 40h40" opacity={0.45} />
        </>
      );

    /* جزيرة فيلكا — a ruined colonnade on the island */
    case "failaka-island":
      return (
        <>
          <path d="M10 14h20M10 10.5h20" />
          <path d="M14 14v18M22 14v18M30 14v13" />
          <path d="M13 32h3M21 32h3" opacity={0.6} style={DETAIL} />
          <path d="M34 20v12" opacity={0.55} />
          <path d="M8 32h32" />
          <path d="M4 41c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" opacity={0.6} />
        </>
      );

    /* بيت المرايا — facetted house catching light */
    case "mirror-house":
      return (
        <>
          <path d="M10 40V21l14-10 14 10v19" />
          <path d="M10 21 24 31l14-10" opacity={0.6} style={DETAIL} />
          <path d="M24 31v9" opacity={0.6} style={DETAIL} />
          <path d="M17 26.5 20 40M31 26.5 28 40" opacity={0.35} style={DETAIL} />
          <path d="M40 8.5 41 6l1 2.5 2.5 1-2.5 1L41 13l-1-2.5-2.5-1Z" />
          {GROUND}
        </>
      );

    /* أكوا بارك — the flume */
    case "aqua-park":
      return (
        <>
          <path d="M12 40V15a5 5 0 0 1 10 0v6" />
          <path d="M22 21c9 0 9 8 0 8s-9 8 0 8h14" />
          <path d="M9 40h6" />
          <path d="M38 34v6" style={DETAIL} />
          {/* The wave line stands in for GROUND here — it is a water park, so
              the mark sits in water rather than on a baseline, and it runs to
              y=44 on purpose. A second wave beneath it was left at opacity 0:
              invisible, but still a node and still counted by getBBox, which
              is what pushed this mark alone outside the 4–44 frame. */}
          <path d="M4 41c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" opacity={0.45} />
        </>
      );

    /* متحف طارق رجب — the calligrapher's reed pen in its inkwell */
    case "tareq-rajab-museum":
      return (
        <>
          {/* The qalam in its inkwell. Calligraphy is the first thing the catalogue
              lists here, and the museum keeps a second building for it. The vessel
              in a vitrine this replaces fared badly in a blind recognition test, and
              a bare jug sits too close to the tea houses' dallah and to the
              coppersmiths of Souq Al-Safafeer. */}
          <path d="M10.5 40c-2 0-3.2-1.6-2.9-3.5l.9-4.8c.5-2.7 2.8-4.7 5.6-4.7h14.8c2.8 0 5.1 2 5.6 4.7l.9 4.8c.3 1.9-.9 3.5-2.9 3.5ZM14.5 27v-3.8h13V27" />
          <path d="M17.6 25.6 30.72 9.09l4 3.1L21.6 28.7M30.72 9.09l5.6-2.9-1.6 6" />
          <path d="M25.8 15.4l4 3.1" style={DETAIL} opacity={0.55} />
          {GROUND}
        </>
      );

    /* الجزيرة الخضراء — planted island ringed by water */
    case "green-island":
      return (
        <>
          <path d="M24 30V17" />
          <path d="M24 17c-5-4-10-2-11 3 4-1 8-1 11-.4Z" />
          <path d="M24 17c5-4 10-2 11 3-4-1-8-1-11-.4Z" />
          <path d="M24 17c-2-5-6-7-11-6 4 2 8 4 10 6Z" />
          <path d="M24 17c2-5 7-7 12-5-4 2-8 3-10 5Z" />
          <path d="M9 30h30" />
          <path d="M4 40c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" opacity={0.6} />
        </>
      );

    /* ── drawn to break up the fallbacks ────────────────────────────────
       Twenty-seven of forty-four places had no mark of their own, so a map
       of six culture places drew the same museum glyph six times and the two
       southern beaches were one identical palm. These are the subjects that
       were colliding most on a single frame. */

    case "fish-market":
      return (
        <>
          <path d="M9 24c5-7 12-10 19-10s12 3 12 10-5 10-12 10-14-3-19-10Z" />
          {/* The tail, and the reason a fish reads as a fish at 16px. */}
          <path d="M9 24 5 17v14Z" />
          <path d="M34 21h.01" style={DETAIL} />
          <path d="M26 17.5c-2 4-2 9 0 13" style={DETAIL} opacity={0.6} />
          {GROUND}
        </>
      );

    case "al-hamra-tower":
      return (
        <>
          {/* The twist: two edges that lean opposite ways, which is the whole
              silhouette people recognise from the skyline. */}
          <path d="M17 40 19 12h10l6 28" />
          <path d="M19 12h10" />
          <path d="M22 20h9M21 28h11" style={DETAIL} opacity={0.55} />
          <path d="M24 12V7" />
          {GROUND}
        </>
      );

    /* قصر السيف — the clock tower, its dial and its dome */
    case "seif-palace":
      return (
        <>
          {/* The clock tower alone, because the dial and the gold-plated dome are
              the whole of what people know it by. The gate in its foot and the
              ground line keep it a building: a tall case with a dial near the top
              is otherwise a grandfather clock. */}
          <path d="M15.5 40V15h17v25M14 15h20" />
          <path d="M18 15a6 6.5 0 0 1 12 0ZM24 8.5V6.5" />
          <circle cx="24" cy="24" r="6" />
          <path d="M24 24v-3.5M24 24h3.5" style={DETAIL} />
          <path d="M21 40v-2.5a3 3 0 0 1 6 0V40" style={DETAIL} />
          {GROUND}
        </>
      );

    /* حديقة حيوان الكويت — a giraffe, standing */
    case "kuwait-zoo":
      return (
        <>
          {/* A giraffe, standing: the animal the previous mark meant, drawn as the
              silhouette that survives 16px, the long neck, the horns and four legs.
              The old one was a tinted arch with a hooked line, and read as neither
              a giraffe nor anything else. */}
          <path d="M20 22.5h14.5c2.5 0 4 1.5 4 4v1c0 1.6-1.4 3-3 3H20c-1.7 0-3-1.3-3-3v-2c0-1.7 1.3-3 3-3Z" />
          <path d="M18.5 23.5 12.5 10.5M16.5 8.5l7 14" />
          <path d="M16.5 8.5 12.5 6.4 7.2 9.4c-.8.5-.6 1.8.4 2l4.9-.9Z" />
          <path d="M13.3 6.8 12.8 4M15.6 7.7l.9-2.7" style={DETAIL} />
          <path d="M20 30.5V40M23.5 30.5V40M32.5 30.5V40M36 30.5V40M38.5 24.5l2.5 5.5" />
          <path d="M23.5 25.5h.01M28.5 25.2h.01M33 27.2h.01M16.3 15.5h.01" style={DETAIL} opacity={0.7} />
          {GROUND}
        </>
      );

    case "khiran":
      return (
        <>
          {/* Water cut into the desert: two channels and a boat, not a beach. */}
          <path d="M4 20h40v6H4ZM4 31h40v6H4Z" />
          <path d="M17 20V9l10 5-10 4.6Z" />
          {GROUND}
        </>
      );

    case "messilah-beach":
      return (
        <>
          {/* A parasol on sand — the difference between this and a public park
              is the thing you bring, not the plants. */}
          <path d="M11 20a12 12 0 0 1 24 0Z" />
          <path d="M23 20v14" />
          <path d="M4 34c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" />
          <path d="M4 41c4 0 4 3 8 3s4-3 8-3 4 3 8 3 4-3 8-3 4 3 8 3" opacity={0.45} />
        </>
      );

    case "wafra-farms":
      return (
        <>
          {/* Rows under glass, with the season's dates hanging at the side. */}
          <path d="M8 40V26l9-6 9 6v14" />
          <path d="M17 20v20M12 30h10M12 35h10" style={DETAIL} opacity={0.6} />
          <path d="M36 40V24" />
          <path d="M36 24c-5 0-7-3-7-6 4 0 7 2 7 6ZM36 24c5 0 7-3 7-6-4 0-7 2-7 6Z" />
          {GROUND}
        </>
      );

    case "friday-market":
      return (
        <>
          {/* A stall: the scalloped awning is the whole signal. */}
          <path d="M7 22h34v18H7Z" />
          <path d="M5 22c0-3 2-5 5-5h28c3 0 5 2 5 5" />
          <path d="M13.5 17v5M22 17v5M30.5 17v5" style={DETAIL} opacity={0.6} />
          <path d="M17 40V30h8v10" style={DETAIL} />
          {GROUND}
        </>
      );

    /* ── the last nineteen ───────────────────────────────────────────────
       After the batch above, nineteen places still fell through to their
       category mark: six of the seven culture places drew the identical
       museum glyph, all four malls drew the same bag, and both café streets
       drew the same cup. On a search for «متحف» or «مجمع» that is a column
       of one repeated icon, which tells the reader nothing about which row
       is which — the exact failure the drawn set exists to prevent.

       Each is drawn from the thing that identifies THAT place rather than
       its type: the planetarium sphere, the lattice facade, the loom, the
       fort, the ferris wheel. Where two places would otherwise collide, the
       second one moves — Marina Mall is its footbridge because Marina Beach
       already owns the parasol and Souq Sharq already owns the sail. */

    case "kuwait-national-museum":
      return (
        <>
          {/* The planetarium sphere, which is what the museum looks like from
              the Gulf Road even when the galleries behind it are shut. */}
          <circle cx="16" cy="19" r="9" />
          <path d="M7.5 15.5h17M7.5 22.5h17" style={DETAIL} opacity={0.5} />
          <path d="M16 28v6" />
          <path d="M7 40v-6h18v6" />
          <path d="M29 40V23h13v17M27.5 23h16" />
          <path d="M33 40v-8h5v8" style={DETAIL} />
          {GROUND}
        </>
      );

    /* مركز الشيخ عبدالله السالم الثقافي — a rocket, for the space museum */
    case "abdullah-al-salem-cultural-centre":
      return (
        <>
          {/* The space museum, drawn as its rocket. The lattice box this replaced
              read as a hatched square in a search row, and the obvious fix is a
              trap: the National Museum has a planetarium too, so a dome or a
              telescope points at both. «فضاء» is in this place's catalogue entry
              and no other. The fins are what keep it from reading as the
              Liberation Tower's needle at 16px. */}
          <path d="M24 5C27.5 7.6 30.5 13 30.5 20v13h-13V20c0-7 3-12.4 6.5-15Z" />
          <circle cx="24" cy="19" r="3.2" style={DETAIL} />
          <path d="M17.5 24 11.5 31v9l6-7ZM30.5 24l6 7v9l-6-7Z" />
          <path d="M20.5 33h7l1 3.5h-9Z" />
          {GROUND}
        </>
      );

    case "al-salam-palace":
      return (
        <>
          {/* Symmetry, a central portal and two corner turrets — a palace
              rather than a museum, which is what it was first. */}
          {/* The first version filled only the bottom half of the frame and
              read as a squat shed beside every neighbour that reaches the
              top. The raised central bay is both the fix and the truth — the
              palace has one. */}
          <path d="M13 40V17h22v23" />
          <path d="M11 17h26" />
          <path d="M18 17V10h12v7M17 10h14" />
          <path d="M24 10V6" style={DETAIL} />
          <path d="M20 40V29a4 4 0 0 1 8 0v11" />
          <path d="M5 40V22h8M35 22h8v18" />
          <path d="M4 22h10M34 22h10" />
          <path d="M16 24h2M30 24h2" style={DETAIL} opacity={0.6} />
          <path d="M8 28h2M38 28h2" style={DETAIL} opacity={0.6} />
          {GROUND}
        </>
      );

    case "amricani-cultural-centre":
      return (
        <>
          {/* Two storeys of arcaded veranda — the mission hospital it was
              built as, and the one building on this list with a colonnade on
              both levels. */}
          <path d="M8 40V15h32v25" />
          <path d="M6 15h36M8 27.5h32" />
          <path d="M12 27.5v-6a3.4 3.4 0 0 1 6.8 0v6" style={DETAIL} />
          <path d="M20.6 27.5v-6a3.4 3.4 0 0 1 6.8 0v6" style={DETAIL} />
          <path d="M29.2 27.5v-6a3.4 3.4 0 0 1 6.8 0v6" style={DETAIL} />
          <path d="M12 40v-6.5a3.4 3.4 0 0 1 6.8 0V40" style={DETAIL} />
          <path d="M20.6 40v-6.5a3.4 3.4 0 0 1 6.8 0V40" style={DETAIL} />
          <path d="M29.2 40v-6.5a3.4 3.4 0 0 1 6.8 0V40" style={DETAIL} />
          {GROUND}
        </>
      );

    case "bait-al-othman":
      return (
        <>
          {/* The studded door. Freej Swaileh already owns the courtyard house
              with its wind tower, so this heritage house is the doorway you
              walk through instead of the roofline you see. */}
          {/* Drawn once without the surround, and it read as a headstone: a
              tinted arch with specks on it. The frame is what makes it a
              doorway, and the split down the middle is what makes it a door
              — two leaves, which is how every one of them is built. */}
          <path d="M9 40V19a15 15 0 0 1 30 0v21" />
          <path d="M13 40V20a11 11 0 0 1 22 0v20" />
          <path d="M24 9v31" />
          <path d="M17.5 24h.01M17.5 30h.01M17.5 36h.01" style={DETAIL} opacity={0.8} />
          <path d="M30.5 24h.01M30.5 30h.01M30.5 36h.01" style={DETAIL} opacity={0.8} />
          <path d="M20.5 16h.01M27.5 16h.01" style={DETAIL} opacity={0.8} />
          {GROUND}
        </>
      );

    case "bait-lothan":
      return (
        <>
          {/* An easel. It is an arts centre in an old house, and every other
              old house on this list is drawn as a building — so this one is
              drawn as what happens inside it. */}
          <path d="M12 9h24v19H12Z" />
          <path d="M16 24l6-8 4.5 5.5 3-3L34 25" style={DETAIL} opacity={0.7} />
          <path d="M15 28 10 40M33 28l5 12M24 28v7" />
          <path d="M11 33h26" style={DETAIL} opacity={0.6} />
          {GROUND}
        </>
      );

    case "sadu-house":
      return (
        <>
          {/* The loom, with the triangle band Sadu weaving is known by. */}
          <path d="M9 12v28M39 12v28" />
          <path d="M7 14h34M7 36h34" />
          <path d="M13 18h22v14H13Z" />
          <path d="M15 30l5-7 5 7M26 30l5-7 5 7" style={DETAIL} opacity={0.7} />
          <path d="M13 25h22" style={DETAIL} opacity={0.4} />
          {GROUND}
        </>
      );

    /* مارينا مول — the glass footbridge from the mall across the road */
    case "marina-mall":
      return (
        <>
          {/* The glass footbridge the catalogue names, from the mall's upper floor
              across the Gulf Road to the seafront side. It slopes on purpose: drawn
              level between two blocks it read as a gate, and level over water on
              piers it reads as the Sheikh Jaber Causeway. */}
          <path d="M4.5 40V14h12.5v26" />
          <path d="M3.5 14 7 9.5h8l3.5 4.5Z" />
          <path d="M17 17.5 34 23v6l-17-5.5" />
          <path d="M22.5 19.3v6M28 21.1v6" style={DETAIL} opacity={0.5} />
          <path d="M34 40V23h9v17M33.5 23l2.5-3.5h5l2.5 3.5Z" />
          <path d="M8.5 40v-4a2.25 2.25 0 0 1 4.5 0v4" style={DETAIL} opacity={0.6} />
          {GROUND}
        </>
      );

    case "mall-360":
      return (
        <>
          {/* The name is the mark: a ring, on the podium it sits on. */}
          <circle cx="24" cy="19" r="12" />
          <circle cx="24" cy="19" r="5" style={DETAIL} />
          <path d="M24 7v3M24 28v3M12 19h3M33 19h3" style={DETAIL} opacity={0.6} />
          <path d="M8 40v-6h32v6" />
          {GROUND}
        </>
      );

    case "al-kout-mall":
      return (
        <>
          {/* الكوت is the fort. The battlemented tower is the name drawn. */}
          <path d="M16 40V14h16v26" />
          <path d="M15 14v-5h3.5v2.5h3.5V9h4v2.5h3.5V9H33v5" />
          <path d="M20 40V29a4 4 0 0 1 8 0v11" />
          <path d="M21 21h6" style={DETAIL} opacity={0.6} />
          <path d="M4 40v-9h12M32 31h12v9" />
          {GROUND}
        </>
      );

    /* سوق الوطية — a dishdasha */
    case "souq-al-watiya":
      return (
        <>
          {/* A dishdasha. «ملابس» is in this souq's catalogue entry and no other
              place's, and garments are what the souq sells. Cloth on a rail, the
              mark this replaced, read as icicles at 24px. No hanger: a hook over
              the collar was tried and became a head, and the robe a man. */}
          <path d="M21 6.5 14.5 9.2 11 28.5l4.5.7.5-11.7V40h16V17.5l.5 11.7 4.5-.7-3.5-19.3-6.5-2.7c-.9 1.6-1.9 2.5-3 2.5s-2.1-.9-3-2.5Z" />
          <path d="M24 9v11" style={DETAIL} opacity={0.6} />
          {/* The cuffs. With the tint gone the robe was one outline and a
              placket, two nodes, and read as a stencil beside its neighbours. */}
          <path d="M11.4 26.2l4.6.7M36.6 26.2l-4.6.7" style={DETAIL} />
        </>
      );

    case "gulf-road-cafes":
      return (
        <>
          {/* A takeaway cup, because that is how the Gulf Road is drunk —
              the Mubarakiya tea houses own the dallah and the finjan. */}
          <path d="M14 18h20l-2.4 15.5a4 4 0 0 1-4 3.5h-7.2a4 4 0 0 1-4-3.5Z" />
          <path d="M11 18h26" />
          <path d="M15.6 26h16.8" style={DETAIL} opacity={0.6} />
          <path d="M18 13c0-2 2-2 2-4M24 13c0-2 2-2 2-4M30 13c0-2 2-2 2-4" style={DETAIL} opacity={0.55} />
          <path d="M5 41c4 0 4 2.5 8 2.5s4-2.5 8-2.5 4 2.5 8 2.5 4-2.5 8-2.5" opacity={0.45} />
        </>
      );

    case "hamad-al-mubarak-street":
      return (
        <>
          {/* Pavement seating under a parasol. Salem Al-Mubarak Street next
              door is drawn as shopfronts, because that is what it is. */}
          <path d="M10 16a14 8 0 0 1 28 0" />
          <path d="M24 16v11" />
          <path d="M14 27h20" />
          <path d="M20 30v10M28 30v10" style={DETAIL} />
          <path d="M5 40v-5h6M5 35v-5M43 40v-5h-6M43 35v-5" style={DETAIL} />
          {GROUND}
        </>
      );

    case "entertainment-city":
      return (
        <>
          {/* The wheel. Aqua Park has the flume, so the theme park has the
              thing you can see from the motorway. */}
          <circle cx="24" cy="19" r="13" />
          <circle cx="24" cy="19" r="2.5" style={DETAIL} />
          <path d="M24 6v26M11 19h26M15 10l18 18M33 10 15 28" style={DETAIL} opacity={0.5} />
          <path d="M18 30 24 40 30 30" />
          {GROUND}
        </>
      );

    case "kuwait-science-centre":
      return (
        <>
          {/* The tank. The aquarium is what a family actually goes for, and a
              framed tank cannot be mistaken for the fish market's fish. */}
          {/* A tank, not a fish. The first version put a big fish inside a
              box and at size-6 it was the fish market again — so the fish
              shrank, the water line went in, and the bubbles do the work.
              What a family goes to the Scientific Center for is the
              aquarium, and an aquarium is a wall of water. */}
          <path d="M7 13h34v27H7Z" />
          <path d="M5 13h38" />
          <path d="M9 19h30" style={DETAIL} opacity={0.45} />
          <path d="M19.5 30c2-2.5 4.4-3.8 6.8-3.8s4.4 1.3 4.4 3.8-2.1 3.8-4.4 3.8-4.8-1.3-6.8-3.8Z" style={DETAIL} />
          <path d="M19.5 30 16.4 27.4v5.2Z" style={DETAIL} />
          <path d="M28.6 28.8h.01" style={DETAIL} />
          <path d="M13 26h.01M15.5 22.5h.01M34 27h.01M36 23h.01" style={DETAIL} opacity={0.6} />
          {GROUND}
        </>
      );

    case "liberation-tower":
      return (
        <>
          {/* The collar and the spire. Al-Hamra is the twist and the Kuwait
              Towers are the spheres; this one is the needle. */}
          <path d="M20.5 35 22 21h4l1.5 14" />
          <path d="M16 21h16l-2.5-5h-11Z" />
          <path d="M24 16V8" />
          <circle cx="24" cy="6" r="2" style={DETAIL} />
          <path d="M21.6 27h4.8" style={DETAIL} opacity={0.5} />
          <path d="M15 40v-5h18v5" />
          {GROUND}
        </>
      );

    case "marina-crescent":
      return (
        <>
          {/* The curve, over the water it is built on. Shallow on purpose —
              a deeper arc reads as the Grand Mosque's dome. */}
          <path d="M6 29a18 10 0 0 1 36 0" />
          <path d="M6 29h36" />
          <path d="M14 29v-5.5M24 29v-6.5M34 29v-5.5" style={DETAIL} opacity={0.6} />
          <path d="M4 35c4 0 4 2.5 8 2.5s4-2.5 8-2.5 4 2.5 8 2.5 4-2.5 8-2.5 4 2.5 8 2.5" opacity={0.5} />
          <path d="M4 41c4 0 4 2.5 8 2.5s4-2.5 8-2.5 4 2.5 8 2.5 4-2.5 8-2.5 4 2.5 8 2.5" opacity={0.32} />
        </>
      );

    /* شارع تونس — a shawarma spit and its carving knife */
    case "tunis-street":
      return (
        <>
          {/* The shawarma spit, being carved: شاورما is the first of this
              street's tags. The spit this replaced was a smooth cone narrowing to
              a point, and at 24px it read as a cup on a stick. The stacked slices
              are what make it meat, and the blade at its side is what makes it a
              spit rather than a goblet. Mais Al-Ghanim owns the skewers. */}
          <path d="M20 4.5V10M11.5 10h17" />
          <path d="M12 10H28A3.6 3.6 0 0 1 26.75 15.75A3.6 3.6 0 0 1 25.5 21.5A3.6 3.6 0 0 1 24.25 27.25A3.6 3.6 0 0 1 23 33H17A3.6 3.6 0 0 1 15.75 27.25A3.6 3.6 0 0 1 14.5 21.5A3.6 3.6 0 0 1 13.25 15.75A3.6 3.6 0 0 1 12 10Z" />
          <path d="M14.25 15.75H25.75M15.5 21.5H24.5M16.75 27.25H23.25" style={DETAIL} opacity={0.5} />
          <path d="M20 33v7M14 35.5h12" />
          <path d="M29 32.5 32.5 14.3l4 1.4ZM34.5 15 37 8" />
          {GROUND}
        </>
      );

    case "sabah-al-ahmad-sea-city":
      return (
        <>
          {/* Villas on a cut canal with a jetty — Al-Khiran next door is drawn
              as the channels themselves, so this is what was built on them. */}
          <path d="M5 28v-8l7-5.5L19 20v8" />
          <path d="M23 28v-6l6-4.5L35 22v6" />
          <path d="M10 28v-4h4v4M27 28v-3.5h4V28" style={DETAIL} opacity={0.6} />
          <path d="M4 28h40" />
          <path d="M38 28v9M42 28v9M40 28v11" style={DETAIL} opacity={0.6} />
          <path d="M4 34c4 0 4 2.5 8 2.5s4-2.5 8-2.5 4 2.5 8 2.5 4-2.5 8-2.5 4 2.5 8 2.5" opacity={0.5} />
          <path d="M4 40c4 0 4 2.5 8 2.5s4-2.5 8-2.5 4 2.5 8 2.5 4-2.5 8-2.5 4 2.5 8 2.5" opacity={0.32} />
        </>
      );

    /* الصالحية — a cut gem */
    case "salhia-complex":
      return (
        <>
          {/* The gem. Salhia is the luxury complex — the catalogue's own emoji for
              it is a gem — and it was one of three places drawing the same
              shopping bag. No other place in the set is a jewel. */}
          <path d="M15 10h18l9 10-18 20L6 20Z" />
          <path d="M6 20h36" />
          <path d="M21 10 16.5 20 24 40l7.5-20L27 10" style={DETAIL} opacity={0.55} />
        </>
      );

    /* بيت ديكسون — the house with its upstairs veranda */
    case "dickson-house":
      return (
        <>
          {/* The upstairs veranda — posts, a rail and the shade behind them — that
              made the Political Agency a «colonial veranda house». Amricani is
              arches on both floors; this is open above and shut below. The tint
              is laid twice on purpose: the veranda is in shade, and that darker
              band is what keeps it from reading as a row of windows at 16px. */}
          <path d="M8 40V13M40 13v27" />
          <path d="M5.5 13h37" />
          <path d="M6.5 25h35" />
          <path d="M24 13v12" />
          <path d="M8 19.5h32" style={DETAIL} />
          <path d="M12 19.5V25M16 19.5V25M20 19.5V25M28 19.5V25M32 19.5V25M36 19.5V25" style={DETAIL} opacity={0.3} />
          <path d="M21 40v-8h6v8" />
          {GROUND}
        </>
      );

    /* شاطئ الشعب — a bench on the waterfront, the sea behind it */
    case "al-shaab-beach":
      return (
        <>
          {/* A bench on the waterfront with the sea behind it — the «جلسات على
              الواجهة» the catalogue names. The armrests are what keep a bench seen
              from the front from reading as a table. Marina and Messilah own the
              parasol. */}
          <path d="M4 13c4 0 4 2.5 8 2.5s4-2.5 8-2.5 4 2.5 8 2.5 4-2.5 8-2.5 4 2.5 8 2.5" opacity={0.75} />
          <path d="M4 19.5c4 0 4 2.5 8 2.5s4-2.5 8-2.5 4 2.5 8 2.5 4-2.5 8-2.5 4 2.5 8 2.5" opacity={0.4} />
          <path d="M10 26h28v3.5H10Z" />
          <path d="M8 33h32" />
          <path d="M12 29.5V40M36 29.5V40" />
          <path d="M8 33c0-2.5 1.5-4 4-4M40 33c0-2.5-1.5-4-4-4" style={DETAIL} />
          {GROUND}
        </>
      );

    /* معرض الكويت الدولي — an open book, for the book fair */
    case "kuwait-fairground":
      return (
        <>
          {/* An open book: the book fair is the exhibition the halls are known
              for, and the catalogue names it. No other place is drawn as one, and
              the ferris wheel it used to fall back to is Entertainment City's. */}
          <path d="M24 14c-4.8-3.4-11.5-4.2-18-2.8v23.3c6.5-1.4 13.2-.6 18 2.8 4.8-3.4 11.5-4.2 18-2.8V11.2c-6.5-1.4-13.2-.6-18 2.8Z" />
          <path d="M24 14v23.3" />
          <path d="M10.5 18c3.4-.5 6.8-.2 10 1M10.5 23.5c3.4-.5 6.8-.2 10 1M37.5 18c-3.4-.5-6.8-.2-10 1M37.5 23.5c-3.4-.5-6.8-.2-10 1" style={DETAIL} opacity={0.55} />
          {GROUND}
        </>
      );

    /* سوق الصفافير — a hammer raised over a copper pot */
    case "souq-al-safafeer":
      return (
        <>
          {/* The coppersmiths' souq: a hammer raised over a copper pot,
              the moment before the blow, for the hand-hammering the souq is
              known by. The Mubarakiya tea houses own the dallah, so the pot
              is the copperware. The hammer hangs above the pot instead of
              striking it from the side, because a diagonal over a squat
              vessel is Tareq Rajab's pen in its inkwell at 16px. Dimples on
              the pot made it a face at 24px; the neck under the lip makes it
              a pot, not a bun. */}
          <path d="M15.5 23.5V25c0 1.5-5.5 2.5-5.5 7.5 0 4.5 3 7.5 7 7.5h14c4 0 7-3 7-7.5 0-5-5.5-6-5.5-7.5v-1.5" />
          <path d="M12.5 23.5h23" />
          <path d="M26.6 14.8 20.9 16.9 17.1 6.6 22.8 4.5Z" />
          <path d="M24.7 9.7 38.5 4.7" />
          <path d="M18 21 16.5 18.5M30 21l1.5-2.5" style={DETAIL} opacity={0.6} />
          {GROUND}
        </>
      );

    /* جسر الشيخ جابر — the cable-stayed span and its sail pylon */
    case "sheikh-jaber-causeway":
      return (
        <>
          {/* The cable-stayed span. Its pylon was designed as a dhow's sail,
              and the stays fan to one side only, over the main span. The piers
              are what make it a bridge: drawn without them, sail and fan over
              water read as a boat, which is Souq Sharq's mark. */}
          <path d="M4 28h40" />
          <path d="M4 31h40" style={DETAIL} opacity={0.55} />
          <path d="M29 28Q26.5 14 32 4l4 24" />
          <path d="M29.8 9.3 5 28M28.7 13.8 12 28M28.2 20 19 28" style={DETAIL} opacity={0.6} />
          <path d="M8 31v8M20 31v8M32.5 31v8" style={DETAIL} opacity={0.6} />
          <path d="M4 40c4 0 4 2.5 8 2.5s4-2.5 8-2.5 4 2.5 8 2.5 4-2.5 8-2.5 4 2.5 8 2.5" opacity={0.45} />
        </>
      );

    /* مجمع الفنار — the lighthouse it is named for, on its podium */
    case "al-fanar-mall":
      return (
        <>
          {/* الفنار is the lighthouse: the mall takes its name from the light
              tower at its entrance, so the name is drawn, as Mall 360's ring
              is. The beams keep it from reading as the Liberation Tower at
              16px. */}
          <path d="M18.5 34l2.5-20h6l2.5 20" />
          <path d="M18 14h12M21 14V9h6v5M20 9a4 3.5 0 0 1 8 0Z" />
          <path d="M24 5.5V4" style={DETAIL} />
          <path d="M17.5 10.5 9 7M17.5 12.5 9 16M30.5 10.5 39 7M30.5 12.5 39 16" style={DETAIL} opacity={0.6} />
          <path d="M22 34v-4a2 2 0 0 1 4 0v4" style={DETAIL} />
          <path d="M7 40v-6h34v6" />
          {GROUND}
        </>
      );

    /* متحف الفن الحديث — a framed abstract and a bust on a plinth */
    case "modern-art-museum":
      return (
        <>
          {/* A painting and a sculpture, because the collection is both. Not a
              palette or an easel: those are Bait Lothan's, whose catalogue mark
              is the palette. The abstract is a circle and a square, because a
              circle with a line through it read as a magnifying glass. */}
          <path d="M5 10h22v19H5Z" />
          <path d="M8.5 13.5h15v12h-15Z" style={DETAIL} opacity={0.4} />
          <circle cx="13" cy="18" r="2.6" style={DETAIL} />
          <path d="M14.5 21h5v3.5h-5Z" style={DETAIL} />
          <path d="M32.5 40V27h9v13M31 27h12" />
          <path d="M33 27c0-3 1.6-4.5 4-4.5s4 1.5 4 4.5" />
          <circle cx="37" cy="19" r="2.8" />
          {GROUND}
        </>
      );

    /* Fallback: a pin, so a newly added place still gets a mark. */
    default:
      return null;
  }
}

export default function PlaceIcon({ slug, className = "size-10", style, ...rest }: Props) {
  // A place with no drawing of its own shows what kind of place it is. The
  // fallback used to be one generic pin, which was fine while every place had
  // bespoke art — but the moment the catalogue grew past the drawn set, a
  // results list turned into a column of identical pins that told the reader
  // nothing. The category mark at least separates a mosque from a beach.
  //
  // Every one of the 52 has its own drawing now, so this is reached only by a
  // slug the catalogue did not have at build time — a place added later. It
  // used to look the place up to draw its category, and that one lookup is
  // what imported all 52 records into every page with a pin or a card on it.
  // The general mark is the price of not shipping the catalogue for a case
  // the build cannot know about.
  if (Art({ slug }) === null) {
    return <CategoryIcon name="all" className={className} />;
  }

  const w = strokeFor(renderedPx(className));
  return (
    <svg
      {...S}
      className={className}
      strokeWidth={w}
      style={{ ["--w2"]: +(w * DETAIL_RATIO).toFixed(3), ...style } as CSSProperties}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <Art slug={slug} />
    </svg>
  );
}
