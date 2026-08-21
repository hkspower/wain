"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconClose } from "@/components/icons";
import { signedPendingUrl } from "@/lib/media";

/**
 * Look at what a business sent, and pick what goes public.
 *
 * Pending files live in a private bucket, so they are fetched through
 * short-lived signed URLs — an admin can see them, nobody else can, and the
 * link expires rather than leaking.
 *
 * Everything starts unselected. Approval is a decision someone makes, not a
 * default that happens when nobody looks.
 */
export default function MediaReview({
  logoPath,
  imagePaths,
  selected,
  onSelected,
  logoApproved,
  onLogoApproved,
}: {
  logoPath: string | null;
  imagePaths: string[];
  selected: string[];
  onSelected: (paths: string[]) => void;
  logoApproved: boolean;
  onLogoApproved: (v: boolean) => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const all = [...(logoPath ? [logoPath] : []), ...imagePaths];
  const key = all.join("|");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const entries = await Promise.all(
        all.map(async (p) => [p, await signedPendingUrl(p)] as const)
      );
      if (cancelled) return;
      setUrls(Object.fromEntries(entries.filter(([, u]) => u) as [string, string][]));
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the path list
  }, [key]);

  if (all.length === 0) {
    return <p className="text-sm text-ink-500">ما أرسلوا صور.</p>;
  }
  if (loading) {
    return <p className="text-sm text-ink-500">نجهّز الصور…</p>;
  }

  const toggle = (p: string) =>
    onSelected(selected.includes(p) ? selected.filter((x) => x !== p) : [...selected, p]);

  return (
    <div className="space-y-4">
      {logoPath && (
        <div>
          <p className="mb-2 text-xs font-semibold text-ink-500">الشعار</p>
          <div className="flex items-center gap-3">
            <span className="grid size-20 place-items-center overflow-hidden rounded-2xl border border-line bg-sand-100">
              {urls[logoPath] ? (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL
                <img src={urls[logoPath]} alt="" className="size-full object-contain" />
              ) : (
                <span className="text-2xs text-ink-500">تعذّر</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => onLogoApproved(!logoApproved)}
              aria-pressed={logoApproved}
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition ${
                logoApproved
                  ? "bg-palm-600 text-white"
                  : "border border-line-control bg-white text-ink-600 hover:border-palm-400"
              }`}
            >
              {logoApproved ? <IconCheck className="size-4" /> : <IconClose className="size-4" />}
              {logoApproved ? "معتمد" : "غير معتمد"}
            </button>
          </div>
        </div>
      )}

      {imagePaths.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-ink-500">
              الصور — اختر اللي ينشر ({selected.length}/{imagePaths.length})
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onSelected(imagePaths)}
                className="min-h-11 rounded-xl px-3 text-xs font-semibold text-sea-700 transition hover:underline"
              >
                اعتمد الكل
              </button>
              <button
                type="button"
                onClick={() => onSelected([])}
                className="min-h-11 rounded-xl px-3 text-xs font-semibold text-ink-500 transition hover:underline"
              >
                لا شي
              </button>
            </div>
          </div>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {imagePaths.map((p) => {
              const on = selected.includes(p);
              return (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    aria-pressed={on}
                    className={`relative block aspect-square w-full overflow-hidden rounded-xl border-2 transition ${
                      on ? "border-palm-600" : "border-line opacity-60 hover:opacity-100"
                    }`}
                  >
                    {urls[p] ? (
                      // eslint-disable-next-line @next/next/no-img-element -- signed URL
                      <img src={urls[p]} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center text-2xs text-ink-500">
                        تعذّر
                      </span>
                    )}
                    <span
                      className={`absolute end-1 top-1 grid size-6 place-items-center rounded-full ${
                        on ? "bg-palm-600 text-white" : "bg-white/85 text-ink-500"
                      }`}
                    >
                      <IconCheck className="size-3.5" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
