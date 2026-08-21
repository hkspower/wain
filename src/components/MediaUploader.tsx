"use client";

import { useEffect, useRef, useState } from "react";
import { IconClose, IconSparkle } from "@/components/icons";
import { haptic } from "@/lib/haptics";
import { toArabicDigits } from "@/lib/places";
import {
  ACCEPT_ATTR,
  MAX_PHOTOS,
  MAX_SIZE_AR,
  describeSize,
  rejectReason,
  type PickedFile,
} from "@/lib/media";

/**
 * Picks the logo and the photos, and says no clearly.
 *
 * Nothing uploads here. Files are held with local previews and handed to the
 * form, which uploads them only once the rest of the submission is valid —
 * otherwise a visitor who fails validation has already pushed a submission's
 * worth of photos into storage for a row that was never created.
 */

function useObjectUrls() {
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  return {
    make(file: File) {
      const u = URL.createObjectURL(file);
      urls.current.push(u);
      return u;
    },
    drop(u: string) {
      URL.revokeObjectURL(u);
      urls.current = urls.current.filter((x) => x !== u);
    },
  };
}

export default function MediaUploader({
  logo,
  photos,
  onLogo,
  onPhotos,
  disabled,
}: {
  logo: PickedFile | null;
  photos: PickedFile[];
  onLogo: (f: PickedFile | null) => void;
  onPhotos: (f: PickedFile[]) => void;
  disabled?: boolean;
}) {
  const urls = useObjectUrls();
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  function acceptLogo(list: FileList | null) {
    const file = list?.[0];
    if (!file) return;
    const bad = rejectReason(file);
    if (bad) { haptic("error"); return setErrors([bad]); }
    setErrors([]);
    haptic("select");
    if (logo) urls.drop(logo.preview);
    onLogo({ file, preview: urls.make(file), id: `${file.name}-${file.lastModified}` });
  }

  function acceptPhotos(list: FileList | null) {
    if (!list?.length) return;
    const incoming = [...list];
    const problems: string[] = [];
    const good: PickedFile[] = [];

    for (const file of incoming) {
      const bad = rejectReason(file);
      if (bad) { problems.push(bad); continue; }
      const id = `${file.name}-${file.lastModified}-${file.size}`;
      if (photos.some((p) => p.id === id) || good.some((p) => p.id === id)) continue;
      good.push({ file, preview: urls.make(file), id });
    }

    const room = MAX_PHOTOS - photos.length;
    if (good.length > room) {
      problems.push(
        `الحد ${toArabicDigits(MAX_PHOTOS)} صور — أخذنا أول ${toArabicDigits(room > 0 ? room : 0)}.`
      );
      good.splice(Math.max(room, 0));
    }
    setErrors(problems);
    haptic(problems.length && !good.length ? "error" : "select");
    if (good.length) onPhotos([...photos, ...good]);
  }

  function removePhoto(id: string) {
    const gone = photos.find((p) => p.id === id);
    if (gone) urls.drop(gone.preview);
    onPhotos(photos.filter((p) => p.id !== id));
  }

  return (
    <div className="space-y-5 standalone:space-y-4">
      {/* ---- logo ---- */}
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-ink-700">شعار المكان</span>
        <div className="flex flex-wrap items-center gap-4">
          <span
            aria-hidden="true"
            className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl border border-line bg-sand-100 text-sand-600"
          >
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL, never optimised
              <img src={logo.preview} alt="" className="size-full object-cover" />
            ) : (
              <IconSparkle className="size-7" />
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex min-h-11 cursor-pointer items-center rounded-xl border border-line-control bg-white px-4 text-sm font-semibold text-ink-700 transition hover:border-sea-300">
              {logo ? "بدّل الشعار" : "اختر شعار"}
              <input
                type="file" accept={ACCEPT_ATTR} className="sr-only" disabled={disabled}
                onChange={(e) => { acceptLogo(e.target.files); e.target.value = ""; }}
              />
            </label>
            {logo && (
              <button
                type="button"
                onClick={() => { urls.drop(logo.preview); onLogo(null); }}
                className="inline-flex min-h-11 items-center gap-1 rounded-xl px-3 text-sm font-semibold text-ink-500 transition hover:text-coral-700"
              >
                <IconClose className="size-4" />
                احذف
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-ink-500">
          مربّع أحسن. JPG أو PNG أو WebP، لين {MAX_SIZE_AR}.
        </p>
      </div>

      {/* ---- photos ---- */}
      <div>
        <span className="mb-1.5 block text-sm font-semibold text-ink-700">
          صور المكان
          <span className="ms-1 font-normal text-ink-500">
            ({toArabicDigits(photos.length)}/{toArabicDigits(MAX_PHOTOS)})
          </span>
        </span>

        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            acceptPhotos(e.dataTransfer.files);
          }}
          className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-5 text-center transition ${
            dragging ? "border-sea-400 bg-sea-50" : "border-line-strong bg-sand-100/60 hover:border-sea-300"
          }`}
        >
          <span className="text-sm font-semibold text-ink-700">
            اسحب الصور هني، أو اضغط للاختيار
          </span>
          <span className="text-xs text-ink-500">
            لين {toArabicDigits(MAX_PHOTOS)} صور، كل وحدة {MAX_SIZE_AR}
          </span>
          <input
            type="file" accept={ACCEPT_ATTR} multiple className="sr-only" disabled={disabled}
            onChange={(e) => { acceptPhotos(e.target.files); e.target.value = ""; }}
          />
        </label>

        {photos.length > 0 && (
          <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {photos.map((p) => (
              <li key={p.id} className="group relative aspect-square overflow-hidden rounded-xl border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
                <img src={p.preview} alt="" className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(p.id)}
                  aria-label={`احذف ${p.file.name}`}
                  className="absolute end-1 top-1 grid size-7 place-items-center rounded-full bg-ink-900/80 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <IconClose className="size-3.5" />
                </button>
                <span className="absolute inset-x-0 bottom-0 truncate bg-ink-900/70 px-1.5 py-0.5 text-2xs text-white">
                  {describeSize(p.file.size)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-2xl border border-coral-200 bg-coral-50 px-4 py-3">
          {errors.map((e) => (
            <li key={e} className="text-xs font-semibold text-coral-800">{e}</li>
          ))}
        </ul>
      )}

      <p className="rounded-2xl bg-sand-100 px-4 py-3 text-xs text-ink-600">
        الصور تنراجع قبل ما تنشر. ارفع صور من عندك بس — لا ترفع صور مأخوذة من
        حساب ثاني أو من الإنترنت.
      </p>
    </div>
  );
}
