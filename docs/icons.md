# The icon set

30 icons in `src/components/icons.tsx`, all on a 24-unit grid with 1.8px
rounded strokes and an optional duotone wash at 15%.

```
npm run audit:icons
```

Renders every icon in a browser, measures where each one actually sits on the
grid, and writes a contact sheet to `docs/icons.png`.

## One path, not two

The wash used to be a second copy of the same path stacked underneath the
outline — the same `d` string written out twice, once filled and once stroked.

`fill-opacity` is a separate attribute from `opacity`, so a single path can
carry a 15% fill *and* a full-strength stroke. Same picture, and:

- **107 SVG nodes → 87** across the set, on every page that renders an icon;
- the two halves can no longer drift apart, because there is only one of them.

That second point was not hypothetical. IconPalm's wash had ended up 0.6 units
off its own outline and the icon rendered as a smear.

`wash` remains for the genuine cases where the filled shape is not the stroked
one: a knife blade whose handle continues past it, a car roof that must not be
stroked along the line where it meets the body.

## What the audit measures, and why

**Size is judged on area, not height.** Height was the obvious measure and it
was wrong: a car and a speaker are wider than they are tall, and forcing either
to the height of a clock face turns the car into a van. What makes one icon
look a different size from its neighbours is how much ink it puts down, so
that is what is checked — against the median, with a generous 30% band. This
is for catching the glaring, not for tuning.

**Centring is checked on everything.** A glyph a unit off the grid's centre
looks dropped or floating next to the text it sits beside.

**Some marks are meant to be short**, and the audit knows which. A horizontal
arrow drawn to the full 17 units would tower over its label; a tick and a cross
are read as gestures rather than objects and are conventionally smaller. They
carry a reason in the report instead of a warning. Flagging them taught the
tool to cry wolf, which is how a real outlier gets scrolled past.

## What the first run found

Thirteen problems, all invisible from reading the file:

| Icon | Was |
|---|---|
| Palm | wash 0.6 units off its outline; five fronds merged into a black smear |
| Star | 2.2 units left of centre — visible in a rating row, where it repeats five times |
| Sparkle | 1.8 units right of centre |
| Sun | rays reached 2.6–21.4, making it 36% heavier than anything beside it |
| PinSolid | 18% taller than the set |
| Locate | the largest box in the set, purely from over-long crosshair arms |
| Car, Masks | both sitting a unit low |
| Instagram | its corner dot was a stroked `r=0.4` circle, so the 1.8 stroke rendered it three times the size it claimed |

Two more came from looking at the contact sheet rather than the numbers, which
is why the sheet exists:

- **Palm**, redrawn once, was still wrong. Its fronds were closed shapes about
  two units across, and a 1.8 stroke centred on a two-unit shape fills it in
  completely — four of them merged into one canopy that read as a mushroom.
  They are open strokes now, like the tower, which is the clearest glyph in the
  set for exactly that reason.
- **Cutlery** had a two-tined fork, which reads as a tuning fork. It has three.

The audit now reports nothing out of line.

## Accessibility

Every icon is `aria-hidden`, so an icon beside a label is not read out twice.
That makes an icon-only button a control with no accessible name unless it
carries an `aria-label` — checked across the home, explore, search, place,
orders, queue, add, about and admin pages, and every one of them has a name.
