import type { Metadata } from "next";
import FindChoice from "@/app/find/FindChoice";

export const metadata: Metadata = {
  title: "دوّر",
  description: "كلّم شوق وقول لها شنو تبي، أو اكتب لسالم.",
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
      {/* Used to have a visible echo of this: a decorative pill straddling
          FindChoice's two halves, aria-hidden so it was never what a screen
          reader announced. Removed on request — the two halves already say
          what they are — but the page still needs a real <h1>, so this one
          stays, sr-only, exactly as it always was for a screen reader. */}
      <h1 className="sr-only">كيف تبي تدوّر؟</h1>
      <FindChoice />
    </>
  );
}
