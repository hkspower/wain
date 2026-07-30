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
    return { ...BLANK, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }
  } catch {
    return { ...BLANK }
  }
}

export const remembering = () => localStorage.getItem(REMEMBER_KEY) !== '0'

export function saveDelivery(form, remember) {
  localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0')
  if (remember) localStorage.setItem(STORE_KEY, JSON.stringify(form))
  else localStorage.removeItem(STORE_KEY)
}

export const forgetDelivery = () => localStorage.removeItem(STORE_KEY)

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
