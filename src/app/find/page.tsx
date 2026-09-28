import type { Metadata } from "next";
import FindChoice from "@/app/find/FindChoice";

export const metadata: Metadata = {
  title: "دوّر",
  description: "اكتب اسم المكان، أو كلّم شوق وقول لها شنو تبي.",
  alternates: { canonical: "/find" },
};

/**
 * One tap, from the home page's «إلى وين؟» dial: pick how to search before
 * landing on /search, rather than being asked mid-page once a box is already
 * in front of you. See the comment over `FindChoice` for why this is a
 * separate route and not the dial's old in-place panel.
 */
export default function FindPage() {
  return (
    <>
      {/* The visible «كيف تبي تدوّر؟» is a decorative pill inside
          FindChoice now, straddling its two full-bleed halves and hidden
          from the accessibility tree — this is the real heading, read
          first regardless of where the pill sits on screen. */}
      <h1 className="sr-only">كيف تبي تدوّر؟</h1>
      <FindChoice />
    </>
  );
}
