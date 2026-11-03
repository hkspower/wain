// Page builder, local server and in-page measurements shared by sizes-admin-test.mjs (and the fixture generator).
// name -> [sidebar label, optional first "Add ..." button to click for the editor modal]
export const STATES = [
  ['overview', 'Overview'], ['orders', 'Orders'], ['catalogue', 'Catalogue'], ['brands', 'Brands'], ['slides', 'Slides'], ['topbar', 'Topbar'],
  ['promotions', 'Promotions'], ['discounts', 'Discounts'], ['inventory', 'Inventory'], ['payments', 'Payments'], ['checkout', 'Checkout'],
  ['settings', 'Settings'], ['activity', 'Activity'],
  ['catalogue-form', 'Catalogue', /^\s*Add a product\s*$/], ['brands-form', 'Brands', /^\s*Add\b[^\n]{0,30}$/], ['discounts-form', 'Discounts', /^\s*(Add|New)\b[^\n]{0,30}$/], ['slides-form', 'Slides', /^\s*Add a slide\s*$/],
]

