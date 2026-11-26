import type { Metadata } from "next";
import CallCenter from "@/app/callcenter/CallCenter";

export const metadata: Metadata = {
  title: "مركز الاتصال",
  description: "كلّم شوق أو اكتب لسالم، وياخذك على أحسن مكان بالكويت.",
  alternates: { canonical: "/callcenter" },
};

export default function CallCenterPage() {
  return <CallCenter />;
}
