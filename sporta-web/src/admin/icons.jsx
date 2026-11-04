// Admin-only icons that the storefront's set (src/components/icons.jsx) does
// not have. That file belongs to the shop and every page imports it, so an icon
// only the admin needs is drawn here instead: same 24x24 stroke grid, same
// stroke width and caps, so the tab bar cannot tell them apart.

const Svg = ({ children, size = 20, stroke = 1.75, className = '', ...rest }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
    {...rest}
  >
    {children}
  </svg>
)

// Two people: customer profiles are accounts, plural.
export const IconUsers = (p) => (
  <Svg {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
)
