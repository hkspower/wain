import { governorate, normalisePhone } from './kuwait'

// The saved delivery details, and whether they are complete enough to order
// with. Lives here rather than inside Checkout because two screens now read it:
// the full form, and the quick checkout that exists precisely to skip the form.

export const BLANK = {
  name: '', phone: '', governorate: '', area: '',
  block: '', street: '', building: '', floor: '', flat: '', note: '',
}

const STORE_KEY = 'sporta.delivery'
// The opt-out is stored separately from the details themselves. Deriving it
// from "are there saved details?" meant it defaulted to off for every
// first-time shopper, so nothing was ever saved and the feature could never
// switch itself on; and unticking it erased the details, losing the choice
// along with them. An explicit '0' is a decision worth keeping.
const REMEMBER_KEY = 'sporta.delivery.remember'

export function loadDelivery() {
  try {
    return persistableDelivery({ ...BLANK, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') })
  } catch {
    return { ...BLANK }
  }
}

export const remembering = () => localStorage.getItem(REMEMBER_KEY) !== '0'

// The optional "Share my location" line the checkout writes at the end of the delivery note. It is NEVER saved
// with "Remember these details": a later visit goes to the quick checkout, which prints and submits the saved note,
// so an old pin would ride on the next order (home, then office: the driver is sent to the wrong place) and the
// coordinates would stay on a shared device. public/sporta-gov-autopick.js applies the same rule to the live
// (compiled) storefront with the same pattern; scripts/checkout-location-test.mjs keeps the two in step.
export const LOCATION_MAPS = 'https://www.google.com/maps?q='
export const LOCATION_LINE_SRC = '(Location|الموقع): https:\\/\\/www\\.google\\.com\\/maps\\?q=(-?\\d{1,3}\\.\\d{1,6}),(-?\\d{1,3}\\.\\d{1,6})'

// Removes every location line plus ONE separator next to it (the space before it, or after it when it opens the
// note). Nothing else in the customer's text is touched.
export function stripLocation(v) {
  const re = new RegExp(LOCATION_LINE_SRC, 'g')
  let out = ''
  let pos = 0
  let m
  while ((m = re.exec(v))) {
    let s = m.index
    let e = s + m[0].length
    if (s > 0 && /\s/.test(v.charAt(s - 1))) s -= 1
    else if (s === 0 && e < v.length && /\s/.test(v.charAt(e))) e += 1
    if (s < pos) s = pos
    out += v.slice(pos, s)
    pos = e
  }
  return out + v.slice(pos)
}

// The form as it is stored: the same object with the location line taken out of the note. Pure.
export function persistableDelivery(form) {
  if (!form || typeof form.note !== 'string') return form
  const note = stripLocation(form.note)
  return note === form.note ? form : { ...form, note }
}

export function saveDelivery(form, remember) {
  localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0')
  if (remember) localStorage.setItem(STORE_KEY, JSON.stringify(persistableDelivery(form)))
  else localStorage.removeItem(STORE_KEY)
}

// The same rules create_order enforces. Repeated in the browser only so the
// shopper is told immediately instead of after a round trip — the copy that
// actually protects the order is the one in the migration, because a browser
// can be bypassed and the database cannot.
export function validateDelivery(f) {
  const e = {}
  if ((f.name ?? '').trim().length < 2) e.name = 'missing_name'
  if (!normalisePhone(f.phone)) e.phone = 'invalid_phone'
  if (!governorate(f.governorate)) e.governorate = 'invalid_governorate'
  if ((f.area ?? '').trim().length < 2) e.area = 'missing_area'
  if (!(f.block ?? '').trim()) e.block = 'missing_block'
  if (!(f.street ?? '').trim()) e.street = 'missing_street'
  if (!(f.building ?? '').trim()) e.building = 'missing_building'
  return e
}

// Complete enough to place an order without asking anything else. This is the
// whole gate on quick checkout: if it is false the shopper sees the form, and
// they see it because something in it is genuinely missing.
export const canQuickCheckout = (f) => Object.keys(validateDelivery(f)).length === 0

// The address as the driver would read it, on one or two lines.
//
// Deliberately NOT the full field list: "Block 4, Street 12, Building 5" is how
// a Kuwaiti address is spoken, and printing empty floor and flat labels for a
// house makes the card look like an unfinished form rather than a confirmation.
export function addressLines(f, lang, t) {
  const gov = governorate(f.governorate)
  const bits = [
    `${t.checkout.block} ${f.block}`,
    `${t.checkout.street} ${f.street}`,
    `${t.checkout.building} ${f.building}`,
    f.floor ? `${t.checkout.floor} ${f.floor}` : null,
    f.flat ? `${t.checkout.flat} ${f.flat}` : null,
  ].filter(Boolean)
  return [
    [f.area, gov?.name?.[lang]].filter(Boolean).join(', '),
    bits.join(' · '),
  ].filter(Boolean)
}
