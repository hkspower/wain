# /backends full scan, 2026-11-25

Read-only scan of the LIVE admin at https://www.sporta.com.kw/backends. The scan answered every admin API call in the browser with made-up data. Nothing signed in and nothing was submitted. The scan changed nothing on the live site or in the repository. This file is the only thing written.

Counts below are merged findings: one entry per screen and cause, listing every lane it appeared in. Info items (things that passed, or context) are listed at the end and are not counted.

## 1. Scope

| Lane | Width and theme | Language | Notes |
|---|---|---|---|
| mobile-320 | 320 x 568, light | Arabic page (dir rtl, lang ar) | One run. No 320 dark run exists. |
| mobile-390-light | 390 x 844, light | Arabic page | |
| mobile-390-dark | 390 x 844, dark | Arabic page | |
| tablet-768 | 768 x 1024, light | Arabic page | No dark run. |
| desktop-1280 | 1280, route check | n/a | Server routes vs screens only. |
| style-icons | Desktop and phone | Arabic and English | Desktop width is not stated in the raw files. |
| text-alignment | 1280 and 390, light | Arabic and English | Dark is hard-coded off in the script. |
| payments | 390, 768, 1280 light; 390 dark | Arabic page | KNET and T-Pay forms. |
| save-safe-quiet | Phone portrait and landscape, with and without insets | Arabic page | Safe-area checks. |
| menu-probe | 1280 and 390 | Arabic page | Menu press timing. |

Lanes not run: none. The date of the scan is 2026-11-25.

## 2. Headline

Merged findings: 7 high, 20 medium, 19 low.

The three things that matter most:

1. The ADMIN LIVE DATA chip sits over the bottom tab bar and hides its buttons, and other fixed bars hide focused fields on phones (H5, H6).
2. The Inventory editor table and the Returns screen are wider than a 320 to 390 px screen, so text and actions are cut off (H1, H4).
3. Dark-theme admin text is below contrast in many places, and some headings are nearly invisible (M7, M8).

The Brands page end (H3) is a high finding, but the scroll container was not confirmed. Check reachability before fixing it.

## 3. Findings, high first

### HIGH

**H1. Returns screen is clipped at phone widths.**
- Lanes: mobile-320, mobile-390-light.
- At 320 px: three buttons with no visible label are 425 px wide inside the content column. Status badges measure 74 px and 145 px. Reference text measures 240 px and 391 px. Customer name and date spans measure 240 px and 391 px. All are cut off by `main.admin-content.flex-1`.
- At 390 px: three buttons 425 px wide. Badges 116 px and 145 px (these are widths, not overflow past the edge). Two reference labels and one Arabic name at 391 px. All cut off by the same column.
- Source: `mobile-320-admin-mobile-scan.txt` lines 13 to 16 (320). The 390 light lane output, evidence `CLIPPED x3 button ... [Returns]`, `CLIPPED x2 span.admin-returns__badge`, `CLIPPED x2 small`, `CLIPPED x1 span` (not line-numbered in the input).

**H2. Payments (KNET) form text is clipped on phones; one input is unidentified.**
- Lanes: mobile-320, payments (390, 768).
- At 320 px: the monospace result-page URL (279 px) and the bold helper line about it (279 px) are cut off by `main.admin-content.flex-1`.
- At 390 and 768 px: the scan lists `input.mt-1` as clipped. It does not say which input or which value. It needs a manual look. The `span.sr-only` entries are by design.
- At 1280 px: only the hidden `span.sr-only` is listed.
- Source: `mobile-320-admin-mobile-scan.txt` lines 17 and 18. `payments-admin-payments-scan.mjs.txt` lines 5, 10, 15.

**H3. Brands page: the last control sits under the fixed bottom bar.**
- Lanes: mobile-320, mobile-390-light, tablet-768.
- At 320 px: last control bottom at 886 px, tab bar top at 508 px, so 378 px under the bar.
- At 390 px: control bottom 1214 px, bar top 784 px, so 430 px under the bar.
- At 768 px: control bottom 1607 px, bar top 964 px, so 643 px under the bar. (The 768 Brands/form reading of 245 px was seen in one run only and was not reproduced, so it is not counted.)
- Verifier note: after scrolling the window to its end, the 320 control's bottom stayed at 886 px. The window may not be the scroller. Reachability is not proven. Confirm the real scroll container before fixing.
- Source: `mobile-320-admin-mobile-scan.txt` line 26. The 390 light and 768 lane outputs, evidence `OBSCURED-END`.

