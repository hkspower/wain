# The type scale

```
npm run audit:type
```

Walks every visible text node on ten pages at phone and desktop widths, records
the computed size, and reports the whole scale in use. Reading the classes
tells you what was written; only rendering tells you what a reader gets.

## The scale

| px | token | role |
|---|---|---|
| 11 | `text-2xs` | micro-labels in constrained slots — tab bar, progress steps, counts |
| 12 | `text-xs` | small text and every pill badge |
| 14 | `text-sm` | the workhorse — 682 nodes, more than any other size |
| 16 | `text-base` | body |
| 18–24 | `text-lg`–`text-2xl` | card and section headings |
| 30–60 | `text-3xl`–`text-6xl` | display, one or two nodes each |

## The floor is 11px, and it is about Arabic

Arabic carries meaning in dots and short connecting strokes — ب ت ث ن ي differ
by dots alone — and those are the first thing to go as the size drops. 10px
Latin is small; 10px Arabic is ambiguous. Nothing on the site goes below 11px.

Two things did. One was a `⌘K` keyboard hint, which is Latin and desktop-only
and defensible. The other was «٧٫٢ ميجا» in white over a photo thumbnail,
telling a business why their upload was rejected — Arabic-Indic digits at 10px
on a busy background, which is exactly the combination the floor exists for.

## What the audit found

**Twenty-two arbitrary `text-[11px]` and two `text-[10px]`.** Not a design
decision made twenty-four times — one decision nobody had anywhere to write
down, so everybody wrote a number instead. 11px is a real step in this scale,
so it is declared as `--text-2xs` in `@theme` and the arbitrary values are
gone. The audit now fails the build if a new one appears.

**The same badge at two sizes.** Six pills rendered at 11px against
ninety-three at 12px — the «مجاناً» chip, the order and queue counts, the admin
tab badges. Nobody would choose that; it is what happens when the only way to
say "small" is to pick a number. Every pill is 12px now, and `text-2xs` is
reserved for plain micro-labels, so each token has one job.

## Why the badge check is a report, not a verdict

Telling a status pill from a call-to-action by shape alone does not work. The
first attempt walked up to the nearest rounded ancestor and found the navbar's
rounded *container*, calling every link inside it a badge; excluding anything
inside a link then hid the rating chip, which sits inside a whole-card link and
is a badge. The version that ships looks only at the label's own element or its
immediate parent, and only when the label is short.

Even so it cannot separate a badge from a button-shaped span, so it prints the
sizes and says so, rather than failing. A check that guesses is a check people
learn to ignore — the same reason the icon audit was taught which marks are
meant to be short.

The hard failures are the two things that are not a matter of judgement: an
arbitrary size in the source, and anything below the floor.
