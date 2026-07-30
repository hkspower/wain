// The message the logistics company actually reads.
//
// Plain JavaScript, not TypeScript, on purpose: Deno runs it as the Edge
// Function's renderer and Node runs it in scripts/fulfilment-email-test.mjs
// with no build step and no toolchain. An email nobody can test is an email
// nobody knows is broken.
//
// WHO IS READING THIS. Not a customer — a picker on a warehouse floor, on a
// phone, with a trolley, working through a stack of these. Every decision below
// follows from that:
//
//   * the subject line carries the whole answer, because it is often all that
//     gets read: order number, whether to ship, how many items, which area
//   * COLLECT CASH is the loudest thing on the page when it is true. Handing
//     over goods and forgetting to take the money is a straight loss, and it is
//     the one mistake this email exists to prevent
//   * sizes and cuts are in a column of their own, not appended to the product
//     name, because "Cloudsoft Jacket — Army Green L oversize" read at speed
//     picks the wrong garment
//   * Arabic and English together. The picker may read either; the driver reads
//     the address, and Kuwaiti addresses are spoken in Arabic
//   * plain text alongside HTML, because warehouse mail clients are not
//     Gmail and a picking list that renders as tag soup is a phone call

const GOVERNORATE = {
  capital: { en: 'Capital', ar: 'العاصمة' },
  hawalli: { en: 'Hawalli', ar: 'حولي' },
  farwaniya: { en: 'Farwaniya', ar: 'الفروانية' },
  'mubarak-al-kabeer': { en: 'Mubarak Al-Kabeer', ar: 'مبارك الكبير' },
  ahmadi: { en: 'Ahmadi', ar: 'الأحمدي' },
  jahra: { en: 'Jahra', ar: 'الجهراء' },
}

const FIT = {
  normal: { en: 'Normal', ar: 'عادي' },
  slim: { en: 'Slim', ar: 'ضيق' },
  loose: { en: 'Loose', ar: 'واسع' },
  oversize: { en: 'Oversize', ar: 'أوفرسايز' },
  boxy: { en: 'Boxy', ar: 'بوكسي' },
  tank: { en: 'Tank', ar: 'حمالات' },
}

