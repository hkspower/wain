"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconCheck, IconClock, IconClose, IconGo } from "@/components/icons";
import { CollectionDetails, OrderLines } from "@/components/OrderSummary";
import { haptic } from "@/lib/haptics";
import { HOURS_COUNT, MINUTES_COUNT, countAr, toArabicDigits } from "@/lib/place-kit";
import { usePoll } from "@/lib/usePoll";
import { backendEnabled } from "@/lib/backend";
import {
  cancelOrder,
  cancelOrderMessage,
  fetchOrderState,
  forgetOrder,
  formatKwd,
  isTerminalStatus,
  listOrders,
  markCancelledByMe,
  timeAr,
  whatsappOrderUrl,
  type OrderState,
  type OrderStateResult,
  type OrderStatus,
  type TrackedOrder,
} from "@/lib/orders";

/**
 * طلباتي — the orders this device has placed, and where each one is up to.
 *
 * No account and no login: the device keeps each order's id and token, and
 * those two together are the only thing that can read the order back. Clearing
 * the browser's storage loses the list, which is the honest trade for not
 * asking anyone to sign up — so the reference is shown large enough to write
 * down, and the business can always find an order by it.
 *
 * Two kinds of card, by the order's channel (see orderChannel in orders.ts):
 *
 *   - **db**: the status is read from the database and drawn as three steps;
 *     cancelling is an RPC, offered only while the order is still «placed».
 *   - **whatsapp**: the order went to the shop as a message, and nothing here
 *     can read what the shop did with it — so the card says that, shows what
 *     the device remembers (the lines, the note), and its two actions are the
 *     thread itself: open it, or send the cancel sentence into it. No steps,
 *     no poll, and no «ما قدرنا نتأكد» line, because there was never a status
 *     to confirm.
 */

const STEPS: { id: OrderStatus; labelAr: string }[] = [
  { id: "placed", labelAr: "وصل الطلب" },
  { id: "ready", labelAr: "جاهز للاستلام" },
  { id: "collected", labelAr: "تسلّمته" },
];

const TONE: Record<OrderStatus, string> = {
  placed: "bg-sun-100 text-sun-900",
  ready: "bg-sea-50 text-sea-700",
  collected: "bg-palm-500/12 text-palm-700",
  cancelled: "bg-sand-200 text-ink-600",
};

const LABEL: Record<OrderStatus, string> = {
  placed: "بانتظار التجهيز",
  ready: "جاهز",
  collected: "تسلّمته",
  cancelled: "ملغي",
};

/** "من ٥ دقايق" — how long ago, in words, without a date library. */
function agoAr(iso: string | null | undefined): string {
  if (!iso) return "";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return "";
  if (mins < 1) return "الحين";
  // `mins <= 10 ? "دقايق" : "دقيقة"` looked like the 3–10 rule and was not:
  // it swept 1 and 2 in with it, so an order placed sixty seconds ago read
  // «من ١ دقايق». The hours line had the mirror-image bug — no 11+ case, so a
  // morning order read «من ١٣ ساعات» by the evening. countAr knows the rule.
  if (mins < 60) return `من ${countAr(mins, MINUTES_COUNT)}`;
  return `من ${countAr(Math.floor(mins / 60), HOURS_COUNT)}`;
}

/** A pre-order is a short errand, so a slow poll catches "ready" soon enough
 *  without keeping the radio busy. usePoll pauses it in a hidden tab and
 *  refreshes the moment the customer looks again. */
const POLL_MS = 45_000;

const ACTION =
  "inline-flex min-h-tap items-center gap-1 rounded-xl px-3 text-sm font-semibold text-ink-500 transition hover:text-coral-700 disabled:opacity-50";

function CardHead({ order, chip }: { order: TrackedOrder; chip: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-xl font-bold text-ink-900" dir="ltr">
            {order.reference}
          </span>
          {chip}
        </div>
        <Link
          href={`/places/${order.placeSlug}/`}
          className="group mt-1 inline-flex items-center gap-1 text-sm font-semibold text-ink-700 transition hover:text-sea-700"
        >
          {order.placeNameAr}
          <IconGo className="size-3.5 transition group-hover:-translate-x-0.5" />
        </Link>
      </div>
      <span className="flex items-center gap-1.5 rounded-full bg-sand-100 px-3 py-1.5 text-sm font-semibold text-ink-700">
        <IconClock className="size-4 text-sea-600" />
        {timeAr(order.pickupAt)}
      </span>
    </div>
  );
}

