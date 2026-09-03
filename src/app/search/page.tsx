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
    <>
      {/* The results map's basemap comes from a third party, so its connection
          is built from scratch — DNS, TCP, TLS — before a byte of map arrives.
          Opening it while the page is still parsing takes that off the
          iframe's critical path.

          Here rather than in SearchClient or SearchMap, and that placement is
          the whole point: SearchClient reads the query string, so Next leaves
          it out of the prerendered HTML entirely, and SearchMap does not exist
          until there are results — by which time the iframe is already waiting
          on the handshake this is meant to have finished. Only this side of
          the Suspense boundary is actually in the file the browser parses. */}
      <link rel="preconnect" href="https://www.openstreetmap.org" />
      <Suspense>
        <SearchClient />
      </Suspense>
    </>
  );
}
