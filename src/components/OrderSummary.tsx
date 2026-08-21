"use client";

import Link from "next/link";
import { IconGo, IconPhone } from "@/components/icons";
import { getPlace, toArabicDigits } from "@/lib/places";
import { formatKwd, lineTotal, type OrderLine } from "@/lib/orders";

/**
 * What is in the order, and where to go and get it.
 *
 * Both of these were missing. The confirmation said only «رقم طلبك ٣F٢B١C» and
 * «طلباتي» showed a total — neither told anyone what they had actually ordered,
 * even though the tracker was already fetching the lines and throwing them
 * away. And an order you collect in person is the one kind of order that needs
 * directions and a phone number, which appeared on neither screen.
 *
 * Shared by both so they cannot drift apart, and so «الدفع عند الاستلام» is
 * written once.
 */

export function OrderLines({ lines, totalFils }: { lines: OrderLine[]; totalFils: number }) {
  if (lines.length === 0) return null;
  return (
    <div className="mt-4 rounded-2xl bg-sand-100 p-3">
      <ul className="divide-y divide-line">
        {lines.map((l) => (
          <li key={l.id} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
            <span className="min-w-0 text-ink-800">
              <span className="font-semibold">{l.nameAr}</span>
              {l.qty > 1 && (
                <span className="ms-1.5 text-ink-500">×{toArabicDigits(l.qty)}</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums text-ink-600">{formatKwd(lineTotal(l))}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-1.5">
        <span className="text-sm font-semibold text-ink-700">المجموع التقريبي</span>
        <span className="font-display text-base font-bold text-ink-900">{formatKwd(totalFils)}</span>
      </div>
    </div>
  );
}

/**
 * How to get there and how to reach them.
 *
 * The slug is looked up in the build-time snapshot rather than stored on the
 * order: a business that changes its phone number should not leave every
 * order ever placed pointing at the old one.
 */
export function CollectionDetails({ slug }: { slug: string }) {
  const place = getPlace(slug);
  if (!place) return null;

  const directions = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <a
        href={directions}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line-control bg-white px-3 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
      >
        <IconGo className="size-4 text-sea-600" />
        الطريق للمكان
      </a>
      {place.phone && (
        <a
          href={`tel:${place.phone.replace(/\s/g, "")}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line-control bg-white px-3 text-sm font-semibold text-ink-700 transition hover:border-sea-300"
        >
          <IconPhone className="size-4 text-palm-600" />
          اتصل فيهم
        </a>
      )}
      <Link
        href={`/places/${slug}/`}
        className="inline-flex min-h-11 items-center gap-1 px-2 text-sm text-ink-500 transition hover:text-sea-700"
      >
        صفحة المكان
      </Link>
    </div>
  );
}
