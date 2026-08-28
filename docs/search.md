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
