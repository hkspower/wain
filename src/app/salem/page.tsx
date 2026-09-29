import type { Metadata } from "next";
import SalemChat from "@/app/salem/SalemChat";

export const metadata: Metadata = {
  title: "سالم",
  description: "اكتب لسالم وقول له وش تبي، وياخذك على أحسن مكان بالكويت.",
  alternates: { canonical: "/salem" },
};

/**
 * سالم's own page — a typed chat, reachable on its own rather than only as
 * a mid-call voice swap. See the note over `SALEM_VOICE_ID` in
 * `lib/wain-ai.ts` for what changed and why.
 */
export default function SalemPage() {
  return <SalemChat />;
}
