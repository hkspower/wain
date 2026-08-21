"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toArabicDigits } from "@/lib/places";
import { listOrders } from "@/lib/orders";
import { isFromToday, listTickets } from "@/lib/queue";

/**
 * The way back to «طلباتي».
 *
 * It appears only on a device that has actually placed an order. Everybody
 * else would be one tap from an empty page, and a permanent link to nothing is
 * worse than no link at all.
 *
 * The count is read after mount, never during render: localStorage does not
 * exist while this is prerendered, and the exported HTML is shared by every
 * visitor, so it must not depend on one device's orders.
 */
export function useOrderCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const read = () => setCount(listOrders().length);
    read();
    // Another tab placing an order should light this up here too.
    addEventListener("storage", read);
    return () => removeEventListener("storage", read);
  }, []);

  return count;
}

/**
 * Live queue tickets on this device.
 *
 * Only today's count: yesterday's number is meaningless — the salon restarted
 * at one this morning — so a link offering to show it would be a link to
 * nothing worth reading.
 */
export function useTicketCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const read = () => setCount(listTickets().filter((t) => isFromToday(t)).length);
    read();
    addEventListener("storage", read);
    return () => removeEventListener("storage", read);
  }, []);

  return count;
}

export function QueueLink() {
  const count = useTicketCount();
  if (count === 0) return null;

  return (
    <li>
      <Link
        href="/queue"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-500 transition hover:text-coral-700"
      >
        دوري
        <span className="rounded-full bg-sea-50 px-1.5 py-0.5 text-xs font-semibold text-sea-700">
          {toArabicDigits(count)}
        </span>
      </Link>
    </li>
  );
}

export default function OrdersLink() {
  const count = useOrderCount();
  if (count === 0) return null;

  return (
    <li>
      <Link
        href="/orders"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-ink-500 transition hover:text-coral-700"
      >
        طلباتي
        <span className="rounded-full bg-sea-50 px-1.5 py-0.5 text-xs font-semibold text-sea-700">
          {toArabicDigits(count)}
        </span>
      </Link>
    </li>
  );
}
