"use client";

import { useState } from "react";
import CoordinatePicker from "@/components/CoordinatePicker";
import { fieldDenseClass, labelClass } from "@/lib/form-classes";
import { categories, type CategoryId, type Place } from "@/lib/places";

export interface EditablePlace extends Place {
  id?: string;
  published?: boolean;
  sortOrder?: number;
}

const EMPTY: EditablePlace = {
  slug: "",
  name: "",
  nameAr: "",
  category: "landmarks",
  area: "",
  areaAr: "",
  lat: 29.3759,
  lng: 47.9774,
  rating: 4.5,
  priceLevel: 2,
  emoji: "📍",
  taglineAr: "",
  descriptionAr: "",
  highlightsAr: [],
  bestTimeAr: "",
  featured: false,
  published: true,
  sortOrder: 0,
};

const label = labelClass;
const input = fieldDenseClass;

/** Validation mirrors the database CHECK constraints so errors surface here. */
export function validate(p: EditablePlace): string[] {
  const errs: string[] = [];
  if (!/^[a-z0-9-]+$/.test(p.slug)) errs.push("المعرّف (slug) لازم يكون حروف إنجليزية صغيرة وأرقام وشرطات فقط.");
  if (!p.nameAr.trim()) errs.push("الاسم بالعربي مطلوب.");
  if (!p.name.trim()) errs.push("الاسم بالإنجليزي مطلوب.");
  if (!p.areaAr.trim()) errs.push("المنطقة بالعربي مطلوبة.");
  if (!p.taglineAr.trim()) errs.push("الوصف المختصر مطلوب.");
  if (!p.descriptionAr.trim()) errs.push("الوصف الكامل مطلوب.");
  if (!p.bestTimeAr.trim()) errs.push("أحسن وقت للزيارة مطلوب.");
  if (p.rating < 0 || p.rating > 5) errs.push("التقييم لازم يكون بين ٠ و ٥.");
  if (p.priceLevel < 1 || p.priceLevel > 3) errs.push("مستوى السعر لازم يكون ١ أو ٢ أو ٣.");
  if (p.lat < -90 || p.lat > 90) errs.push("خط العرض غير صحيح.");
  if (p.lng < -180 || p.lng > 180) errs.push("خط الطول غير صحيح.");
  return errs;
}

export default function PlaceForm({
  initial,
  busy,
  onSave,
  onCancel,
}: {
  initial?: EditablePlace;
  busy: boolean;
  onSave: (p: EditablePlace) => void;
  onCancel: () => void;
}) {
  const [p, setP] = useState<EditablePlace>(initial ?? EMPTY);
  const [errs, setErrs] = useState<string[]>([]);
  const set = <K extends keyof EditablePlace>(k: K, v: EditablePlace[K]) =>
    setP((prev) => ({ ...prev, [k]: v }));
  /** Both coordinates at once — setting them one at a time would move the pin
   *  through a location that is not either of them. */
  const setAll = (patch: Partial<EditablePlace>) => setP((prev) => ({ ...prev, ...patch }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const found = validate(p);
    setErrs(found);
    if (found.length === 0) onSave(p);
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {errs.length > 0 && (
        <ul className="rounded-2xl border border-coral-200 bg-coral-50 p-4 text-sm text-coral-800">
          {errs.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="f-nameAr">الاسم بالعربي</label>
          <input id="f-nameAr" className={input} value={p.nameAr} onChange={(e) => set("nameAr", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="f-name">الاسم بالإنجليزي</label>
          <input id="f-name" dir="ltr" className={input} value={p.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="f-slug">المعرّف في الرابط (slug)</label>
          <input id="f-slug" dir="ltr" className={input} value={p.slug} onChange={(e) => set("slug", e.target.value)} placeholder="kuwait-towers" />
        </div>
        <div>
          <label className={label} htmlFor="f-cat">التصنيف</label>
          <select id="f-cat" className={input} value={p.category} onChange={(e) => set("category", e.target.value as CategoryId)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.ar}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="f-areaAr">المنطقة بالعربي</label>
          <input id="f-areaAr" className={input} value={p.areaAr} onChange={(e) => set("areaAr", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="f-area">المنطقة بالإنجليزي</label>
          <input id="f-area" dir="ltr" className={input} value={p.area} onChange={(e) => set("area", e.target.value)} />
        </div>
      </div>

      <div>
        <label className={label} htmlFor="f-tag">وصف مختصر</label>
        <input id="f-tag" className={input} value={p.taglineAr} onChange={(e) => set("taglineAr", e.target.value)} />
      </div>

      <div>
        <label className={label} htmlFor="f-desc">الوصف الكامل</label>
        <textarea id="f-desc" rows={4} className={input} value={p.descriptionAr} onChange={(e) => set("descriptionAr", e.target.value)} />
      </div>

      <div>
        <label className={label} htmlFor="f-high">أبرز ما فيه — سطر لكل نقطة</label>
        <textarea
          id="f-high"
          rows={3}
          className={input}
          value={p.highlightsAr.join("\n")}
          onChange={(e) => set("highlightsAr", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="f-best">أحسن وقت للزيارة</label>
          <input id="f-best" className={input} value={p.bestTimeAr} onChange={(e) => set("bestTimeAr", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="f-emoji">الرمز</label>
          <input id="f-emoji" className={input} value={p.emoji} onChange={(e) => set("emoji", e.target.value)} />
        </div>
        <div>
          <label className={label} htmlFor="f-lat">خط العرض (lat)</label>
          <input id="f-lat" dir="ltr" type="number" step="0.0001" className={input} value={p.lat} onChange={(e) => set("lat", Number(e.target.value))} />
        </div>
        <div>
          <label className={label} htmlFor="f-lng">خط الطول (lng)</label>
          <input id="f-lng" dir="ltr" type="number" step="0.0001" className={input} value={p.lng} onChange={(e) => set("lng", Number(e.target.value))} />
        </div>
        <div className="sm:col-span-2">
          {/* Two numbers nobody can sanity-check by reading them is how a pin
              ends up a kilometre out. The map is the check. */}
          <CoordinatePicker
            lat={p.lat}
            lng={p.lng}
            onPick={(at) => setAll({ lat: at.lat, lng: at.lng })}
            label="اضغط على الخريطة لضبط الموقع بدقّة"
          />
        </div>
        <div>
          <label className={label} htmlFor="f-rating">التقييم (٠–٥)</label>
          <input id="f-rating" dir="ltr" type="number" step="0.1" min="0" max="5" className={input} value={p.rating} onChange={(e) => set("rating", Number(e.target.value))} />
        </div>
        <div>
          <label className={label} htmlFor="f-price">مستوى السعر</label>
          <select id="f-price" className={input} value={p.priceLevel} onChange={(e) => set("priceLevel", Number(e.target.value) as 1 | 2 | 3)}>
            <option value={1}>اقتصادي</option>
            <option value={2}>متوسط</option>
            <option value={3}>راقي</option>
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-800">
          <input type="checkbox" className="size-4 accent-coral-600" checked={!!p.featured} onChange={(e) => set("featured", e.target.checked)} />
          مميّز في الصفحة الرئيسية
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-800">
          <input type="checkbox" className="size-4 accent-palm-600" checked={p.published !== false} onChange={(e) => set("published", e.target.checked)} />
          منشور
        </label>
      </div>

      <div className="flex gap-3 border-t border-line pt-5">
        <button
          type="submit"
          disabled={busy}
          className="rounded-xl bg-ink-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800 disabled:opacity-60"
        >
          {busy ? "نحفظ…" : "حفظ"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-line-control bg-white px-5 py-2.5 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
}
