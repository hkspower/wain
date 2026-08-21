/**
 * Every icon on one page, so they can be measured and looked at.
 *
 * Icons go wrong in ways that reading the source does not reveal: an underlay
 * that has drifted a fraction off its outline, one glyph optically larger than
 * the rest so a row of them looks ragged, a shape that simply does not read as
 * the thing it names. All of that needs rendering.
 */
import type React from "react";
import { createRoot } from "react-dom/client";
import * as icons from "@/components/icons";

const ALL = Object.entries(icons as Record<string, (p: { className?: string }) => React.ReactElement>)
  .filter(([name]) => name.startsWith("Icon"))
  .sort(([a], [b]) => a.localeCompare(b));

declare global {
  interface Window {
    measure: () => Array<{
      name: string; x: number; y: number; w: number; h: number;
      nodes: number; area: number;
    }>;
  }
}

window.measure = () =>
  ALL.map(([name]) => {
    const svg = document.querySelector<SVGSVGElement>(`#i-${name} svg`)!;
    // getBBox is the geometry only; stroke width is not included, which is what
    // we want — the question is where the shape sits on the 24-unit grid.
    const b = (svg as unknown as SVGGraphicsElement).getBBox();
    return {
      name,
      x: +b.x.toFixed(2), y: +b.y.toFixed(2),
      w: +b.width.toFixed(2), h: +b.height.toFixed(2),
      nodes: svg.querySelectorAll("*").length,
      area: +(b.width * b.height).toFixed(1),
    };
  });

function Sheet() {
  return (
    <div>
      <div className="row">
        {ALL.map(([name, Icon]) => (
          <figure key={name} id={`i-${name}`}>
            <Icon className="ic" />
            <figcaption>{name.replace("Icon", "")}</figcaption>
          </figure>
        ))}
      </div>
      {/* A run at text size, which is how most of them are actually seen:
          inline beside a label, where a ragged set is most obvious. */}
      <p className="inline-run">
        {ALL.map(([name, Icon]) => (
          <span key={name}>
            <Icon className="ic-sm" />
          </span>
        ))}
      </p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Sheet />);
