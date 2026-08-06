import { Suspense } from "react";
import type { Metadata } from "next";
import SearchClient from "./SearchClient";

export const metadata: Metadata = {
  title: "بحث",
  description: "دوّر في كل أماكن وين — معالم، مطاعم، قهوة، شواطئ، أسواق ومناطق الكويت.",
  alternates: { canonical: "/search/" },
};

export default function SearchPage() {
  return (
    <Suspense>
      <SearchClient />
    </Suspense>
  );
}
