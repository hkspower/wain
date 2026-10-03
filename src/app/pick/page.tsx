import { Suspense } from "react";
import type { Metadata } from "next";
import BackButton from "@/components/BackButton";
import PickClient from "./PickClient";

export const metadata: Metadata = {
  title: "اختاروا وين نروح",
  description: "ربعك أرسلوا لك كم مكان — شوفهم على الخريطة واختار اللي تبيه.",
  // The page is its link: without `?p=` it is a sentence and a way to search.
  // Nothing here is worth a search result of its own — and so no canonical:
  // null, not absent, because absent inherits the layout's «/» (/admin and
  // /orders learned that, and audit:runtime holds it).
  robots: { index: false, follow: true },
  alternates: { canonical: null },
};

export default function PickPage() {
  return (
    <>
      <link rel="preconnect" href="https://www.openstreetmap.org" />
      <BackButton />
      <Suspense>
        <PickClient />
      </Suspense>
    </>
  );
}
