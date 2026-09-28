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
    <div className="mx-auto max-w-3xl px-2.5 py-2 sm:px-4 sm:py-3">
      <h1 className="text-center font-display text-3xl font-bold text-ink-900 sm:text-4xl">
        كيف تبي تدوّر؟
      </h1>
      <FindChoice />
    </div>
  );
}
