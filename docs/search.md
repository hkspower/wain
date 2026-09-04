# Search

## Where the search actually stands

```
npm run audit:search
```

The battery in `tests/shouq-battery.test.mjs` asks 24 questions in the Kuwaiti
a person would really use and checks the category that comes back. That is the
test that matters most — it catches a lost synonym or a changed weight turning
شوق from useful into confidently wrong. What it cannot show is coverage: 24
questions over 36 places says nothing about the several hundred other ways in.

Measured exhaustively, over every place and every word written about one:

| | |
| --- | ---: |
| a place found by its own Arabic name | **36/36 · 100%** |
| …and ranked **first** | **36/36 · 100%** |
| found with one letter dropped from a word | **36/36 · 100%** |
| its 238 tags reach it | **238/238 · 100%** |
| its 108 highlights reach it | **108/108 · 100%** |
| its area reaches it | **36/36 · 100%** |
| per query | **0.05 ms** |
| to build the index | **3.7 ms** |

Ranked-first is the one that decides what شوق says out loud: she reads the top
hit, so second place is a wrong answer delivered confidently.

The index is built on the client, so the 3.7 ms is paid before the first
keystroke — comfortably inside a frame.

### The engine is not the limit; the catalogue is

Of 35 everyday things a visitor might plausibly type, 23 are answered. The
twelve that return nothing are **not search failures**:

> جيم · صيدلية · مستشفى · بنك · سوشي · دجاج · رومانسي · مواقف · شباب · صحراء ·
> كتب · ملابس

None of those twelve appears anywhere in the catalogue — not in a name, a
tagline, a description, a tag, a highlight, a product or a menu. There is no
gym, no pharmacy, no sushi, and nothing tagged for a young crowd or a quiet
evening out. The search returns nothing because there is nothing, and no amount
of tuning invents a place.

Half of them are fairly out of scope for a where-shall-we-go app — nobody
plans an outing to a bank. The rest are the real content gap, and they cluster:
**a mood and audience vocabulary** (رومانسي, شباب), **shopping specifics**
(ملابس, كتب), and **food specifics** (دجاج, سوشي). The `tagsAr` field already
carries the audience dimension and already reaches its places perfectly — so
this is a matter of writing more tags, not of changing any code.

### A checker bug worth remembering

The first version of the typo test cut a letter from the midpoint of the whole
name. For «سوق شرق» that deletes the *space* and asks for «سوقشرق» — not a typo
but a different word — and it did the same to five other multi-word names. It
reported 78% typo tolerance. The real figure is 100%: the checker was broken,
not the search. It now cuts inside a word and never touches a space.

## شوق answers on the page, and the box listens

`npm run test:hangout` → `tests/shouq-search.test.mjs`, 22 assertions.

`answerParts` builds a real reply to every search: it names the best place and
says why, gives the best time to go, warns about the Kuwaiti summer where the
place is open to it, and offers exactly one alternative. The search page
computed that and did one thing with it — `speak()`.

صوت وين is off unless you turn it on, so **for almost everyone the answer was
built and thrown away**. Her call hands you to this page — *"the search page's
own summary is the reply"*, says the comment in `WainAiCall` — and the summary
was inaudible and invisible at the same time. A typed search met a list of
cards with no sign that anybody had been asked anything.

It is rendered now, from the same object that is handed to `speak()`. There is
no second copy of what she says, which is the only way the written and the
spoken answer cannot drift.

| part | rendered as |
| --- | --- |
| the echo, when she was asked out loud | a quiet question above the answer |
| `place-<slug>`, `name-<slug>` | a link to that place, with its own mark |
| `summer-outdoor`, `summer-mixed` | tinted, so caution reads as caution |
| the rest | her sentences, in order |

Two of her parts are about a specific place, and `answerParts` says which by
keying them. A sentence recommending a place that you cannot press is a dead
end in the middle of the answer, so those lines are links; «أحلى وقت» is not
somewhere you can go, so it is not.

### One live region, and it is hers

The result count used to be the only announced thing on the page, so a screen
reader heard «٧ نتيجة» and nothing about what any of them were. Two polite
regions announce twice per query, so the count gave the role up: the answer
names the top place, which is strictly more than a number. `aria-atomic`,
because half an updated sentence is worse than a whole one repeated.

### The microphone went one way

Her call owned the only microphone on the site. *"The search box is the same
brain with typed input"*, says the comment that routes you here when
recognition is missing — true in one direction only: the page could be
**reached** by voice and then only used by typing.

`src/lib/speech.ts` now holds the detection, the typings and the locale,
because `ar-KW` is the thing that must not differ between the two. A copy that
forgot it would degrade to the browser's UI language and transcribe Kuwaiti
Arabic as whatever it thought it heard — a failure that looks like bad
recognition rather than a missing line of setup. The orchestration is
deliberately not shared: a call has ring-back, silence timers and six phases; a
search box has a mic that fills a text field.

Interim results go straight into the query, so the results and the map move
while the sentence is still being said.

### What the test found

Chromium ships `SpeechRecognition` **unprefixed**, and `getRecognition` prefers
it. The first version of the test stubbed only `webkitSpeechRecognition`, so it
replaced the branch the browser does not take: the real engine ran, found no
microphone, and the whole section measured nothing while reporting three
failures that looked like product bugs. It stubs both names now.

The nine assertions were negative-tested by deleting the answer block and the
mic button: nine clean failures, including «exactly one live region» dropping
to zero — which is what proves the region moved to her rather than being added
beside the old one.
