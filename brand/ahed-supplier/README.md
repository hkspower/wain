# AHED supplier imagery — reference only, NOT ready to ship

These are the 13 pictures embedded in the `Picture` column of AHED Trading's
proforma invoice (`To_Sportakw.xlsx`, 2025-05-24), extracted losslessly and
saved as JPEG.

**Nothing in `/brand/` is uploaded.** Anything in `sporta-web/public/` ships;
this folder is the working set the shipped files are cut from. That rule is why
`logo-original.png` was moved out of `public/` — it sat there unreferenced at
522 kB, a third of the whole uploadable package.

## Why they cannot be used as-is

Every one of them is a screenshot of the supplier's own storefront, so each
carries burnt-in furniture that has no business on sporta.com.kw:

- a red **"SAVE 13%"** / **"SAVE 7%"** promotional badge, top-left;
- several are contact sheets — two to six separate garments in one image, not
  one product per file;
- the visible logo on the garments is **AHED**, not Sporta.

Cropping a single garment out, above the badge, gives a usable product photo.
Uploading one unedited puts another shop's discount claim on our product page.

## What each file is

The filename is the row it was anchored to in the invoice's `List` sheet, which
is the only record of what it shows — the supplier did not caption them. Row
numbers are 1-indexed, exactly as the spreadsheet displays them, so
`row12-sculpt-taupe.jpg` sat on the Sculpt / Taupe-Brown line.

Anchors are approximate: a picture that spans several rows reports only the row
its top-left corner touches, and three of these landed on a continuation line
(9, 17, 29) rather than the line naming a colour. **Check the image before
trusting the name**, and rename it once you have. A wrong photo on a product is
worse than the placeholder that is there now.

## What is still missing

Real Sporta-branded photography. These are stand-ins good enough to see the
garment, the cut and the true colour — which is more than the gradient
placeholders currently on the site — but the AHED wordmark is visible in most of
them, so they are a stopgap, not the answer.
