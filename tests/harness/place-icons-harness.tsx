/**
 * Every place icon on one page, so they can be measured and looked at.
 *
 * The UI set has had this since the day IconPalm was found rendering as a
 * black smear — a defect invisible in the source and obvious the moment it was
 * drawn. The place set never had it, and it is the set where the failure is
 * likelier: 48 units of room invites detail, and detail is exactly what stops
 * working at the 16px a search-result row gives it.
 *
 * So each mark is rendered three times — at the hero size it was drawn for, at
 * the card size, and at the row size — because "does it work" has a different
 * answer at each, and only the smallest one matters for whether someone can
 * tell two places apart while scrolling.
 */
import type React from "react";
import { createRoot } from "react-dom/client";
import PlaceIcon from "@/components/PlaceIcon";
import { places } from "@/lib/places";

const ALL = [...places].sort((a, b) => a.slug.localeCompare(b.slug));

declare global {
  interface Window {
    measure: () => Array<{
      slug: string;
      nameAr: string;
      category: string;
      /** Whether this place has its own mark or is falling back to its category. */
      bespoke: boolean;
      x: number; y: number; w: number; h: number;
      nodes: number;
      /** Elements that carry the 14% volume tint. */
      tinted: number;
    }>;
  }
}

window.measure = () =>
  ALL.map((p) => {
    const svg = document.querySelector<SVGSVGElement>(`#p-${p.slug} svg`)!;
    const b = (svg as unknown as SVGGraphicsElement).getBBox();
    // A fallback renders the category icon, which is drawn on the 24 grid — so
    // a viewBox of "0 0 24 24" is the tell, and it needs no other heuristic.
    const bespoke = (svg.getAttribute("viewBox") ?? "").trim() === "0 0 48 48";
    return {
      slug: p.slug,
      nameAr: p.nameAr,
      category: p.category,
      bespoke,
      x: +b.x.toFixed(2), y: +b.y.toFixed(2),
      w: +b.width.toFixed(2), h: +b.height.toFixed(2),
      nodes: svg.querySelectorAll("*").length,
      tinted: svg.querySelectorAll('[fill-opacity="0.14"]').length,
    };
  });

function Sheet() {
  return (
    <div style={{ direction: "rtl" }}>
      <div className="grid">
        {ALL.map((p) => (
          <figure key={p.slug} id={`p-${p.slug}`}>
            <PlaceIcon slug={p.slug} className="size-20" />
            <figcaption>
              <b>{p.nameAr}</b>
              <span className="slug">{p.slug}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      {/* The sizes they are actually used at. A mark that only works at 80px
          is a mark that does not work. */}
      <div className="small-run">
        <h2>size-6 — a search-result row</h2>
        <div className="run">
          {ALL.map((p) => (
            <PlaceIcon key={p.slug} slug={p.slug} className="size-6" />
          ))}
        </div>
        <h2>size-9 — a card</h2>
        <div className="run">
          {ALL.map((p) => (
            <PlaceIcon key={p.slug} slug={p.slug} className="size-9" />
          ))}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Sheet />);
