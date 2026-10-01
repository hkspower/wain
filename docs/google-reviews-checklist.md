# Google reviews — the checklist

On 1 October you chose **«rank now, quote after I check»**. This is the list to
check from. Nothing here is shown or said to anyone until a row is checked.

## What the figures do today

`src/lib/place-reviews.ts` holds a rating for 38 of the 52 places. سالم uses them
for one thing only. When the search finds several places that answer a question
about equally well, he names the clearly better reviewed one first. «Clearly»
means at least a tenth of a star, after weighing how many reviews stand behind
each figure.

They never:
- lift a weaker match over a stronger one;
- add a place the search did not find;
- move a place that has no figure, or move anything past one;
- appear in anything سالم says, or on any card, pin or page.

`npm run audit:reviews` fails if any code other than سالم's tool helper reads them.

## Why they cannot be quoted yet

Every figure came from a search engine's **summary** of some page (Wanderlog,
bestofkuwait, travel listings) quoting a Google rating. No Google Maps page was
opened: those pages, and the pages quoting them, are refused by this
environment's network gateway. Each place was looked up twice, blind, and a
third time where the two disagreed. So each number is someone's report of
Google's figure, on a day nobody recorded.

## How to check a row

1. Open Google Maps and search for the place by its name (Arabic or English).
2. Make sure the listing is the place itself, not a shop inside it or another
   branch.
3. Write down the rating, the review count and today's date in the last two
   columns.
4. Send the filled rows back. A checked row can then be quoted as
   **«حسب قوقل»** with your date. That wording is not built yet; it will be built
   for the first checked row.

Before quoting anything, check Google's Maps terms on showing ratings outside
Google. That decision is yours, and nothing here assumes the answer.

## The rows

«Found» is rating · reviews; a range means the two look-ups saw different counts,
and the lower one is used. «Used» says whether the figure takes part in ordering.
«Site» is the rating `places.ts` shows on the site today. It has no stated
source, and it often runs higher than what was found (Souq Al-Mubarakiya 4.8 on
the site, 4.4 found; Kuwait Towers 4.7 and 4.5).