**H4. Inventory editor: the stock table is wider than the phone screen.**
- Lanes: mobile-320, mobile-390-light, mobile-390-dark. At 768 the table fits (695 px in a 735 px body).
- At 320 px: the table is 561 px in a 288 px box. It scrolls sideways with no scroll hint. The actions column is off-screen until scrolled. The first column is not sticky. 121 fields run past the right edge (one input ends 59 px beyond). One field sits 214 px past the edge.
- At 390 px (light): the table is 561 px in a 358 px box. 120 inputs run 8 px past the right edge. One field sits 144 px past the edge (left 27, right -144).
- At 390 px (dark): the table is 561 px wide and scrolls.
- Verifier note: the field counts may be inside the horizontal scroll box, so this may be one cause (the table width) and not three defects.
- Source: `mobile-320-admin-mobile-scan.txt` lines 20, 28, 30. The 390 light evidence `FIELD-PAST-EDGE x1 120 field(s)` and `FIELD-GUTTER x1`. The 390 dark evidence `MODAL ... Inventory ... pw 561`. The 768 `TABLE-FITS` evidence.

**H5. ADMIN LIVE DATA chip sits on the bottom tab bar and hides its buttons.**
- Lanes: mobile-320, mobile-390-light, mobile-390-dark, tablet-768.
- The chip is 52 px tall, fixed at the bottom corner (bottom 0.75rem, inline end, z-index 40). It covers the right side of the 60 px tab bar.
- Focused tab buttons hidden under it: Orders and Stock (the chip), Home (under the chip's inner button). Measured on keyboard focus. Taps on the covered part of the bar were not tested, but the same area is covered.
- Counts per lane: 320: 62 under the chip and 20 under its inner button. 390 light: 38 and 19, plus 3 chip text items. 390 dark: 37 and 19, plus 3 chip text items. 768: 12 under the chip and 15 under its inner button.
- The scan's "mid-screen" label for this chip is wrong. The chip is at the bottom corner, 12 px above the bar's bottom edge.
- Source: `mobile-320-admin-mobile-scan.txt` line 49 (FIXED sal-chip) and lines 62 and 63 (FOCUS). 390 light and dark FOCUS evidence. 768 FOCUS evidence. Chip CSS: `public/sporta-admin-brands.js` line 22204 (per the verifier).

**H6. Other fixed bars hide focused fields and buttons.**
- Lanes: mobile-320, mobile-390-light, mobile-390-dark, tablet-768.
- 320 px: textarea and Save checkout button under a fixed layer on Checkout, Theme and SEO (8 events). "Add sizes" button and an input under a fixed layer on Inventory, Payments and Checkout (6). Input or photo button under the tab bar on Brands, Inventory and Checkout (3). Topbar input under a span (1). Inventory stock-filter select under a sporta icon (1).
- 390 px light: field under Save checkout on Payments, Checkout and SEO (3). Topbar input under a span (1). Theme select under a div (1). Settings input under the tab bar (1). On SEO, Tab reaches a textarea at y 807, inside the tab bar band (1).
- 390 px dark: the same pattern (Payments, Checkout, SEO: 3; Topbar 1; Theme 1; Settings 1; SEO textarea 1).
- 768 px: Catalogue summary and Inventory search under the tab bar (3). Save buttons on Payments, Checkout and SEO (3). Returns button under a sporta icon (1). Support row under the tab bar (1). Topbar input under a span (1).
- Source: `mobile-320-admin-mobile-scan.txt` lines 65 to 71. The 390 light and dark FOCUS evidence. The 768 FOCUS evidence.

**H7. Brand URL is cut off with an ellipsis and has no full-text title.**
- Lane: mobile-320 only.
- A monospace `/brand/...` link is 137 px wide in a 125 px box. It is truncated and has no title, so the full text cannot be read on screen. The scan's high severity is kept as given.
- Source: `mobile-320-admin-mobile-scan.txt` line 44.

### MEDIUM

**M1. Slides and Discounts editors: the save button is below the fold.**
- Lanes: mobile-320, mobile-390-light, mobile-390-dark.
- At 320 px: save bottoms at 1901 px (Slides) and 1345 px (Discounts) on a 568 px screen.
- At 390 px: save bottoms at 1572 px and 1256 px on an 844 px screen.
- "Not sticky" is the scan's own assumption and was not measured.
- Source: `mobile-320-admin-mobile-scan.txt` lines 7 to 8 and 24. 390 light MODAL evidence. 390 dark MODAL evidence.

**M2. Light theme: form field borders are under 3:1 on white.**
- Lanes: mobile-320, mobile-390-light, tablet-768.
- Real readings from border colour maths: Inventory inputs #9ca3af at 2.54:1 (120 stock and 60 cost fields, plus one select). Settings #94a3b8 at 2.56:1. CRM form #aeb8c2 at 2.01:1. Topbar #cbd5e1 at 1.48:1 (inputs and textareas). Orders #d9dfe5 at 1.34:1.
- Not counted: 1:1 readings on borders that are printed as dark (#18212a, #aeb8c2 on Theme). The verifier judged them probable scan artifacts. Check by eye.
- Source: `mobile-320-admin-mobile-scan.txt` lines 32 to 41. 390 light FIELD-EDGE evidence. 768 FIELD-EDGE evidence.

**M3. Dark theme: form field borders are under 3:1 or invisible.**
- Lane: mobile-390-dark.
- Slides and Discounts inputs 2.16:1 (14). Brands inputs 2.16:1 (4). Topbar 2.29:1 (3). CRM form 2.29:1 (2). Theme selects 1.19:1 (4) and inputs 1.19:1 (3). Returns and CRM 1.18:1 (3). Inventory inputs 1:1, border the same colour as the field, so invisible (12).
- Source: 390 dark FIELD-EDGE evidence.

**M4. Focus indicator is colour-only, or missing.**
- Lanes: mobile-320, mobile-390-light, mobile-390-dark, tablet-768.
- Colour change only, no outline and no ring (measured as outline width 0 and no box shadow; a border-colour change was not checked): 320 px: 11 search inputs on CRM, Support, Profiles and Inventory. 390 px light: 11 inputs. 390 px dark: 14 inputs, 13 sort/toggle buttons, 13 Brands checkboxes, 5 checkboxes, 3 colour pickers, 3 hex fields, 2 summaries, 2 Slides checkboxes, 2 SEO links, 1 Slides range, 1 Checkout input, 1 Checkout save, 1 Theme checkbox.
- No indicator at all: Returns reference input (320, 390 light, 390 dark, 768). Settings input (768).
- Source: `mobile-320-admin-mobile-scan.txt` lines 64 and 69. 390 light, 390 dark and 768 FOCUS evidence.

**M5. Brand mark: white "S" on orange is 3.63:1.**
- Lanes: mobile-320, mobile-390-light, mobile-390-dark, tablet-768, desktop-1280 (18.6 px bold, same ratio), phone and desktop style-icons.
- The mark is a logotype letter, which WCAG 1.4.3 exempts. Confirm it is a logotype before changing it. Changing the brand orange is an owner decision (see CLAUDE.md, one orange and one darker step).
- Source: `mobile-320-admin-mobile-scan.txt` line 73. Style-icons `S L61`, `E L62` (desktop), `E L236`, `S L233` (phone).

**M6. Support status pills: grey text on pale amber is 4.26:1.**
- Lanes: mobile-320, mobile-390-light, mobile-390-dark (light pills on the dark screen), tablet-768 (11.7 px), style-icons phone.
- Colour #64748b on #fff1d6, under 4.5:1.
- Source: `mobile-320-admin-mobile-scan.txt` line 74. 390 light CONTRAST evidence. 768 CONTRAST evidence. Style-icons `E L237`, `S L234`.

**M7. Dark theme: grey and brown text is under 4.5:1 on dark surfaces.**
- Lane: mobile-390-dark.
- Largest groups: Inventory labels #64748b on #151b21, 3.65:1 (960 instances). Inventory metric values #475569 on #151b21, 2.29:1 (840). Good-stock values #b34d00, 3.29:1 (120).
- Brown #9a452c on #37251e, 2.26:1: Catalogue "in sync" badges (64) and "On sale" badges (58), Inventory counts and "In stock" labels (24), totals (8), Returns badges (3), SEO tabs (2).
- Other: CRM labels 3.64:1 (12), CRM kicker #b34d00 3.56:1 (2), due filter #475569 2.48:1 (2), Returns codes and names #475569 2.29:1 (12), Profiles e-mail and address lines 3.65:1 (6), Topbar labels 2.29:1 (4), "Required" #be123c 2.76:1 (2), SEO links 2.69:1 (2).
- The admin's brown #9a452c is an owner decision (CLAUDE.md: the admin keeps its own colours). The fix for dark mode is a dark-theme token, not a change to the light theme.
- Source: 390 dark CONTRAST evidence lines (each group).

**M8. Dark theme: headings and a button are nearly invisible.**
- Lane: mobile-390-dark.
- Section headings #172033 on #151b21, 1.07:1 (12 instances on Support and Profiles). Support Refresh button #172033 on #0d1217, 1.16:1.
- Source: 390 dark CONTRAST evidence `12 14px strong headings` and `1 Support Refresh button`.

**M9. Inventory editor stays light in dark theme.**
- Lane: mobile-390-dark.
- Dialog #ffffff (358 x 776), four table header cells #ffffff, and a 136 x 44 select #ffffff. The dark theme is not applied to this dialog.
- Source: 390 dark LIGHT-IN-DARK evidence.

**M10. Admin text under 12px on some screens (tablet and desktop).**
- Lanes: tablet-768, style-icons (desktop and phone).
- At 768 px: Returns badges 11.6 px (6). Support ticket references and status labels 11.7 px (12). Support header note 11.7 px. Profiles subtitle 11.7 px. Inventory live-status line 11.7 px. Topbar segmented labels 11.7 px (2). Theme headings and font-upload note 11.7 px.
- Desktop: Support status labels 11.84 px at weight 800 (6).
- Conflict: the text-alignment lane found no admin text under 12 px at 1280 or 390. The 768 measurements stand for tablet. Re-measure at 768 before fixing.
- Source: 768 TINY evidence. Style-icons `S L52`, `E L52` (desktop).

**M11. View on site links are 18 px tall (81 px wide).**
- Lanes: mobile-320, mobile-390-light, tablet-768 (height 18 px).
- Six "View on site" links on Brands and Brands/form, against 44 px.
- Source: `mobile-320-admin-mobile-scan.txt` line 85. 390 light and 768 TAP evidence.

**M12. SEO language buttons and links are too small to tap.**
- Lanes: mobile-320, mobile-390-light, tablet-768.
- AR and EN buttons 34 px wide (35 px at 768). "View sitemap" and "View robots.txt" links 18 px tall (18 px at 768).
- Source: `mobile-320-admin-mobile-scan.txt` lines 87 and 88. 390 light and 768 TAP evidence.

**M13. Catalogue size chips are narrow.**
- Lanes: mobile-320, mobile-390-light, tablet-768.
- Chips are 39 px and 43 px wide at 320 and 390 (height 44 px is met). At 768 only the S chip is narrow (40 px; the M chip is 44 px).
- Source: `mobile-320-admin-mobile-scan.txt` line 86. 390 light TAP evidence. 768 TAP evidence.

**M14. Theme "Upload a self-hosted font" label is under 44 px tall.**
- Lanes: mobile-390-light (42 px), tablet-768 (43 px).
- Source: 390 light TAP evidence. 768 TAP evidence.

**M15. Slides "Choose a photo" button is 26 x 81 px (re-measure first).**
- Lane: mobile-320.
- The scan prints width then height, so this is 26 px wide and 81 px tall. A full-width button 26 px wide is unusual. Re-measure before acting.
- Source: `mobile-320-admin-mobile-scan.txt` line 90.

**M16. Support ticket references are 21 px tall on desktop.**
- Lane: style-icons (desktop).
- Source: style-icons `S L36`, `E L36` (desktop section).

**M17. Two desktop boxes are wider than their container.**
- Lane: style-icons (desktop).
- Inventory table is 1027 px in a 1018 px wrapper, so it scrolls sideways by 11 px. The 1366 px viewport in one note is not in any raw file. The Brands editor header is 4 px wider than its box.
- Source: style-icons `S L110`, `E L111` (Inventory). `S L113`, `E L114` (Brands/form).

**M18. KNET form controls are under 44 px.**
- Lane: payments (768 and 1280 px).
- At 768: two controls at 40 px (one button, one input). At 1280: two buttons at 40 and 41 px and one input at 40 px. At 390 px the scan reports none.
- Source: `payments-admin-payments-scan.mjs.txt` line 10 (768) and line 15 (1280).

**M19. Orange icons may sit on an orange ground (1:1 readings).**
- Lanes: style-icons (desktop, both languages; phone).
- Icon fill #ff7b17 on #ff7b17 at 1:1 on Overview, Brands and Brands/form. Stroke #ff7b17 on #ff7b17 at 1:1 on 22 desktop screens. If the readings are real, the orange line icons are invisible on orange chips. The verifier did not confirm it. Check by eye first.
- Source: style-icons ICON-COLOUR evidence (desktop-en, desktop-ar).

**M20. Theme swatches: glyph text is 2.2 to 2.51:1.**
- Lanes: style-icons (desktop and phone), Theme screen.
- Text #18212a on swatches #99452b (2.51:1), #a43b1a (2.5:1), #914718 (2.42:1), #83451f (2.2:1). The first value was recomputed by hand.
- Source: style-icons `E L460` to `L463` (desktop-en), `E L677` to `L681` (phone-en), desktop-ar output.

### LOW

**L1. Five editor dialogs have no role=dialog or aria-modal.**
- Catalogue, Brands, Slides, Discounts, Inventory. Lanes: mobile-320, mobile-390-light, tablet-768.
- Source: `mobile-320-admin-mobile-scan.txt` line 22.

**L2. The page behind four open dialogs still scrolls.**
- Brands, Slides, Discounts, Inventory. Body overflow stays visible. Not tested by scrolling. Lanes: mobile-320, mobile-390-light, tablet-768.
- Source: `mobile-320-admin-mobile-scan.txt` line 23.

**L3. Long editor dialogs scroll, and one has no visible close or save.**
- Catalogue is 3617 to 3623 px tall (390 light and dark, 768 at 3017 px). Slides is 1563 px and Discounts 1247 px (390). The Inventory editor table is 4286 to 7132 px tall. At 768 the probe found no close or save button in it, so reachability is unverified.
- Source: 390 light, 390 dark and 768 MODAL evidence.

**L4. The admin declares lang=ar and dir=rtl, but most labels are English.**
- Lanes: mobile-320, mobile-390-light, tablet-768.
- The scan's "every label is English" is a fixed string in its script. One Arabic control label was seen (Edit product). Treat the claim as partly unverified.
- Source: `mobile-320-admin-mobile-scan.txt` line 11. 390 light and 768 LANG evidence.

**L5. Sticky bars take a large share of a phone screen.**
- Lanes: mobile-320, mobile-390-light.
- Catalogue footer 98 px at 320 (17%) and 121 px at 390 (14%). Brand editor action bar 126 px at 320 (22%). Brand editor header 71 to 87 px. Checkout action bar 70 px.
- Source: `mobile-320-admin-mobile-scan.txt` lines 55 and 58. 390 light FIXED evidence.

**L6. Hidden "Switch KNET" label reads 1.57:1 (regraded from medium).**
- Lanes: payments (390, 768, 1280, light and dark). The element is `span.sr-only`, so it is not drawn. Regraded because it is hidden, as the scan itself notes.
- Source: `payments-admin-payments-scan.mjs.txt` lines 21 and 26. `payments-admin-payments-light-scan.mjs.txt` lines 24 to 25, 54 to 55, 84 to 85.

**L7. Payments dark device paints three buttons dark (contradicts the owner's rule).**
- Lane: payments (390, dark device). The three buttons paint rgb(51, 65, 85): a flex-1 button, the KNET switch track, and a full-width button. CLAUDE.md says Payments must show its light look in every dark state. The light device also reports three dark surfaces, but their identity is not printed. Worth a re-check before the next Payments change.
- Source: `payments-admin-payments-light-scan.mjs.txt` lines 26 to 28 and 3 to 4.

**L8. Phone menu: the Close control ends above the viewport after the list is scrolled.**
- Lane: save-safe-quiet (portrait with insets, landscape with insets, no insets). After scrolling to the end, Close sits at y -179 to -135 (portrait), y -644 to -599 (landscape) and y -145 to -101 (no insets). Whether it returns on scroll-up is inferred, not measured.
- Source: `save-safe-quiet-admin-safe-area-scan.txt` lines 2, 4 and 6.

**L9. Icon sizes and shapes are off the scale.**
- Phone header icon box is 14 x 28 (not square) on 25 screens. Theme phone icon is 14 x 28, beside 26 px button icons. Topbar preview icons are 92 x 69 (desktop) and 89 x 67 (phone). Payment logos are 53 x 36 and 50 x 34. Brand editor icons are 20 and 16 px beside 17 px button icons. Slides icons are 21 px beside 17 px button icons.
- Source: style-icons `B phone-ar Overview`, `R desktop-ar Topbar`, `B phone-ar Topbar`, `R desktop-ar Payments`, `B phone-ar Payments`, `B desktop-ar Brands/form`, `R desktop-ar Slides/form`, `B phone-ar Theme`.

**L10. Icons sit off the centre of their text line.**
- Phone header icons -9.5 px on about 25 screens. SEO icon +31.5 px on phone (largest). Theme preview icons +10 to +20 px. Payments logo +13 px. Brand editor icons -16.5 to +7 px. CRM icons +4.7 px.
- Source: style-icons ICON-ALIGN evidence (desktop-ar, phone-ar, desktop-en, phone-en).

**L11. Profiles phone column is numbers but left-aligned.**
- Lane: style-icons (desktop). Source: style-icons `E L153`, `S L152`.

**L12. Colours outside the slate and indigo palette the scan checks.**
- Admin KPI figures and primary buttons use #9a452c (141 desktop and 199 phone). Icon chips use #ff7b17 (desktop) and #b34d00 (phone). Nav border #ff7c18. Support text #9a5600 (4). Topbar and theme previews #c76a42 (4). Theme swatch #99452b. Borders #d8a38b (5 desktop, 6 phone).
- This is a palette question for the owner, not a defect. The admin's own colours are an owner decision (CLAUDE.md).
- Source: style-icons COLOUR evidence (desktop and phone).

**L13. Four admin.php routes have no screen in the live admin.**
- Routes photo_list, photo_rename, photo_delete and returns_policy are called by no live screen. Four more (xbrl_export, set_stock, blocked, unblock_customer) exist in this repo's admin only. These are backend routes, outside the three files in section 5.
- Source: `desktop-1280-admin-scan.txt` lines 62 and 63.

**L14. CRM press timing is not measured.**
- At 1280 and 390 px the CRM press was reported as a full page load of 1 and 2 ms. The value does not measure the load. Re-measure if it matters.
- Source: `menu-probe-admin-menu-probe.mjs.txt` line 5. `menu-probe-admin-menu-probe.mjs-w390.txt` line 5.

**L15. Catalogue "Choose photos" file input is 1 px wide.**
- Lanes: mobile-320, mobile-390-light, tablet-768. The input is probably visually hidden, and its label is the real tap target. Probably a false positive. Confirm the label is the target.
- Source: `mobile-320-admin-mobile-scan.txt` line 89.

**L16. Light-in-dark surfaces: Topbar and Theme previews.**
- Lane: mobile-390-dark. Three Topbar icons stay white (89 x 67). Two Theme font specimen boxes stay light. The Topbar device frame and mock page stay light. Probably a deliberate light storefront preview. The owner should confirm.
- Source: 390 dark LIGHT-IN-DARK evidence.

**L17. Icon colour readings of 1:1 are likely background-read artifacts.**
- Stroke #acb8c4 on 25 desktop screens (the scan's own sidebar read gives #13181e, where #acb8c4 is about 8.8:1). Stroke and fill #556274, #64748b, #1e293b, #65717d on phone screens, and #b34d00 on the phone tab bar. Check by eye.
- Source: style-icons ICON-COLOUR evidence (desktop-en, desktop-ar, phone-ar, phone-en).

**L18. Most admin labels are under 14 px (design scale, not a defect by itself).**
- At 1280 px: 1,826 text nodes outside tables are under 14 px, 1,442 under 13 px, and none under 12 px. At 390 px: 1,294 nodes under 14 px, 924 under 13 px, none under 12 px.
- Source: text-alignment measurement summary (under-threshold counts and size histograms).

**L19. Storefront previews inside the Theme and Topbar editors: small text and clipped icons (kept as designed).**
- Text: Topbar 8.96 to 9.1 px, Theme 10.24 to 11.84 px, SEO preview 11.52 px. Icons: Topbar preview icons sit 64 to 67 px outside the mock page, which hides overflow. The coverage note says the storefront previews keep their own sizes on purpose. This is listed for awareness only.
- Source: `mobile-320-admin-mobile-scan.txt` lines 77 to 83. 390 light TINY evidence. 768 TINY evidence. Style-icons `R desktop-ar Topbar` (ICON-CLIP 67 px), `B phone-ar Topbar` (64 px).

## 4. Corrections made while writing this report

- The chip (H5) is at the bottom corner over the tab bar. The scan called it "mid-screen".
- The Payments sr-only Switch KNET label is regraded from medium to low (L6), because it is hidden.
- The Topbar and Theme preview text and icons are regraded from medium to low (L19), because the coverage note says the previews keep their own sizes.
- Catalogue size chips at 768 px: only S (40 px) is narrow; M is 44 px (M13).
- The 1:1 border readings on dark-printed borders are probable artifacts and are not counted (M2).
- Returns badges at 145 px and 116 px are widths, not overflow past the screen edge. They are counted under H1 as clipped by the column, as the raw attributes them.
- The LANG finding is reduced to low (L4). The "every label is English" part is a fixed string in the script.
- The Brands/Form obscured-end reading at 768 px (245 px) was not reproduced and is not counted (H3).
- Slides and Discounts "not sticky" (M1) is the scan's assumption, not a measurement.
- The text-alignment lane and the 768 lane disagree on whether admin text reaches 11.x px (M10).

## 5. Coverage and what the scans cannot see

- No 320 px dark pass and no 768 px dark pass were run. The mobile script supports SCHEME=dark for both.
- Seven GET routes were not mocked (abandoned_orders, content, variants_create, payment_status, site_icon, passcode_info, assistant_settings; payment_alerts in one run). The Payments, SEO, site-content and Inventory sizes screens may show a different state than a real admin with data.
- Mock data sets the text widths. Real product names, order counts and photos will change them.
- The add-on CSS provenance is not fully confirmed. The text-alignment lane read the add-ons from the repo and from a live-addons folder. Of 14 files, 12 equal git HEAD. sporta-product-fix.css and sporta-shadows.css match neither HEAD nor the sizes CLAUDE.md records for 2026-11-20. So the folder cannot be shown to be a capture of the live site.
- Chromium only. No real phone, Safari or Firefox.
- Dark Payments is light by owner decision (CLAUDE.md). The only dark finding there is L7.
- Storefront previews inside the editors keep their own sizes on purpose (L19).
- Visually hidden (sr-only) text is excluded from the visual checks.

### Passed (info, not counted)

- Mobile menu: 23 controls, all at least 44 px. It scrolls. Focus stays inside it for 31 Tab presses. Escape closes it. Same at 320, 390 and 768.
- Page direction and language are set (rtl, ar) on every lane. The viewport meta includes viewport-fit=cover.
- Safe area: the tab bar clears the home indicator, no tab label sits under it, and the header clears the notch.
- No page JavaScript errors on any lane.
- Payments: no sideways page scroll at 390, 768 or 1280 px. The T-Pay form is 0x0 (hidden by the add-on, as CLAUDE.md says).
- Icons: 564 on desktop and 189 on phone. No unnamed icon-only control, no empty icon, no label mismatch.
- Product names: 560 checked on desktop and on phone, none cut off.
- Press timing: the slowest press (Abandoned orders, 1280 px) shows its screen after 121 ms, with one 116 ms task. Other presses are 7 to 13 ms.
- Add-on alignment checks on the 17 states (0 sideways overflow, 0 ltr/rtl differences, 0 off-centre modals, 0 table mismatches).
- Sticky headers, tab bars, table headers and sidebar overflow are listed by the scans as info only.

## 6. Proposed fixes, grouped by file

Proposals only. Nothing has been applied.

### public/sporta-admin-knet.css (admin CSS add-on, every admin screen)

- H1: Returns cards. Let buttons and badges wrap. Give the content column min-width 0 and allow long text to break under 480 px. Read the Returns layout in the admin source first.
- H2: Payments result-page URL and helper line: overflow-wrap anywhere. KNET controls min-height 2.75rem (M18).
- H3: Brands screen: add bottom padding that clears the 60 px tab bar plus the safe area on phones. First confirm which element scrolls.
- H4: Inventory editor: under 600 px show stock rows as stacked cards, or give the table a visible scroll cue and a sticky first column. Inputs at least 44 px. The markup is in `public/sporta-admin-brands.js` (ADMIN INVENTORY EDITOR block).
- H6: Scroll padding for focused fields: reserve bottom space for sticky save bars and the tab bar (scroll-margin-bottom on phones).
- M2 and M3: admin input borders to at least 3:1 on both themes, after checking the 1:1 readings by eye.
- M4: :focus-visible outline (2 to 3 px) on admin inputs, selects, checkboxes and the Returns input. Remove colour-only focus.
- M5: owner decision on the logotype (keep, or change the mark's ground).
- M6: darken Support status text until it reads 4.5:1.
- M7 and M8: dark-theme tokens for the grey and brown text and for the #172033 headings. Keep the Payments light rule.
- M10: floor admin font sizes at 12 px on Support, Returns badges, Inventory status, Profiles and Theme headings (after re-measuring at 768).
- M11, M12, M13, M14: tap targets at least 44 px (View on site links, SEO language buttons and links, catalogue size chips, Theme upload label).
- M17: Inventory table wrapper and Brands editor header: max-width 100% and box-sizing.
- M19: if the orange-on-orange reading is real, use dark or white ink inside orange chips.
- M20: Theme swatch glyph ink chosen per swatch for at least 4.5:1.
- L5: sticky footers and action bars: reduce height on phones where the layout allows.
- L7: extend Section 9 (light only) to the three dark Payments buttons.
- L8: keep the sheet's Close control inside the visible area (sticky top in the panel).
- L9 and L10: square the phone header icon box, and set icon sizes to one scale. Align icons to the text centre.
- L11: right-align numeric columns (Profiles).
- L15: confirm the file input's label is the tap target, then leave it.
- L17: check the 1:1 icon readings by eye before changing any icon colour.

### public/sporta-admin-brands.js (admin blocks)

- H5: move the ADMIN LIVE DATA chip above the tab bar (bottom offset equal to the bar height plus the safe area), or fold it into the header. Chip CSS is around line 22204.
- H4: markup for the Inventory editor (stacked rows under 600 px, sticky first column, scroll hint). Coordinate with the CSS in sporta-admin-knet.css.
- H7: add a title attribute to the truncated Brands URL, and allow it to wrap.
- L1: set role="dialog" and aria-modal="true" on the five editor dialogs (Catalogue, Brands, Slides, Discounts, Inventory).
- L2: lock body scroll while an editor dialog is open.
- L3: give the Inventory editor a visible close and save at the top (reachability first).
- M9: dark-theme colours for the Inventory editor dialog, header cells and select.
- L16: owner to confirm whether the Topbar and Theme preview surfaces stay light.
- L19: the preview icons that spill 64 to 67 px outside the mock page (only if the owner wants them contained; the preview text stays as designed).

### public/sporta-features.js (storefront add-ons)

- No finding in this scan. The scan covered the admin only. Storefront previews are inside the admin editors and are listed under sporta-admin-brands.js and L19.

### Outside the three files (for the owner or a backend change)

- L4: the html lang and dir set by the compiled admin and boot.js. Owner decision on whether the admin language follows the UI.
- L13: admin.php routes with no screen (photo_list, photo_rename, photo_delete, returns_policy). Remove or keep as a decision.
- L12 and M5: the admin's own brown and orange colours are an owner decision (see BACKENDS-SCAN-2026-11-18.md).

## 7. How to re-run

Each script's own header gives the environment variables. Read the header before running. Scripts marked "VPS" must run on the VPS in the Playwright image, because the sandbox cannot reach www.sporta.com.kw. Do not run them on the live server from the sandbox. Delete any scratch project created on the VPS afterwards.

- mobile-320 (light): `VW=320 VH=568 SCHEME=light node scripts/admin-mobile-scan.mjs` (VPS). Dark: `SCHEME=dark`. Header: lines 3 to 4.
- mobile-390-light: `VW=390 VH=844 SCHEME=light node scripts/admin-mobile-scan.mjs` (VPS).
- mobile-390-dark: `VW=390 VH=844 SCHEME=dark node scripts/admin-mobile-scan.mjs` (VPS).
- tablet-768: `VW=768 VH=1024 SCHEME=light node scripts/admin-mobile-scan.mjs` (VPS). Dark: `SCHEME=dark`.
- desktop-1280 (route check): `node scripts/vps-deploy.mjs compose --scan backends` (runs `scripts/admin-scan.mjs`, per its header).
- style-icons: `scripts/admin-style-scan.mjs` (VPS, Playwright image; `npm i playwright@1.49.0`). Its header gives the base URL and the `--css` option.
- text-alignment: `node scripts/admin-text-size-scan.mjs` (runs locally against the fixtures; reads the add-ons from addons-src/).
- payments: `node scripts/admin-payments-scan.mjs` (MODE=tree, default at 390). `MODE=measure` checks 390, 768 and 1280. `MODE=colors SCHEME=dark W=390` gives contrast. Light and dark device comparison: `node scripts/admin-payments-light-scan.mjs` (W=390 for another width; default 1280).
- save-safe-quiet: `node scripts/admin-safe-area-scan.mjs` (VPS; BASEURL and CHROMIUM_PATH optional).
- menu-probe: `SPORTA_LIVE_CAPTURE=<dir> node scripts/admin-menu-probe.mjs`, with `PROBE_WIDTH=390` for the phone width. It is a probe, not a gate.

Raw outputs of this run are in `/tmp/claude-0/-home-user-wain/a128f64c-8c94-5bf5-b35a-38b83867e084/scratchpad` (files named `mobile-320-admin-mobile-scan.txt`, `desktop-1280-admin-scan.txt`, `payments-admin-payments-scan.mjs.txt`, `payments-admin-payments-light-scan.mjs.txt`, `save-safe-quiet-admin-safe-area-scan.txt`, `menu-probe-admin-menu-probe.mjs.txt`, `menu-probe-admin-menu-probe.mjs-w390.txt`).
