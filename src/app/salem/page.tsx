import type { Metadata } from "next";
import SalemChat from "@/app/salem/SalemChat";

export const metadata: Metadata = {
  title: "سالم",
  description: "اكتب لسالم وقول له وش تبي، وياخذك على أحسن مكان بالكويت.",
  alternates: { canonical: "/salem" },
};

/**
 * سالم's typed chat — see `SalemChat.tsx`'s own header comment for the
 * full, three-part history of what this page has claimed and why.
 */
export default function SalemPage() {
  return <SalemChat />;
}
