"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toArabicDigits } from "@/lib/place-kit";
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

/**
 * A pill, and for a while it had nowhere to be.
 *
 * These started as two `<li>`s in the footer's links column, moved to the
 * navbar — an order being prepared and a turn in a queue are both live and
 * both time-sensitive, and the footer is the last place anyone looks for
 * either — and were then stranded when the navbar was removed, leaving
 * /orders and /queue reachable only by typing an address. `LiveTray` below
 * is where they live now.
 */
const PILL =
  "flex min-h-6 items-center gap-1.5 whitespace-nowrap rounded-full bg-sea-50 px-3 py-1.5 text-sm font-semibold text-sea-800 shadow-sm ring-1 ring-sea-100 transition hover:bg-sea-100";
const BADGE = "rounded-full bg-sea-100 px-1.5 py-0.5 text-xs font-semibold text-sea-800";

export function QueueLink() {
  const count = useTicketCount();
  if (count === 0) return null;

  return (
    <Link href="/queue" className={PILL}>
      دوري
      <span className={BADGE}>{toArabicDigits(count)}</span>
    </Link>
  );
}

export default function OrdersLink() {
  const count = useOrderCount();
  if (count === 0) return null;

  return (
    <Link href="/orders" className={PILL}>
      طلباتي
      <span className={BADGE}>{toArabicDigits(count)}</span>
    </Link>
  );
}

/**
 * The way back to a live order or a live turn, for a browser.
 *
 * Removing the navbar took both pills with it, and /orders and /queue became
 * address-bar-only on the web: the only links left were AppTabBar's, and that
 * bar is `standalone:block`, so outside the installed app it is in the DOM and
 * painted by nothing. Nobody could reach that state — 0 of 52 places take an
 * order or a turn — which is exactly why it could sit broken unnoticed.
 *
 * This is deliberately not a bar coming back. It renders **nothing** unless
 * this device has a live order or today's ticket, so for every visitor there
 * is no element at all; a top bar is permanent and this is the opposite of
 * permanent. It sits at the bottom rather than the top for the same reason,
 * and `standalone:hidden` because the installed app already grows a tab for
 * each of these — two offers for one thing is the mistake the call button's
 * own placement was chosen to avoid.
 *
 * It rides the bottom rail in layout.tsx, which is what makes it survive the
 * scroll a live order wants to survive. The rail owns the fixed positioning
 * and the safe area; this used to own both, and had to give them up so the
 * search button could share the row — two separately-positioned floating
 * controls can be measured 10px apart on a 320px screen, which is inside the
 * 24px clearance `audit:mobile` requires between targets. In one flex row
 * they cannot collide at all.
 */
export function LiveTray() {
  const orders = useOrderCount();
  const tickets = useTicketCount();
  if (orders === 0 && tickets === 0) return null;

  return (
    // Not `aria-live`: this is navigation that appeared, not an announcement
    // to interrupt a reader with. The count inside each pill is the message.
    <nav
      aria-label="طلباتك الحالية"
      className="pointer-events-auto flex items-center gap-2 rounded-full bg-white/95 p-1 shadow-lg ring-1 ring-line backdrop-blur"
    >
      <OrdersLink />
      <QueueLink />
    </nav>
  );
}
