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
