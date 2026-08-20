"use client";

import { useCallback, useEffect, useState } from "react";
import { IconCheck, IconClose, IconPinSolid } from "@/components/icons";
import { getCategory, toArabicDigits } from "@/lib/places";
import { loadSupabase } from "@/lib/supabase";
import type { SubmissionRow } from "@/lib/submissions";
import type { EditablePlace } from "@/components/admin/PlaceForm";

/** A URL-safe slug from the English name, deduped by the caller if needed. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * A submission is not a place, so approving one is a review, not a copy: the
 * editor opens prefilled and the admin sets what a business owner cannot be
 * asked for — the rating, the emoji, the final slug — before anything is
 * published.
 */
export function submissionToPlace(s: SubmissionRow): EditablePlace {
  return {
    slug: slugify(s.name),
    name: s.name,
    nameAr: s.name_ar,
    category: s.category,
    area: "",
    areaAr: s.area_ar,
    lat: s.lat ?? 29.3759,
    lng: s.lng ?? 47.9774,
    rating: 4.5,
    priceLevel: s.price_level,
    emoji: "📍",
    taglineAr: s.tagline_ar,
    descriptionAr: s.description_ar || s.tagline_ar,
    bioAr: s.bio_ar || undefined,
    // Media is attached on save, after the admin has picked what to publish.
    logoUrl: undefined,
    imageUrls: undefined,
    highlightsAr: [],
    bestTimeAr: "",
    featured: false,
    published: false,
    sortOrder: 0,
  };
}

const STATUS_LABEL = { pending: "بانتظار المراجعة", approved: "معتمد", rejected: "مرفوض" } as const;
const STATUS_TONE = {
  pending: "bg-sun-100 text-sun-900",
  approved: "bg-palm-500/12 text-palm-700",
  rejected: "bg-sand-200 text-ink-600",
} as const;

