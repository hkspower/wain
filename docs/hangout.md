# «رسّلها للربع» — sending a place to the group

`npm run test:hangout`

## The hole this fills

Everything on the site was built around one promise:

- Home CTA — «خلّ الجروب يرتاح — لقِ طلعة الليلة في أقل من دقيقة»
- Step 3 — «تخلص من نقاش الجروب»
- About — «في جروب العايلة، في جروب الربع، كل خميس»

And there was **no way to send anything to anybody**. No share button, no
`navigator.share`, no WhatsApp link — not on a place page, not in results,
nowhere in `src/`. Someone who found a place had to copy the URL out of the
address bar themselves.

Finding the place was solved. Telling five people about it was not, and that is
the half the argument actually happens in.

## Why it carries a time

A link on its own does not end the argument either. «شرايكم؟» plus a link is a
new thread. What ends it is a *proposal* — this place, at this time, with the
map attached — something the group can answer with «تمام» instead of discuss.

So a share from here always carries a when. The chips are eight fixed phrases,
not a date picker: a group deciding tonight's outing chooses between «الحين» and
«بعد المغرب», and asking them for a calendar date to answer «وين نروح الليلة؟»
makes the tool slower than the chat it replaces.

**Hours that have passed drop off the list.** Offering «الليلة الساعة ٧» at nine
o'clock is offering a plan that already failed.

**The default fits the place and the hour.** Before noon, an indoor place is
proposed for an hour from now; an open-air one is proposed for the evening,
because for four months of the year a Kuwaiti afternoon outdoors is not a
proposal, it is a warning. After the evening is gone, the default is باچر. The
default is always one of the options actually on screen — a preselected chip
nobody can see selected would be a bug, and the tests check every hour for it.

## What the group receives

```
أبراج الكويت — مدينة الكويت 📍
الليلة الساعة ٨

أيقونة الكويت، على ارتفاع ١٨٧ متر فوق الخليج.

الموقع: https://www.google.com/maps/dir/?api=1&destination=29.389,48.0034
https://www.wainkw.com/places/kuwait-towers/
```

The map link comes before the wain link because it is the one they need in the
car. Digits are Arabic-Indic everywhere except inside the URLs — a message half
in ٨ and half in 8 reads like it came from software, which is what a message to
your friends should not read like.

## Three ways to send, in order

1. **The native share sheet.** On a Kuwaiti phone this is right every time: it
   offers WhatsApp first because that is what the person uses, and it needs no
   permission and no new tab.
2. **WhatsApp directly**, via `wa.me`. Desktop browsers mostly have no share
   sheet.
3. **The clipboard**, and say so. Never a dead end.

`url` is deliberately *not* passed to `navigator.share` alongside `text`:
several Android browsers then send only the URL and drop the message, which
loses the time — the one thing that makes this a plan rather than a link.

**Backing out of the share sheet is a decision, not a fault.** It has its own
outcome (`cancelled`), so the panel stays quiet: it does not fall through and
open WhatsApp behind the visitor's back, and it does not report an error at
somebody who simply changed their mind.

## Nothing is stored

No table, no account, no record. The message is composed in the browser and
handed to whatever the visitor already has. wain never learns that a plan was
made, which matches the no-tracking promise on the privacy page.

## What is tested

49 assertions in two halves.

`tests/hangout.test.mjs` — no browser. Kuwait is UTC+3 with no daylight saving
and the machine running the tests is on UTC, so a rule written against local
time would pass in Kuwait and fail in CI. Every hour in these tests is a Kuwait
wall-clock hour, including one that crosses midnight, where a naive offset
reports 01:30 as hour 22.

`tests/hangout-page.test.mjs` — the panel on a real place page, with the share
sheet, the popup and the clipboard each removed in turn. On any one device only
one link of that chain ever runs, which is exactly what makes the other two the
kind of code that stays broken for a year.

## Where it is not

The place page only. Search results and cards do not carry it: the place page is
where the decision is made, and a send button on every card is a send button
nobody reads.

---

# The map pins

`npm run test:hangout` runs these too (`tests/map-pin.test.mjs`).

## The active pointer

Pins answered only to `mouseenter`. A place's name was therefore readable on a
desktop and nowhere else: on a phone the tap fired the link immediately, so the
label the map is built around had no moment in which it could ever be seen, and
"the map and the list stay in step" was true of mice only — on a site whose
traffic is almost entirely phones.

Now, on a device where hovering tells you nothing, **the first tap selects and
the second opens**. Nothing changes for a mouse: hover selects, one click opens.
The test pins both, because they are the two behaviours that would quietly drift
back into one.

`(hover: none)` rather than a touch check — a laptop with a touchscreen has
both, and the question is not "can this be touched" but "does hovering tell this
person anything".

**The bug the test caught.** The first version asked "is this pin already
selected?" inside the click handler. Tapping a link makes a browser fire a
*synthetic* `mouseenter` before the click, for compatibility with pages written
for mice — so the pin had selected itself microseconds earlier, the check
passed, and the first tap navigated away exactly as before. On a real phone as
much as in the test. `pointerdown` lands before that synthetic hover, so the
answer is sampled there instead. A keyboard click reports `detail === 0` and is
never intercepted: tabbing to a pin and pressing Enter means open it.

## The callout

A bare tooltip with a name became a card: name, area, rating, and an arrow. On a
phone it is the entire reason the first tap is spent selecting rather than
opening, so it has to be worth the tap.

It opens away from whichever edge it is near. The frame clips its overflow so
the rounded corners hold, and a centred callout on a pin near the edge lost the
half with the name on it.

## The colour

Every pin was the same near-black circle, which made a map of eight kinds of
place look like a map of one. Each pin now takes its category's tint, from the
middle of the gradient that category's cards already use, so the map reads as
part of the site rather than an embed with dots on it. Colour groups loosely —
sea for landmarks and culture, warm for food and shopping, palm for outdoors and
family — and the icon inside says precisely which, which is how real maps do it.

The active pin scales up, raises its shadow and gets a pulsing halo in its own
tint, so it is findable at a glance on a busy frame.

## The place page's own pin

The place the page is about is the largest thing on the frame, in coral, with a
permanent double halo — it is the answer to the question the page asks. It is
not a link, because you are already there.

Its spreading radius went from 32 to 40 to match: it had grown, and at 32 a
neighbour was landing on top of the very place the page was about.