const PAY = {
  knet: 'KNET',
  tpay: 'T-Pay (CBK)',
  cod: 'Cash on delivery',
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const kwd = (n) => `KWD ${Number(n ?? 0).toFixed(3)}`

// "Block 4, Street 12, Building 5, Floor 3, Flat 7 — Salmiya, Hawalli"
// Empty parts vanish rather than printing "Floor -", which on a house makes the
// address look truncated.
export function addressText(a = {}) {
  const gov = GOVERNORATE[a.governorate]?.en ?? a.governorate ?? ''
  const parts = [
    a.block && `Block ${a.block}`,
    a.street && `Street ${a.street}`,
    a.building && `Building ${a.building}`,
    a.floor && `Floor ${a.floor}`,
    a.flat && `Flat ${a.flat}`,
  ].filter(Boolean)
  const where = [a.area, gov].filter(Boolean).join(', ')
  return [parts.join(', '), where].filter(Boolean).join(' — ')
}

const itemCount = (items = []) => items.reduce((n, i) => n + (i.qty ?? 0), 0)

// The subject is the message. A picker scanning an inbox decides from this line
// alone whether the order can be packed now.
export function subjectFor(kind, p) {
  const area = p?.address?.area ? ` · ${p.address.area}` : ''
  if (kind === 'payment') {
    return p.payment_status === 'paid'
      ? `[SPORTA] ${p.track_id} · PAYMENT CONFIRMED — ship it`
      : `[SPORTA] ${p.track_id} · PAYMENT FAILED — do not ship`
  }
  const state = p.collect_cash
    ? 'COLLECT CASH'
    : p.payment_status === 'paid'
      ? 'PAID'
      : 'AWAITING PAYMENT — hold'
  return `[SPORTA] ${p.track_id} · ${state} · ${itemCount(p.items)} item(s)${area}`
}

function itemsTable(items = []) {
  const rows = items
    .map((i) => {
      const opts = [i.size, i.fit ? FIT[i.fit]?.en ?? i.fit : null].filter(Boolean).join(' · ')
      return `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:700;font-size:18px;text-align:center">${esc(i.qty)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb">
          <div style="font-weight:600">${esc(i.name_en)}</div>
          <div style="color:#475569;font-size:13px" dir="rtl">${esc(i.name_ar)}</div>
          <div style="color:#64748b;font-size:12px">${esc(i.sku)}</div>
        </td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;font-weight:700;white-space:nowrap">${esc(opts || '—')}</td>
      </tr>`
    })
    .join('')
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:8px">
    <thead><tr style="background:#f1f5f9">
      <th style="padding:8px 10px;text-align:center;font-size:12px;text-transform:uppercase;letter-spacing:.04em">Qty</th>
      <th style="padding:8px 10px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em">Item</th>
      <th style="padding:8px 10px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em">Size / Fit</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`
}

function itemsText(items = []) {
  return items
    .map((i) => {
      const opts = [i.size, i.fit ? FIT[i.fit]?.en ?? i.fit : null].filter(Boolean).join(' · ')
      return `  ${i.qty} x  ${i.name_en}${opts ? `  [${opts}]` : ''}\n        ${i.sku}`
    })
    .join('\n')
}

export function renderMessage(kind, p) {
  const subject = subjectFor(kind, p)

  // The payment follow-up is deliberately tiny. It exists to answer one
  // question — ship it or do not — and a second full picking list would be
  // read as a second order.
  if (kind === 'payment') {
    const paid = p.payment_status === 'paid'
    const line = paid
      ? 'Payment confirmed. This order can be shipped.'
      : 'Payment FAILED or was abandoned. Do NOT ship this order.'
    const lineAr = paid
      ? 'تم تأكيد الدفع. يمكن شحن هذا الطلب.'
      : 'فشل الدفع أو تم التخلي عنه. لا تشحن هذا الطلب.'
    const text = `${subject}\n\n${line}\n${lineAr}\n\nOrder: ${p.track_id}\nCustomer: ${p.customer?.name} (+${p.customer?.phone})\nTotal: ${kwd(p.amount_kwd)}\n`
    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:640px">
      <div style="background:${paid ? '#14532d' : '#7f1d1d'};color:#fff;padding:16px 20px;border-radius:12px">
        <div style="font-size:13px;opacity:.85;letter-spacing:.08em;text-transform:uppercase">Order ${esc(p.track_id)}</div>
        <div style="font-size:20px;font-weight:800;margin-top:4px">${esc(line)}</div>
        <div style="font-size:16px;margin-top:2px" dir="rtl">${esc(lineAr)}</div>
      </div>
      <p style="color:#334155;font-size:14px">Customer: <b>${esc(p.customer?.name)}</b> · +${esc(p.customer?.phone)}<br>Total: <b>${esc(kwd(p.amount_kwd))}</b></p>
    </div>`
    return { subject, html, text }
  }

  const cash = !!p.collect_cash
  const hold = !cash && p.payment_status !== 'paid'
  const addr = addressText(p.address)
  const govAr = GOVERNORATE[p.address?.governorate]?.ar ?? ''

  const banner = cash
    ? {
        bg: '#7c2d12',
        title: `COLLECT ${kwd(p.amount_kwd)} IN CASH ON DELIVERY`,
        ar: `حصّل ${kwd(p.amount_kwd)} نقداً عند التسليم`,
      }
    : hold
      ? {
          bg: '#7f1d1d',
          title: 'AWAITING PAYMENT — do not ship yet',
          ar: 'بانتظار الدفع — لا تشحن بعد',
        }
      : { bg: '#14532d', title: 'PAID — ready to ship', ar: 'مدفوع — جاهز للشحن' }

  const text =
    `${subject}\n\n` +
    `${banner.title}\n${banner.ar}\n\n` +
    `ORDER      ${p.track_id}\n` +
    `PLACED     ${p.placed_at}\n` +
    `PAYMENT    ${PAY[p.payment_method] ?? p.payment_method} — ${p.payment_status}\n` +
    `TOTAL      ${kwd(p.amount_kwd)}\n\n` +
    `DELIVER TO\n` +
    `  ${p.customer?.name}\n` +
    `  +${p.customer?.phone}\n` +
    `  ${addr}\n` +
    (p.address?.note ? `  Note: ${p.address.note}\n` : '') +
    `\nPACK\n${itemsText(p.items)}\n`

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;color:#0f172a">
    <div style="background:${banner.bg};color:#fff;padding:16px 20px;border-radius:12px">
      <div style="font-size:13px;opacity:.85;letter-spacing:.08em;text-transform:uppercase">Sporta — order ${esc(p.track_id)}</div>
      <div style="font-size:20px;font-weight:800;margin-top:4px">${esc(banner.title)}</div>
      <div style="font-size:16px;margin-top:2px" dir="rtl">${esc(banner.ar)}</div>
    </div>

    <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#475569;margin:20px 0 6px">Deliver to</h2>
    <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px">
      <div style="font-weight:700;font-size:16px">${esc(p.customer?.name)}</div>
      <div dir="ltr" style="font-weight:600">+${esc(p.customer?.phone)}</div>
      <div style="margin-top:6px;color:#334155">${esc(addr)}</div>
      ${govAr ? `<div style="color:#475569;font-size:13px" dir="rtl">${esc(p.address?.area)}، ${esc(govAr)}</div>` : ''}
      ${p.address?.note ? `<div style="margin-top:8px;padding:8px 10px;background:#fef3c7;border-radius:8px;font-size:13px"><b>Note:</b> ${esc(p.address.note)}</div>` : ''}
    </div>

    <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:#475569;margin:20px 0 6px">Pack</h2>
    ${itemsTable(p.items)}

    <p style="color:#64748b;font-size:12px;margin-top:20px">
      ${esc(PAY[p.payment_method] ?? p.payment_method)} · ${esc(p.payment_status)} · total ${esc(kwd(p.amount_kwd))} · placed ${esc(p.placed_at)}
    </p>
  </div>`

  return { subject, html, text }
}
