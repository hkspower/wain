# /backends scan, 2026-11-18 (read-only, live)

Owner: "scan backends". Two read-only jobs on the VPS against https://www.sporta.com.kw (nothing signs in, every POST of the
icon walk is answered by a local mock; scratch projects deleted afterwards):

1. `node scripts/vps-deploy.mjs compose --scan backends` (`scripts/admin-scan.mjs`), commit `9e83c146`.
2. `scripts/admin-icon-scan.mjs` (desktop English and phone Arabic walks of the compiled admin on its mocked API).

## 1. Load, locked, hidden, in step: SCAN_DONE bad=0 warn=1

- **Loads:** /backends 200; starts the same app as index.html; 59 scripts and stylesheets reachable and on disk; both lazy admin
  chunks (AdminApp 48 kB, AdminPasscode 6 kB) 200 and immutable; manifest, icon and offline page 200.
- **Shut to strangers:** admin.php serves 98 routes, 10 before the sign-in wall (login, MFA code, passcode, logout, me, forced
  password change, forgot and reset password, Google availability); signed out, **all 88 protected routes answer 401
  `not_signed_in`**, no trace or server path in any answer; every sign-in step refuses a request without `X-Sporta-Admin`.
- **Hidden:** API `no-store`, /backends noindex, not framable, robots.txt disallows it, /admin, /backends/, /wp-admin,
  /administrator all 404.
- **Screens and server agree:** all 18 `?r=` routes written into the bundle are served; 92 of 98 routes are called by the live
  screens; 5 exist only in this repo's admin (the live build has no screen for them): `xbrl_export`, `ahed_cost`, `set_stock`,
  `blocked`, `unblock_customer`. The sign-in screen handles the MFA step and the forced password change.
- **WARN (1, known):** no screen calls `returns_policy` (the returns window and switches have a route, and no live admin screen to edit
  them).

## 2. Icons of the admin (493 on 17 desktop screens, 184 on the phone)

- The admin uses the same set (`sporta-icon`) at **one size, 17 x 17 px** in the sidebar and rows; 16 / 18 / 20 px appear only in
  buttons and forms; stroke width is uniform (0 findings), **every icon-only control has a name (0), no decorative icon is
  announced (0), none is empty or mismatched (0)**.
- **ICON-COLOUR (456 desktop, 168 phone) is mostly the scanner, not the page:** each line reads "colour X on X is 1:1": the
  scanner takes the icon's own colour as the ground (the sidebar's ground is a dark fill it does not see). The pairs
  themselves are fine (#acb8c4 and #64748b on the dark sidebar). Not counted as defects.
- **Real, small:** on the phone, one 16 x 28 px glyph (a span, not an svg) is not square and sits 9.5 px above its text line on
  every screen (ICON-SIZE 55, ICON-ALIGN 44 findings are that one element repeated); on the desktop CRM and form rows an icon sits
  4.7 px below its line (20 lines). 3 ICON-CLIP and 3 ICON-SPILL (info): 5 sidebar icons lie past the end of the sidebar's own
  scroll area, reachable by scrolling.
- **Off-palette rust #B8430F** on the phone icons (the old brick-red step). This release's colour change moves it to the dark orange
  step #B34D00 (the token), so the finding goes with the deploy.
- **Inventory and Payments could not be reached by the mock** (the live build gates them), so the icon walk did not cover those two.

## Colours of the admin: an owner decision

The admin shell is the slate + indigo system the owner asked for, with one exception: its primary buttons and focus rings use the
brown-red **#9A452C** (`--admin-action`, 35 uses in `sporta-admin-knet.css`, 4 in `sporta-ui-colours.css`) and the bundle's
rose scale for errors. The storefront's no-red change (COLOURS-1118) does not touch them. If "remove red color" should reach
/backends too, the admin action colour would become the logo orange with near-black text, and the rose errors the dark orange step.
Not changed: it is the screen the owner works in every day.
