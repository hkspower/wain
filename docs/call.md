# مركز اتصال وين — calling شوق

Tap the وين AI button and the call starts. That is the whole interaction.

## Where the button is, and where the component is

They are not the same place, and the difference is load-bearing.

**The button is inside the search box** on /search — `ShouqCallButton`, where
the mic used to be. It went through two homes to get there. It was a coral
launcher floating over the corner of every page, which was wrong because
everything a call does already ends on /search: local mode pushes
`/search?q=…`, `show_places` pushes `/search?q=…` and then reports what that
page found, and a browser with no speech recognition is sent to `/search` to
type. On the privacy policy its only power was to navigate away from the
privacy policy. Then it floated over the corner of /search alone, which was
still one voice control too many — the box already had a microphone that
dictated into the field, so two microphone-ish buttons sat side by side
offering what a visitor reads as the same thing.

There is one now, in the box, and it places the call. The dictation the mic
did is not lost on a browser without the agent: local mode ends where the mic
ended, with the sentence in the field and the answer read back.

**The component stays in the root layout**, above the router. It has to:
`open_place` is a route change, and the `<elevenlabs-convai>` element is
created imperatively inside `WainAiCall`, so a call the search page owned
would be torn down by its own tool — she opens the place, says «فتحت لك
صفحته، تبي شي ثاني؟», and the line is already dead.

So the two are in different React trees and talk over `lib/wain-ai-bus.ts`:
one window event to ask for a call, one to carry the phase back. The phase has
to come back or the button would be claiming something it cannot see — the
pulse while ringing, the moving mouth while she talks, and `aria-expanded` on
a dialog it does not render. The gesture work stays with the button, because
iOS will not unlock audio outside a user gesture and the call mounts an event
and a chunk-fetch later, by which time the activation is gone.

`tests/shouq-search.test.mjs` asserts the box has her button and no second
voice control; `tests/shouq-flow.test.mjs` asserts she is offered on /search
and nowhere else.

## What she answers from

The live rows, through `usePlaces()` inside `WainAiCall` — the same ones
/search, /explore and every place page render.

This was the last part of the site reading the build-time snapshot. Both tool
results claimed to run «the same search the page runs (same index, same
limit)», and they did not: they built an index from `@/lib/places` while every
listing rendered `usePlaces()`. Identical until an admin touches anything, and
then شوق describes the previous deploy's catalogue to somebody looking at this
one — she cannot find a place that was added, still finds one that was
unpublished, reads out the old name of one that was renamed, and `open_place`
answers «ما فيه مكان بالمعرّف» for a slug the visitor can already see in the
results behind her.

`places` is in the registration effect's dependencies on purpose: a
registration left in place across an admin edit would answer from the rows as
they were when the call started, which is the same staleness one call long.

## Why it stopped being a hold

The button used to require a three-second press, and the label said so:
«اضغطي أو اضغط ٣ ثواني». The reasoning was real — a voice session takes the
microphone and the audio output, and that is far too much to happen from a
pocket-tap, so the gesture had to be deliberate.

But it had to be *explained on the button*, and an instruction printed on a
button is a sign the button is wrong. It also fails the people least able to
absorb a new gesture, and WCAG 2.5.1 meant a separate keyboard path existed
purely to be the accessible way in.

A call solves the same problem the way phones already solved it:

1. The tap opens a call that is **ringing**. Nothing has been seized yet.
2. The ring-back tone says it is going somewhere while the browser decides
   about the microphone — the one stretch that is otherwise silence.
3. It becomes **متصل** only once she is actually listening, with the timer
   running from that moment.
4. The red **إنهاء المكالمة** is on screen the entire time.

The visitor watches the microphone become live and can stop it at any point,
which is stronger consent than three seconds of pressing — and it costs one
tap, through a sequence nobody has to be taught.

## The states

| Phase | What it is | What ends it |
| --- | --- | --- |
| `ringing` | dialling: waiting on the microphone, or on the widget | connects, hung up, or fails |
| `live` | connected — she is listening, timer running | she answers, or hung up |
| `answering` | local mode: she has the question and is replying | ~700ms, then the results |
| `ended` | hung up, showing the duration | «اتصل مرة ثانية» or × |
| `error` | the call could not be placed | «اتصل مرة ثانية» or × |

**× and Escape both hang up *and* close**, in one press. The red button hangs
up and stays, showing how long the call ran — that summary is the point of
pressing it deliberately. A dialog that stays open after Escape is the thing
Escape exists to prevent.

## The two ways a call is served

Unchanged by any of this, and picked by configuration (`src/lib/wain-ai.ts`):

- **Agent mode** — the ElevenLabs widget, a real duplex conversation. It owns
  the microphone, and it having mounted *is* the call connecting. She can also
  put places on screen mid-call through the `show_places` / `open_place`
  client tools.
- **Local mode** — the browser's speech recognition takes the question, وين's
  search answers it, and صوت وين reads the answer aloud on the results page.
  One question per call. `onstart` — which only fires after the microphone is
  granted — is what connects the call.

Local mode's call ends when she answers, because she has. She keeps talking on
the results page; the call ending is not her stopping.

## No mute button

Deliberately. In agent mode the microphone belongs to the ElevenLabs widget and
this component cannot honestly switch it off, so a mute control would work on
one path and lie on the other. Hanging up is unambiguous on both.

## The sounds

`src/lib/call-tones.ts`, synthesised — there is no audio file to ship or keep
in sync. The ring-back is 425Hz, one second on and three off: the ITU standard
Kuwait uses, so it means what everyone in the country already knows it means,
at a third of the chime's gain because it plays next to an ear and repeats.
Connect is two rising notes, hang-up two falling ones.

All of it is safe when WebAudio is missing, refused, or the page has never been
touched. The call still works, it is just quieter.

Both this and the admin order chime now share one `AudioContext`
(`src/lib/audio-context.ts`). Browsers cap how many a document may hold and a
refused constructor throws, so two contexts meant two chances for a sound to
silently not play.

## What is tested

`tests/shouq-flow.test.mjs` (44 assertions) covers the tap, the ringing copy,
ringing→connected, the timer *actually counting* rather than merely rendering
`٠٠:٠٠`, hang-up and its duration summary, both microphone failures, the
browser with no speech input, and Escape closing in one press.
`tests/shouq-agent.test.mjs` covers the same call in agent mode, including that
it stays ringing until the widget is up.

The stub recogniser grew a `stayOpen` mode: real engines end recognition on a
pause, and that pause ends the call — so a test that wants to look at a
*connected* call has to be given one that is not about to end underneath it.
