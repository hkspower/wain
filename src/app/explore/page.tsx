import { Suspense } from "react";
import type { Metadata } from "next";
import ExploreClient from "./ExploreClient";

export const metadata: Metadata = {
  title: "استكشف",
  description: "دوّر وفلتر أحلى الأماكن في الكويت — معالم، مطاعم، قهوة، شواطئ وأسواق.",
};

export default function ExplorePage() {
  return (
    <Suspense>
      <ExploreClient />
    </Suspense>
  );
}