| Place | Found | How sure | Used | Site | On Google Maps (rating · reviews) | Checked on |
|---|---|---|---|---|---|---|
| أبراج الكويت · `kuwait-towers` | 4.5 · 18,656–20,701 | both look-ups agree | yes | 4.7 |  |  |
| سوق المباركية · `souq-al-mubarakiya` | 4.4 · 26,500 | both look-ups agree | yes | 4.8 |  |  |
| حديقة الشهيد · `al-shaheed-park` | 4.6 · 19,267 | both look-ups agree | yes | 4.6 |  |  |
| ميس الغانم · `mais-alghanim` | 4.5 · 7,056–9,739 | both look-ups agree | yes | 4.6 |  |  |
| فريج صويلح · `freej-swaileh` | 4.2 · 12,983–13,262 | both look-ups agree | yes | 4.5 |  |  |
| مقاهي المباركية · `mubarakiya-tea-houses` | — | not one listing | no | 4.7 |  |  |
| شارع سالم المبارك · `salem-al-mubarak-street` | — | not one listing | no | 4.3 |  |  |
| الأفنيوز · `the-avenues` | — | not found | no | 4.7 |  |  |
| سوق شرق · `souq-sharq` | 4.3 · 11,380 | both look-ups agree | yes | 4.4 |  |  |
| المسجد الكبير · `grand-mosque` | 4.8 · 3,573 | one look-up only | yes | 4.9 |  |  |
| شاطئ المارينا · `marina-beach` | — | not found | no | 4.5 |  |  |
| مركز الشيخ جابر الثقافي · `jacc` | 4.7 · 4,550 | both look-ups agree | yes | 4.8 |  |  |
| جزيرة فيلكا · `failaka-island` | 4.3 · 289 | one look-up only | yes | 4.4 |  |  |
| بيت المرايا · `mirror-house` | 4.3 · no count | both look-ups agree | no (no count) | 4.6 |  |  |
| أكوا بارك · `aqua-park` | 3.9 · 400 | both look-ups agree | yes | 4.3 |  |  |
| متحف طارق رجب · `tareq-rajab-museum` | 4.5 · 244 | both look-ups agree | yes | 4.7 |  |  |
| الجزيرة الخضراء · `green-island` | 4 · 3,700–3,751 | both look-ups agree | yes | 4.2 |  |  |
| برج التحرير · `liberation-tower` | 4.2 · 4,100 | one look-up only | yes | 4.4 |  |  |
| قصر السيف · `seif-palace` | — | not found | no | 4.3 |  |  |
| برج الحمراء · `al-hamra-tower` | 4.5 · 4,613 | one look-up only | yes | 4.5 |  |  |
| المتحف الوطني الكويتي · `kuwait-national-museum` | 4.1 · no count | one look-up only | no (no count) | 4.1 |  |  |
| بيت السدو · `sadu-house` | 4.4 · 273 | both look-ups agree | yes | 4.3 |  |  |
| مركز الشيخ عبدالله السالم الثقافي · `abdullah-al-salem-cultural-centre` | 4.6 · 5,550 | one look-up only | yes | 4.6 |  |  |
| بيت العثمان · `bait-al-othman` | 4.4 · 1,752 | both look-ups agree | yes | 4.4 |  |  |
| مارينا مول · `marina-mall` | 4.4 · no count | one look-up only | no (no count) | 4.3 |  |  |
| مجمع ٣٦٠ · `mall-360` | 4.5 · 21,000–22,198 | both look-ups agree | yes | 4.4 |  |  |
| سوق الجمعة · `friday-market` | 4.2 · 3,700–4,300 | both look-ups agree | yes | 4 |  |  |
| المدينة الترفيهية · `entertainment-city` | 3.4 · 59 | one look-up of three; left out (see below) | no | 3.9 |  |  |
| حديقة حيوان الكويت · `kuwait-zoo` | 3.9 · 5,876 | both look-ups agree | yes | 3.8 |  |  |
| شاطئ المسيلة · `messilah-beach` | 4.1 · 410 | both look-ups agree | yes | 4.2 |  |  |
| الخيران · `khiran` | — | not found | no | 4.5 |  |  |
| كافيهات شارع الخليج · `gulf-road-cafes` | — | not one listing | no | 4.4 |  |  |
| مارينا كريسنت · `marina-crescent` | 4.4 · 7,495–7,599 | both look-ups agree | yes | 4.4 |  |  |
| سوق السمك · `fish-market` | 4.3 · 10,000 | one look-up only | yes | 4.3 |  |  |
| شارع حمد المبارك · `hamad-al-mubarak-street` | — | not one listing | no | 4.2 |  |  |
| شارع تونس · `tunis-street` | — | not one listing | no | 4.1 |  |  |
| المركز العلمي · `kuwait-science-centre` | 4.4 · 5,186 | both look-ups agree | yes | — |  |  |
| الكوت مول · `al-kout-mall` | 4.6 · 10,966 | both look-ups agree | yes | — |  |  |
| قصر السلام · `al-salam-palace` | 4.5 · 235 | both look-ups agree | yes | — |  |  |
| المركز الأمريكاني الثقافي · `amricani-cultural-centre` | 4.4 · 369 | one look-up only | yes | — |  |  |
| مدينة صباح الأحمد البحرية · `sabah-al-ahmad-sea-city` | — | not found | no | — |  |  |
| مزارع الوفرة · `wafra-farms` | 4.1 · 177 | look-ups disagree | no | — |  |  |
| بيت لوذان · `bait-lothan` | — | not found | no | — |  |  |
| سوق الوطية · `souq-al-watiya` | 4 · 4,056 | one look-up only | yes | — |  |  |
| الصالحية · `salhia-complex` | 4.5 · 985 | one look-up only | yes | — |  |  |
| بيت ديكسون · `dickson-house` | 4.1 · 86 | one look-up only | yes | — |  |  |
| شاطئ الشعب · `al-shaab-beach` | — | not found | no | — |  |  |
| معرض الكويت الدولي · `kuwait-fairground` | 4.4 · 1,700 | both look-ups agree | yes | — |  |  |
| سوق الصفافير · `souq-al-safafeer` | 4.1 · 685 | both look-ups agree | yes | — |  |  |
| جسر الشيخ جابر · `sheikh-jaber-causeway` | 4.7 · 1,623 | one look-up only | yes | — |  |  |
| مجمع الفنار · `al-fanar-mall` | 4.1 · 4,615 | one look-up only | yes | — |  |  |
| متحف الفن الحديث · `modern-art-museum` | 4.2 · 204 | both look-ups agree | yes | — |  |  |

## Left out on purpose

- **المدينة الترفيهية** — one of three look-ups found 3.4 from 59 reviews. That
  reader thought it might be a minor or duplicate listing, and the park itself
  is reported **closed since June 2016**.
- **مزارع الوفرة** — 4.1 from 177 belongs to one listing called «Farm Wafra». The
  catalogue entry describes the whole farming area, about 3,400 farms.
- **Three streets, the Mubarakiya tea houses and the Gulf Road cafés** — none is
  one Google listing. They are many businesses, and no average was taken.

## Also found while looking — facts to check

- **المدينة الترفيهية**: reported closed since June 2016. It is still in the
  catalogue as a place to go.
- **سوق شرق**: one source reported it closed in January 2026. Not confirmed.
- **قصر السلام**: sources put the palace museum in **Shuwaikh**; the catalogue says
  Bnaid Al-Qar.

None of these was changed. You chose to check first.
