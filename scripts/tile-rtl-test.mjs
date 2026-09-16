/**
 * RETIRED, 2026-09-16 — the feature this tested is no longer visible.
 *
 * WHAT THIS FILE USED TO PROVE, and the reasoning is worth keeping even
 * though the check is not: the category tiles baked their copy into a
 * PHOTOGRAPH, on the reading side, so an Arabic frame needed the figure on
 * the left — and getting that wrong took two separate causes (the -rtl files
 * not existing, and the bundle naming only ONE tile as having an Arabic
 * frame at all) that had to be fixed together, verified by a preflight that
 * checks every candidate URL loads before swapping so a missing file leaves
 * today's picture rather than a blank tile, and proved to survive a
 * MutationObserver re-render rather than being undone by the very re-render
 * it was written to survive. All of that is still correct, and still in
 * assets/tile-art.js — nothing was deleted.
 *
 * WHY IT IS RETIRED RATHER THAN FIXED. The owner asked, on 2026-09-16, for
 * all four category tiles solid, square and full width. sporta-ui.css now
 * hides the tile artwork outright (`.cat-tile picture{display:none}`) and
 * paints a flat brand colour in its place — see the CSS's own comment and
 * scripts/tile-art-test.mjs, which took over this file's job of checking the
 * category tiles and now asserts the SOLID state instead. Measured before
 * writing this: with the picture hidden, the browser fetches NOTHING under
 * /cats/ for these four tiles — `loading="lazy"` on a display:none element
 * never becomes a candidate to load. There is no Arabic frame and no English
 * frame on screen to tell apart; asserting one against the other would be
 * asserting a property of a code path nothing exercises, which is the same
 * shape as a suite that finds "0 controls, 0 pressed" and reads it as a
 * passing shop rather than a dead sandbox.
 *
 * IF THE PHOTOGRAPHY EVER COMES BACK — remove
 * `.cat-tile picture,.cat-tile .cat-scrim{display:none}` from sporta-ui.css,
 * restore this file from git history (it is unchanged behind this notice's
 * predecessor, in the commit that added this notice), and mutation-test it
 * again before trusting it: it was wrong twice before it was right the first
 * time, per its own git history, and CSS changing how the tiles are hidden
 * is exactly the kind of edit that could silently reintroduce one of those
 * two failure modes.
 */
console.log('ok   retired 2026-09-16 — the category tiles are solid; see tile-art-test.mjs')
console.log('     the RTL-composition logic this checked is unchanged in assets/tile-art.js,')
console.log('     and unreachable while sporta-ui.css hides the artwork it would swap')
process.exit(0)
