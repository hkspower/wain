import type { Metadata } from "next";
import AdminApp from "@/components/admin/AdminApp";

export const metadata: Metadata = {
  title: "لوحة التحكّم",
  // A private tool, not content: keep it out of search results and previews.
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminPage() {
  return <AdminApp />;
}
