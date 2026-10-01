import type { Metadata } from "next";
import AdminApp from "@/components/admin/AdminApp";

export const metadata: Metadata = {
  title: "لوحة التحكّم",
  // A private tool, not content: keep it out of search results and previews.
  robots: { index: false, follow: false, nocache: true },
  // No canonical: the layout's «/» beside «noindex» said «do not index me,
  // I am the home page».
  alternates: { canonical: null },
};

export default function AdminPage() {
  return <AdminApp />;
}
