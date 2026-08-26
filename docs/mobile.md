# The site on a phone

`npm run audit:mobile` — needs `npm run build`. The eighth check in
`npm run scan`.

Kuwait browses on phones. Everything else here is already measured on a phone
viewport — the colour audit, the runtime audit, the journey — but only for
whether the site *works*. This measures whether it can be **used**: with a
thumb, one-handed, on a screen 390 CSS pixels wide, and again at 320, which is
an iPhone SE or any phone with display zoom turned on.

## What it asks

1. **Does the page slide sideways?** One overflowing element makes the whole
   page scroll horizontally, and the visitor blames the site, not the element.
   Elements inside a deliberate horizontal scroller are exempt — the category
   rail on the home page is meant to be wider than the screen.
2. **Can a thumb hit everything?** 44×44, Apple's floor and WCAG 2.5.5.
3. **Is anything small *and* crowded?** Size and spacing trade off: two
   comfortable 44px controls four pixels apart are a segmented control, which
   is a pattern rather than a defect. This only fires when one of the pair is
   undersized as well as close.
4. **Is anything below the palette's floor?** `globals.css` declares
   `--text-2xs: 11px` and says "nothing on the site goes below this" — Arabic
   carries meaning in dots and short connecting strokes, so it has further to
   fall than Latin. The audit takes that as the floor rather than inventing one.
5. **Will iOS zoom into a field and stay there?** Safari zooms the page when a
   text input under 16px is focused, and never zooms back out.

Map pins are exempt from the size rule and named as such: WCAG 2.5.8 exempts a
control whose size is essential to what it conveys, and a pin's position *is*
its meaning — padding it to 44px would move it off its place or bury its
neighbours. The frames carry `data-map-frame` so the audit can tell.

## What it found

**The clearance under شوق's launcher reached almost nobody.** `body` had
`padding-bottom` sized to clear the floating button, but only inside the two
`display-mode: standalone` blocks — so it applied to people who had installed
the site to their home screen, and to no one else. In an ordinary mobile
browser the launcher floats over whatever the page ends with, and that last row
can never be scrolled out from under it. The padding is now unconditional.

**Footer links were as wide as their words.** «قهوة» is four characters, so its
target was 25px wide inside a row 140px wide. Five links now fill their row,
which costs nothing and triples the margin for a thumb.

**Five controls were 40px or shorter** — the place-page breadcrumb back to
/explore (21px tall), the empty-state buttons on the order tracker, the queue
tracker and search, and the OpenStreetMap attribution, which the licence
requires and people do occasionally follow.

**The link home was the one target on the site a thumb could miss.** Below
360px the wordmark hides and only the 40px mark is left. `min-w-11` fixes it.

## Checker bugs worth remembering

Three of the first run's twenty findings were the audit re-litigating decisions
that were already right:

- The skip link and the file inputs measure 1×1 because they are `sr-only` —
  hidden until focused, which is the whole point of them. Calling correct
  accessibility practice a defect. They are counted and skipped now.
- 11px text was flagged against a threshold of 11.5 I had picked out of the
  air, when `globals.css` already declares 11px as the deliberate floor with
  its reasoning written down. The audit reads the floor instead of setting one.
- شوق's launcher was reported as crowding whatever happened to be beneath it.
  A `fixed` control floats over the page *by definition*; measuring its
  distance to whatever is under it at scroll zero measures the scroll position,
  not the design. What actually matters is that the page ends with room to
  clear it — which is the body padding, and which was genuinely broken.

Proved by removing the `min-w-11` fix and watching the run fail.