export default function Submissions({
  onApprove,
  onCountChange,
}: {
  onApprove: (s: SubmissionRow) => void;
  onCountChange?: (pending: number) => void;
}) {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = await loadSupabase();
    if (!sb) return;
    setLoading(true);
    let query = sb.from("submissions").select("*").order("created_at", { ascending: false });
    if (filter === "pending") query = query.eq("status", "pending");
    const { data, error: e } = await query;
    setLoading(false);
    if (e) { setError(e.message); return; }
    setRows((data ?? []) as SubmissionRow[]);
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  // The badge counts what still needs a decision, regardless of the filter.
  useEffect(() => {
    if (!onCountChange) return;
    let cancelled = false;
    void (async () => {
      const sb = await loadSupabase();
      if (cancelled || !sb) return;
      const { count } = await sb
        .from("submissions")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (!cancelled) onCountChange(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [rows, onCountChange]);

  async function reject(s: SubmissionRow) {
    const note = window.prompt(`سبب رفض «${s.name_ar}»؟ (اختياري)`, "");
    if (note === null) return;
    const sb = await loadSupabase();
    if (!sb) return;
    const { error: e } = await sb
      .from("submissions")
      .update({
        status: "rejected",
        admin_note: note,
        reviewed_at: new Date().toISOString(),
        reviewed_by: (await sb.auth.getUser()).data.user?.id ?? null,
      })
      .eq("id", s.id);
    if (e) setError(e.message);
    else void load();
  }

  if (error) {
    return (
      <p className="rounded-2xl border border-coral-200 bg-coral-50 px-4 py-3 text-sm font-semibold text-coral-800">
        {error}
        <br />
        لو الجدول مو موجود، شغّل <code dir="ltr">supabase/schema.sql</code> مرة ثانية.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(["pending", "all"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            aria-pressed={filter === f}
            className={`min-h-11 rounded-full px-4 text-sm font-semibold transition ${
              filter === f
                ? "bg-ink-900 text-white"
                : "border border-line bg-white text-ink-600 hover:border-sea-300"
            }`}
          >
            {f === "pending" ? "بانتظار المراجعة" : "كل الطلبات"}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-11 rounded-full border border-line-control bg-white px-4 text-sm font-semibold text-ink-600 transition hover:border-sea-300"
        >
          تحديث
        </button>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-ink-500">نحمّل الطلبات…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line-strong bg-sand-100/70 py-14 text-center">
          <p className="font-display text-lg font-semibold text-ink-900">
            {filter === "pending" ? "ما في طلبات تنتظر" : "ما وصلنا أي طلب بعد"}
          </p>
          <p className="mt-1 text-sm text-ink-500">
            الطلبات توصل من صفحة <code dir="ltr">/add</code>.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((s) => {
            const cat = getCategory(s.category);
            const isOpen = open === s.id;
            return (
              <li key={s.id} className="rounded-2xl border border-line bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg font-semibold text-ink-900">{s.name_ar}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[s.status]}`}>
                        {STATUS_LABEL[s.status]}
                      </span>
                      {cat && (
                        <span className="rounded-full bg-sea-50 px-2 py-0.5 text-[11px] font-semibold text-sea-700">
                          {cat.ar}
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-ink-500">
                      <span dir="ltr">{s.name}</span> — {s.area_ar}
                      {s.lat != null && s.lng != null && (
                        <span className="ms-2 inline-flex items-center gap-1 text-xs text-palm-700">
                          <IconPinSolid className="size-3" />
                          بإحداثيات
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-sm text-ink-600">{s.tagline_ar}</p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : s.id)}
                      className="min-h-11 rounded-xl border border-line-control bg-white px-3 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
                    >
                      {isOpen ? "إخفاء" : "التفاصيل"}
                    </button>
                    {s.status === "pending" && (
                      <>
                        <button
                          type="button"
                          onClick={() => onApprove(s)}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-palm-600 px-3 text-sm font-semibold text-white transition hover:bg-palm-700"
                        >
                          <IconCheck className="size-4" />
                          راجع واعتمد
                        </button>
                        <button
                          type="button"
                          onClick={() => void reject(s)}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line-control bg-white px-3 text-sm font-semibold text-ink-600 transition hover:border-coral-300 hover:text-coral-700"
                        >
                          <IconClose className="size-4" />
                          ارفض
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-2">
                    <Row k="العنوان" v={s.address_ar} />
                    <Row k="الإحداثيات" v={s.lat != null ? `${s.lat}, ${s.lng}` : "—"} ltr />
                    <Row k="مستوى الأسعار" v={"د.ك".repeat(s.price_level)} />
                    <Row k="تلفون المكان" v={s.phone} ltr />
                    <Row k="إنستقرام" v={s.instagram ? `@${s.instagram}` : ""} ltr />
                    <Row k="الموقع" v={s.website} ltr />
                    <Row k="مقدّم الطلب" v={s.contact_name} />
                    <Row k="إيميله" v={s.contact_email} ltr />
                    <Row k="تلفونه" v={s.contact_phone} ltr />
                    <Row k="وصل" v={new Date(s.created_at).toLocaleDateString("ar-KW")} />
                    {s.description_ar && (
                      <div className="sm:col-span-2">
                        <dt className="text-xs font-semibold text-ink-500">الوصف</dt>
                        <dd className="mt-0.5 leading-relaxed text-ink-700">{s.description_ar}</dd>
                      </div>
                    )}
                    {s.admin_note && <Row k="ملاحظة الإدارة" v={s.admin_note} />}
                    {s.published_slug && <Row k="نُشر باسم" v={s.published_slug} ltr />}
                  </dl>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 0 && (
        <p className="mt-4 text-xs text-ink-500">
          {toArabicDigits(rows.length)} طلب معروض.
        </p>
      )}
    </div>
  );
}

function Row({ k, v, ltr }: { k: string; v: string; ltr?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold text-ink-500">{k}</dt>
      <dd className="text-ink-700" dir={ltr ? "ltr" : undefined}>{v || "—"}</dd>
    </div>
  );
}
