import { Suspense } from "react";
import type { Metadata } from "next";
import ExploreClient from "./ExploreClient";
import BackButton from "@/components/BackButton";

export const metadata: Metadata = {
  title: "استكشف",
  description: "دوّر وفلتر أحلى الأماكن في الكويت — معالم، مطاعم، قهوة، شواطئ وأسواق.",
  // Its own, or it inherits the layout's «/» and tells a search engine this
  // page is the home page.
  alternates: { canonical: "/explore/" },
};

export default function ExplorePage() {
  return (
    <>
      <BackButton />
      <Suspense>
        <ExploreClient />
      </Suspense>
    </>
  );
}