/** The order went to the shop as a WhatsApp message; the thread is the record. */
function WhatsAppCard({ order, onForget, onChange }: { order: TrackedOrder; onForget: () => void; onChange: () => void }) {
  const digits = order.whatsapp ?? "";
  const cancelled = !!order.cancelledAt;
  const thread = `https://wa.me/965${digits}`;
  const cancelUrl = whatsappOrderUrl(digits, cancelOrderMessage(order.reference));

  return (
    <li className="rounded-3xl border border-line bg-white p-4 sm:p-5 shadow-xs" data-order-card="whatsapp">
      <CardHead
        order={order}
        chip={
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              cancelled ? TONE.cancelled : "bg-palm-500/12 text-palm-700"
            }`}
          >
            {cancelled ? "طلبت إلغاءه" : "أرسلته عبر واتساب"}
          </span>
        }
      />

      <p className="mt-4 rounded-2xl bg-sand-100 p-3 text-sm font-semibold text-ink-600">
        {cancelled
          ? `طلبت الإلغاء عبر واتساب ${agoAr(order.cancelledAt)}. المكان يرد عليك هناك.`
          : "المكان يرد عليك بالواتساب — الحالة ما تنعرض هني."}
      </p>

      {order.lines?.length ? (
        <OrderLines lines={order.lines} totalFils={order.totalFils} />
      ) : (
        <p className="mt-4 text-sm text-ink-600">
          المجموع التقريبي{" "}
          <strong className="font-display text-base text-ink-900">{formatKwd(order.totalFils)}</strong>
        </p>
      )}
      {order.noteAr && <p className="mt-2 text-sm text-ink-600">ملاحظتك: {order.noteAr}</p>}

      {!cancelled && <CollectionDetails slug={order.placeSlug} />}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <span className="text-sm text-ink-500">الدفع عند الاستلام</span>
        <span className="flex flex-wrap items-center gap-1">
          {/* Anchors, not window.open: a tap on a link is never blocked, and
              the thread is where every answer about this order lives. */}
          <a
            href={thread}
            target="_blank"
            rel="noopener noreferrer"
            className={`${ACTION} text-palm-700 hover:text-palm-800`}
          >
            افتح المحادثة
          </a>
          {!cancelled && (
            <a
              href={cancelUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                if (!window.confirm(`تبي تلغي الطلب ${order.reference}؟ بنفتح لك واتساب برسالة الإلغاء.`)) {
                  e.preventDefault();
                  return;
                }
                // Marked as the customer's own cancellation the moment the
                // thread opens: nothing on this side can see whether the shop
                // agreed, so the card says «طلبت» and not «ألغي».
                markCancelledByMe(order.id);
                haptic("success");
                onChange();
              }}
              className={ACTION}
            >
              <IconClose className="size-4" />
              ألغِ عبر واتساب
            </a>
          )}
          <button type="button" onClick={() => { forgetOrder(order.id); onForget(); }} className={ACTION}>
            احذفه من القائمة
          </button>
        </span>
      </div>
    </li>
  );
}

function DbCard({ order, onForget }: { order: TrackedOrder; onForget: () => void }) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [byMe, setByMe] = useState(!!order.cancelledByMe);

  const { value, settled, failures, refresh } = usePoll<OrderStateResult>(
    (signal) => fetchOrderState(order.id, order.token, signal),
    {
      intervalMs: POLL_MS,
      enabled: backendEnabled,
      // Collected and cancelled never change again, so stop asking entirely
      // rather than re-reading the same row until the tab closes.
      isFinal: (r) => r.ok && !!r.state && isTerminalStatus(r.state.status),
    }
  );

  const state: OrderState | null = value?.ok ? value.state : null;
  // Not asking and asking without an answer come to the same thing for the
  // person reading the screen: we cannot tell them the status, and saying so
  // is better than a progress line they might read as confirmed.
  const unreachable =
    !backendEnabled || (settled && (failures > 0 || (!!value && !value.ok)));
  // Answered, and the order genuinely is not there — a different thing from
  // not being able to ask, and worth saying differently.
  const missing = !!value && value.ok && value.state === null;

  const status: OrderStatus = state?.status ?? "placed";
  const stepIndex = STEPS.findIndex((s) => s.id === status);
  const cancelled = status === "cancelled";

  async function cancel() {
    if (!window.confirm(`تبي تلغي الطلب ${order.reference}؟`)) return;
    setCancelError("");
    setCancelling(true);
    const result = await cancelOrder(order.id, order.token);
    setCancelling(false);
    haptic(result.ok ? "success" : "error");
    if (result.ok) {
      // The database knows the status; the device remembers WHO cancelled,
      // which the status alone cannot say. «ألغيت الطلب» for one's own act,
      // «المكان ألغى الطلب» for the shop's — the old card said the second
      // for both, and told a customer the shop had cancelled on them.
      markCancelledByMe(order.id);
      setByMe(true);
    }
    // Either way the truth is now on the server, so the card is repainted from
    // it rather than from what this function hoped happened.
    refresh();
    if (!result.ok) setCancelError(result.message);
  }

  return (
    <li className="rounded-3xl border border-line bg-white p-4 sm:p-5 shadow-xs" data-order-card="db">
      <CardHead
        order={order}
        chip={
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${TONE[status]}`}>
            {LABEL[status]}
          </span>
        }
      />

      {/* Progress — three steps, or one plain line if it was cancelled. */}
      {cancelled ? (
        <p className="mt-4 rounded-2xl bg-sand-100 p-3 text-sm font-semibold text-ink-600">
          {byMe ? "ألغيت الطلب" : "المكان ألغى الطلب"}
          {state?.cancelledAt ? ` ${agoAr(state.cancelledAt)}` : ""}.
          {byMe ? "" : " اتصل فيهم لو تبي تتأكد."}
        </p>
      ) : (
        <ol className="mt-4 flex items-center gap-1" aria-label="حالة الطلب">
          {STEPS.map((step, i) => {
            const done = i <= stepIndex;
            const at =
              step.id === "ready" ? state?.readyAt : step.id === "collected" ? state?.collectedAt : state?.createdAt;
            return (
              <li key={step.id} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="flex w-full items-center gap-1">
                  <span
                    aria-hidden="true"
                    className={`h-1 flex-1 rounded-full ${i === 0 ? "opacity-0" : done ? "bg-palm-500" : "bg-line"}`}
                  />
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-bold ${
                      done ? "bg-palm-500 text-white" : "border border-line-control bg-white text-ink-500"
                    }`}
                  >
                    {done ? <IconCheck className="size-3.5" /> : toArabicDigits(i + 1)}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`h-1 flex-1 rounded-full ${
                      i === STEPS.length - 1 ? "opacity-0" : i < stepIndex ? "bg-palm-500" : "bg-line"
                    }`}
                  />
                </span>
                <span className={`text-center text-2xs leading-tight ${done ? "font-semibold text-ink-800" : "text-ink-500"}`}>
                  {step.labelAr}
                  {done && at && <span className="block font-normal text-ink-500">{agoAr(at)}</span>}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {status === "ready" && (
        <p className="mt-4 rounded-2xl bg-sea-50 p-3 text-sm font-semibold text-sea-800" role="status">
          طلبك جاهز — قول رقم <span dir="ltr">{order.reference}</span> عند الاستلام، والدفع عندهم.
        </p>
      )}

      {/* What is actually in the order. These lines were being fetched and
          discarded, so the screen could tell you a total but not what it was
          the total of. */}
      {state?.lines?.length ? (
        <OrderLines lines={state.lines} totalFils={state.totalFils} />
      ) : (
        <p className="mt-4 text-sm text-ink-600">
          المجموع التقريبي{" "}
          <strong className="font-display text-base text-ink-900">
            {formatKwd(order.totalFils)}
          </strong>
        </p>
      )}

      {state?.noteAr && <p className="mt-2 text-sm text-ink-600">ملاحظتك: {state.noteAr}</p>}

      {!cancelled && <CollectionDetails slug={order.placeSlug} />}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <span className="text-sm text-ink-500">الدفع عند الاستلام</span>
        <span className="flex flex-wrap items-center gap-1">
          {/* Cancelling is only offered while it is still true. Once the
              business marks the order ready the food exists, and a button that
              quietly fails is worse than no button — that case sends them to
              the phone instead. */}
          {status === "placed" && (
            <button type="button" onClick={cancel} disabled={cancelling} className={ACTION}>
              <IconClose className="size-4" />
              {cancelling ? "نلغي…" : "ألغِ الطلب"}
            </button>
          )}
          <button type="button" onClick={() => { forgetOrder(order.id); onForget(); }} className={ACTION}>
            احذفه من القائمة
          </button>
        </span>
      </div>

      {cancelError && (
        <p className="mt-2 rounded-2xl bg-sun-50 p-3 text-sm font-semibold text-sun-900" role="alert">
          {cancelError}
        </p>
      )}

      {unreachable && (
        <p className="mt-2 text-xs text-ink-500">
          ما قدرنا نتأكد من الحالة الحين — الطلب محفوظ، وبنحدّثها أول ما يرجع الاتصال.
        </p>
      )}
      {missing && (
        <p className="mt-2 text-xs text-ink-500">
          ما لقينا هذا الطلب عند المكان. اتصل فيهم ومعك الرقم <span dir="ltr">{order.reference}</span>.
        </p>
      )}
    </li>
  );
}

export default function OrderTracker() {
  const [orders, setOrders] = useState<TrackedOrder[] | null>(null);

  // Read after mount: localStorage does not exist while this is prerendered,
  // and rendering an empty list on the server would flash "no orders" at
  // somebody who has one.
  useEffect(() => setOrders(listOrders()), []);

  if (orders === null) return null;

  if (orders.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-line-strong bg-sand-100 py-14 text-center">
        <p className="font-display text-lg font-semibold text-ink-900">ما عندك طلبات</p>
        <p className="mt-1 text-sm text-ink-500">
          لمّا تطلب مقدّماً من مكان، تلقاه هني وتتابع حالته.
        </p>
        <Link
          href="/explore"
          className="mt-5 inline-flex min-h-tap items-center rounded-xl bg-ink-900 px-5 text-sm font-semibold text-white transition hover:bg-ink-800"
        >
          تصفّح الأماكن
        </Link>
      </div>
    );
  }

  const reload = () => setOrders(listOrders());
  return (
    <ul className="space-y-4">
      {orders.map((o) =>
        // Entries written before WhatsApp mode existed carry no channel and
        // were all database orders.
        (o.channel ?? "db") === "whatsapp" ? (
          <WhatsAppCard key={o.id} order={o} onForget={reload} onChange={reload} />
        ) : (
          <DbCard key={o.id} order={o} onForget={reload} />
        )
      )}
    </ul>
  );
}
