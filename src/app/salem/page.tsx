import type { Metadata } from "next";
import SalemChat from "@/app/salem/SalemChat";

export const metadata: Metadata = {
  title: "شوق",
  description: "اكتب لشوق وقول لها وش تبي، وتاخذك على أحسن مكان بالكويت.",
  alternates: { canonical: "/salem" },
};

/**
 * شوق's typed chat, answering in سالم's voice — see `SalemChat.tsx`'s own
 * header comment for what this page is, what it used to claim, and why the
 * URL stays `/salem` while the identity on screen does not.
 */
export default function SalemPage() {
  return <SalemChat />;
}
