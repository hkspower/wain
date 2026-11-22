// The Sporta icon set's catalogue: every glyph in brand/iconset/*.svg, in the group it is shown under on the preview page.
// Pure data, no imports, so the preview (build-iconset.mjs) and the library suite (icon-library-test.mjs) share ONE list.
// A new glyph is a source file in brand/iconset AND one line here; the suite fails when the two disagree.
// Where a glyph is USED (the storefront's ICON SET section, the admin's ADMINICONS section) is decided by the rule lists in
// build-iconset.mjs and lib/admin-iconset-rules.mjs, not here: an icon in the set but not yet on a page is normal.

export const CATEGORIES = [
  'Shopping',
  'Orders & delivery',
  'Account & security',
  'Status & help',
  'Navigation & interface',
  'Media',
  'Data & admin',
  'Contact & help',
]

export const CATEGORY_OF = {
  // shopping
  bag: 'Shopping', cart: 'Shopping', 'cart-x': 'Shopping', gift: 'Shopping', heart: 'Shopping', 'heart-filled': 'Shopping',
  megaphone: 'Shopping', minus: 'Shopping', percent: 'Shopping', plus: 'Shopping', ruler: 'Shopping', shirt: 'Shopping',
  star: 'Shopping', store: 'Shopping', tag: 'Shopping', ticket: 'Shopping',
  // orders and delivery
  box: 'Orders & delivery', calendar: 'Orders & delivery', card: 'Orders & delivery', cash: 'Orders & delivery',
  clock: 'Orders & delivery', 'map-pin': 'Orders & delivery', receipt: 'Orders & delivery', returns: 'Orders & delivery',
  truck: 'Orders & delivery',
  // account and security
  eye: 'Account & security', 'eye-off': 'Account & security', key: 'Account & security', lock: 'Account & security',
  logout: 'Account & security', shield: 'Account & security', user: 'Account & security', users: 'Account & security',
  // status and help
  alert: 'Status & help', bell: 'Status & help', check: 'Status & help', 'check-circle': 'Status & help', close: 'Status & help',
  help: 'Status & help', info: 'Status & help', 'wifi-off': 'Status & help', 'x-circle': 'Status & help',
  // navigation and interface
  'arrow-down': 'Navigation & interface', 'arrow-left': 'Navigation & interface', 'arrow-right': 'Navigation & interface',
  'arrow-up': 'Navigation & interface', 'arrow-up-right': 'Navigation & interface', 'chevron-down': 'Navigation & interface',
  'chevron-left': 'Navigation & interface', 'chevron-right': 'Navigation & interface', 'chevron-up': 'Navigation & interface',
  expand: 'Navigation & interface', 'external-link': 'Navigation & interface', globe: 'Navigation & interface',
  grid: 'Navigation & interface', home: 'Navigation & interface', menu: 'Navigation & interface', more: 'Navigation & interface',
  moon: 'Navigation & interface', refresh: 'Navigation & interface', search: 'Navigation & interface',
  sliders: 'Navigation & interface', sun: 'Navigation & interface',
  // media
  camera: 'Media', folder: 'Media', image: 'Media', pause: 'Media', play: 'Media', zoom: 'Media',
  // data and admin
  activity: 'Data & admin', barcode: 'Data & admin', chart: 'Data & admin', copy: 'Data & admin', database: 'Data & admin',
  download: 'Data & admin', edit: 'Data & admin', 'file-text': 'Data & admin', filter: 'Data & admin', grip: 'Data & admin',
  list: 'Data & admin', sort: 'Data & admin', trash: 'Data & admin', trend: 'Data & admin', upload: 'Data & admin',
  // contact and help
  assistant: 'Contact & help', chat: 'Contact & help', envelope: 'Contact & help', instagram: 'Contact & help',
  link: 'Contact & help', mic: 'Contact & help', phone: 'Contact & help', send: 'Contact & help', share: 'Contact & help',
  tiktok: 'Contact & help', whatsapp: 'Contact & help',
}
