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

---

# Leading and measure

Two dimensions the size ladder does not cover, both now checked by
`npm run audit:type`.

## Leading: the ladder was upside down

`globals.css` states the rule — *"loosened per step, staying tighter as the type
grows the way a type scale should"* — because Tailwind's defaults are tuned for
Latin and Arabic needs more room: deep descenders (ج ح خ ع م ن ي س ص ق ل) plus
dots above and below.

But the ladder only ever started at `text-lg`. The three sizes carrying almost
all of the site's words were still on the Latin defaults:

| size | was | is |
| --- | --- | --- |
| 12px `text-xs` | 1.33 — 492 nodes | **1.7** |
| 14px `text-sm` | 1.43 — 496 nodes | **1.65** |
| 16px `text-base` | 1.5 | **1.6** |
| 18px `text-lg` | 1.6 | 1.6 |

So the smallest running text had the tightest leading, which is the rule
backwards. `body` gained a matching `line-height: 1.6` as well — text with no
size class inherits from there, and preflight's 1.5 is also a Latin number.

`text-2xs` stays at 1.45 and is deliberately outside this curve: it is a badge
size, always one line, where the ratio sets a box height rather than the gap
between two lines of reading.

## Measure: 121 characters to the line

Measured, not guessed. Comfortable reading is 45–75 characters; past about 80
the eye starts landing on the wrong line on the way back, and Arabic makes that
slightly worse because the return sweep is right-to-left.

The fix caps the running text only — containers stay wide, because headings,
cards and layout want the room.

**The number is 46ch, not the 65ch every article recommends.** `ch` is the
advance width of the `0` glyph — a tabular Latin numeral, one of the widest
things in the font. An average Arabic letter is far narrower, so a ch-based cap
fits about half as many again: 68ch measured **103** Arabic characters here.
46ch lands at ~70, which is the number the advice was actually about.

Every long line on the site is now 69–73 characters.

## What the check found that I had not

Turning the measurement into a permanent check immediately surfaced six more
over-long lines on pages I had not looked at — the business-registration form's
helper text at **141 characters**, and the admin panel's empty state. That is
the whole argument for a check over a one-off pass.

`.measure` is opt-in: it caps `p`, `li` and `blockquote` inside it, and adds
`text-wrap: pretty` so a paragraph does not end on an orphaned word. Headings
get `text-wrap: balance` globally.
