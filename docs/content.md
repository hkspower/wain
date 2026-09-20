# What is on wain

Generated — `npm run content`. Do not edit by hand; `npm run content:check`
re-renders from `src/lib/` and fails when this file and the code disagree.

It describes **the repository**, not the live site. The deployed build
trails HEAD on purpose (CLAUDE.md, *The live build id trails HEAD*), so an
empty field here is empty in the code, which is a different claim from
empty on the server.

## At a glance

|  | count |
| --- | --- |
| places | 52 |
| categories | 8 |
| areas (distinct `areaAr`) | 21 |
| routes (files under `src/app`) | 10 |
| pages built | 61 |
| hub actions | 3 |
| voice clip lines, per persona | 162 |

Ordering is live on **0 of 52** places and the queue on **0** — both need two fields set together, so read the pair, not either count in the coverage table below.

## Routes

| path | title | notes |
| --- | --- | --- |
| `/about/` | عن وين |  |
| `/add/` | سجّل مكانك مجاناً |  |
| `/admin/` | لوحة التحكّم | noindex |
| `/explore/` | استكشف |  |
| `/orders/` | طلباتي | noindex |
| `/` | — | layout default |
| `/places/<slug>/` | — | generateMetadata, 52 pages |
| `/privacy/` | الخصوصية والكوكيز |  |
| `/queue/` | دوري | noindex |
| `/search/` | بحث |  |

## Categories

| id | عربي | english | places | blurb |
| --- | --- | --- | --- | --- |
| `landmarks` | معالم الكويت | Landmarks | 5 | أيقونات المدينة |
| `restaurants` | مطاعم | Restaurants | 5 | غدا وعشا |
| `fastfood` | وجبات سريعة | Fast bites | 1 | على السريع |
| `coffee` | قهوة | Coffee | 3 | قهوة وچاي |
| `outdoors` | شواطئ وحدائق | Outdoors | 8 | بحر وخضرة |
| `shopping` | تسوّق | Shopping | 11 | أسواق ومولات |
| `culture` | ثقافة | Culture | 13 | متاحف وفنون |
| `family` | عائلة | Family | 6 | طلعة العيال |

## Areas

Counted off `areaAr` in the catalogue. There is no list of areas to read:
`src/lib/areas.ts` existed and the rollback in `f72759e` removed it, so the
places themselves are the only source today.

| منطقة | places |
| --- | --- |
| مدينة الكويت | 18 |
| السالمية | 9 |
| شارع الخليج | 3 |
| الخيران | 2 |
| الري | 2 |
| حولي | 2 |
| شرق | 2 |
| الجابرية | 1 |
| الخليج العربي | 1 |
| الدوحة | 1 |
| الزهراء | 1 |
| الشعب | 1 |
| الشويخ | 1 |
| الصبية | 1 |
| العمرية | 1 |
| الفحيحيل | 1 |
| القادسية | 1 |
| المسيلة | 1 |
| الوفرة | 1 |
| بنيد القار | 1 |
| مشرف | 1 |

## The catalogue

`price` is 1–3. `setting` is whether it works at 48°C — `mixed` means a
real indoor refuge, not air-conditioned shops along a street. A blank
`rating` means none is known, not zero.

### معالم الكويت — `landmarks` (5)

| الاسم | slug | منطقة | price | rating | setting | موسم |
| --- | --- | --- | --- | --- | --- | --- |
| أبراج الكويت | `kuwait-towers` | مدينة الكويت | ·· (2) | 4.7 | mixed | طول السنة، وأحلى شي وقت الغروب |
| برج التحرير | `liberation-tower` | مدينة الكويت | · (1) | 4.4 | outdoor | طول السنة — أحلى بالليل |
| قصر السيف | `seif-palace` | مدينة الكويت | · (1) | 4.3 | outdoor | من أكتوبر لأبريل، الصبح |
| برج الحمراء | `al-hamra-tower` | مدينة الكويت | ·· (2) | 4.5 | indoor | طول السنة — مكيّف |
| جسر الشيخ جابر | `sheikh-jaber-causeway` | الصبية | · (1) |  | outdoor +صيف | طول السنة — أنت بالسيارة |

### مطاعم — `restaurants` (5)

| الاسم | slug | منطقة | price | rating | setting | موسم |
| --- | --- | --- | --- | --- | --- | --- |
| ميس الغانم | `mais-alghanim` | شارع الخليج | ·· (2) | 4.6 | indoor | طول السنة |
| فريج صويلح | `freej-swaileh` | السالمية | ·· (2) | 4.5 | indoor | طول السنة |
| مارينا كريسنت | `marina-crescent` | السالمية | ·· (2) | 4.4 | mixed | طول السنة، والجلسات الخارجية من أكتوبر لأبريل |
| سوق السمك | `fish-market` | مدينة الكويت | ·· (2) | 4.3 | mixed | طول السنة |
| شارع تونس | `tunis-street` | حولي | · (1) | 4.1 | mixed | طول السنة — أحلى بالليل |

### وجبات سريعة — `fastfood` (1)

| الاسم | slug | منطقة | price | rating | setting | موسم |
| --- | --- | --- | --- | --- | --- | --- |
| شارع سالم المبارك | `salem-al-mubarak-street` | السالمية | · (1) | 4.3 | mixed | من أكتوبر لأبريل، وبالليل صيفاً |

### قهوة — `coffee` (3)

| الاسم | slug | منطقة | price | rating | setting | موسم |
| --- | --- | --- | --- | --- | --- | --- |
| مقاهي المباركية | `mubarakiya-tea-houses` | مدينة الكويت | · (1) | 4.7 | outdoor | من أكتوبر لأبريل، وبالليل صيفاً |
| كافيهات شارع الخليج | `gulf-road-cafes` | شارع الخليج | ·· (2) | 4.4 | outdoor | من أكتوبر لأبريل، وبالليل صيفاً |
| شارع حمد المبارك | `hamad-al-mubarak-street` | السالمية | ·· (2) | 4.2 | mixed | طول السنة، والجلسات الخارجية بالشتاء |

### شواطئ وحدائق — `outdoors` (8)

| الاسم | slug | منطقة | price | rating | setting | موسم |
| --- | --- | --- | --- | --- | --- | --- |
| حديقة الشهيد | `al-shaheed-park` | مدينة الكويت | · (1) | 4.6 | outdoor | من أكتوبر لأبريل |
| شاطئ المارينا | `marina-beach` | السالمية | · (1) | 4.5 | outdoor | من أكتوبر لأبريل |
| جزيرة فيلكا | `failaka-island` | الخليج العربي | ·· (2) | 4.4 | outdoor | الربيع والشتاء |
| شاطئ المسيلة | `messilah-beach` | المسيلة | · (1) | 4.2 | outdoor | من أكتوبر لأبريل |
| الخيران | `khiran` | الخيران | ·· (2) | 4.5 | outdoor | الربيع والشتاء |
| مدينة صباح الأحمد البحرية | `sabah-al-ahmad-sea-city` | الخيران | ··· (3) |  | outdoor | شتاء وربيع — الصيف حار جداً |
| مزارع الوفرة | `wafra-farms` | الوفرة | · (1) |  | outdoor | الشتاء للطلعة، والصيف للرطب |
| شاطئ الشعب | `al-shaab-beach` | الشعب | · (1) |  | outdoor | من أكتوبر لأبريل |

### تسوّق — `shopping` (11)

| الاسم | slug | منطقة | price | rating | setting | موسم |
| --- | --- | --- | --- | --- | --- | --- |
| سوق المباركية | `souq-al-mubarakiya` | مدينة الكويت | · (1) | 4.8 | mixed | من أكتوبر لأبريل، وبالليل صيفاً |
| الأفنيوز | `the-avenues` | الري | ··· (3) | 4.7 | indoor | طول السنة — مكيّف بالكامل |
| سوق شرق | `souq-sharq` | مدينة الكويت | ·· (2) | 4.4 | mixed | طول السنة، والممشى أحلى بالشتاء |
| مارينا مول | `marina-mall` | السالمية | ·· (2) | 4.3 | mixed | طول السنة، والشاطئ أحلى بالشتاء |
| مجمع ٣٦٠ | `mall-360` | الزهراء | ··· (3) | 4.4 | indoor | طول السنة — مكيّف |
| سوق الجمعة | `friday-market` | الري | · (1) | 4 | outdoor | من أكتوبر لأبريل، الصبح |
| الكوت مول | `al-kout-mall` | الفحيحيل | ·· (2) |  | mixed | أحلى من أكتوبر لأبريل |
| سوق الوطية | `souq-al-watiya` | مدينة الكويت | · (1) |  | mixed | أحلى بالشتاء |
| الصالحية | `salhia-complex` | مدينة الكويت | ··· (3) |  | indoor | طول السنة — مكيّف |
| سوق الصفافير | `souq-al-safafeer` | مدينة الكويت | · (1) |  | mixed | من أكتوبر لأبريل، وبالليل صيفاً |
| مجمع الفنار | `al-fanar-mall` | السالمية | ·· (2) |  | mixed | أحلى من أكتوبر لأبريل |

### ثقافة — `culture` (13)

| الاسم | slug | منطقة | price | rating | setting | موسم |
| --- | --- | --- | --- | --- | --- | --- |
| المسجد الكبير | `grand-mosque` | مدينة الكويت | · (1) | 4.9 | indoor | طول السنة |
| مركز الشيخ جابر الثقافي | `jacc` | مدينة الكويت | ·· (2) | 4.8 | indoor | طول السنة — مواسم العروض بالشتاء |
| بيت المرايا | `mirror-house` | القادسية | · (1) | 4.6 | indoor | طول السنة — بموعد مسبق |
| متحف طارق رجب | `tareq-rajab-museum` | الجابرية | · (1) | 4.7 | indoor | طول السنة |
| المتحف الوطني الكويتي | `kuwait-national-museum` | مدينة الكويت | · (1) | 4.1 | indoor | طول السنة |
| بيت السدو | `sadu-house` | مدينة الكويت | · (1) | 4.3 | indoor | طول السنة |
| مركز الشيخ عبدالله السالم الثقافي | `abdullah-al-salem-cultural-centre` | الشويخ | ·· (2) | 4.6 | indoor | طول السنة — مكيّف بالكامل |
| بيت العثمان | `bait-al-othman` | حولي | · (1) | 4.4 | indoor | طول السنة |
| قصر السلام | `al-salam-palace` | بنيد القار | · (1) |  | indoor | طول السنة |
| المركز الأمريكاني الثقافي | `amricani-cultural-centre` | شرق | · (1) |  | indoor | الموسم من أكتوبر لمايو |
| بيت لوذان | `bait-lothan` | السالمية | · (1) |  | mixed | أحلى بالشتاء |
| بيت ديكسون | `dickson-house` | شرق | · (1) |  | indoor | طول السنة |
| متحف الفن الحديث | `modern-art-museum` | مدينة الكويت | · (1) |  | indoor | طول السنة |

### عائلة — `family` (6)

| الاسم | slug | منطقة | price | rating | setting | موسم |
| --- | --- | --- | --- | --- | --- | --- |
| أكوا بارك | `aqua-park` | مدينة الكويت | ·· (2) | 4.3 | outdoor +صيف | الصيف للمي، والربيع أحلى للجو |
| الجزيرة الخضراء | `green-island` | شارع الخليج | · (1) | 4.2 | outdoor | الأشهر الباردة |
| المدينة الترفيهية | `entertainment-city` | الدوحة | ·· (2) | 3.9 | outdoor | الأشهر الباردة |
| حديقة حيوان الكويت | `kuwait-zoo` | العمرية | · (1) | 3.8 | outdoor | من أكتوبر لأبريل، الصبح |
| المركز العلمي | `kuwait-science-centre` | السالمية | ·· (2) |  | indoor | طول السنة — مكيّف بالكامل |
| معرض الكويت الدولي | `kuwait-fairground` | مشرف | ·· (2) |  | indoor | طول السنة — مكيّف |

## Field coverage

Optional fields, and how many of the 52 carry one.
The meaning of an empty cell is in the last column and is not always «no».

| field | set | what absent means |
| --- | --- | --- |
| `rating` | 36 | absent = no rating known, not zero |
| `coordsUnverified` | 16 | drafted coordinate, pin is approximate |
| `summerOk` | 2 | outdoors that summer does not ruin |
| `shisha` | 3 | absent = unknown, never «no» |
| `featured` | 6 | shown on the home page rail |
| `logoUrl` | 0 | business profile — set when an owner registers |
| `bioAr` | 0 | the business in its own words |
| `imageUrls` | 0 | admin-approved photos |
| `phone` | 0 | the place's public number |
| `instagram` | 0 | bare handle |
| `website` | 0 | scheme-checked at the database |
| `productsAr` | 0 | what it sells, one line each |
| `menuAr` | 0 | priced items |
| `acceptsOrders` | 0 | the business's own switch |
| `salonKind` | 0 | men's or women's, never both |
| `takesQueue` | 0 | the salon's own switch |

## What the catalogue cannot answer yet

Nothing in the catalogue sets `logoUrl`, `bioAr`, `imageUrls`, `phone`, `instagram`, `website`, `productsAr`, `menuAr`, `acceptsOrders`, `salonKind`, `takesQueue`.

That is why the business profile, ordering and the queue render nothing
anywhere on the site today — the panels return `null` rather than being
hidden, so there is no empty state to find. Registering a business is
what fills them, and registration needs the back end (CLAUDE.md, *The
back end is not configured*).

## What wain can do

`src/lib/wain-hub.ts` — one list, drawn by `SearchHub` and served by the
MCP server as `list_actions`, so both surfaces name the same moves.

| id | عربي | english | kind | href |
| --- | --- | --- | --- | --- |
| `call_shouq` | شوق | Call Shouq, the guide, and ask out loud | call | `/search/` |
| `explore` | تصفّح كل الأماكن | Browse the whole catalogue | route | `/explore/` |
| `add_place` | سجّل مكانك مجاناً | Register a Kuwait business on wain, free | route | `/add/` |

## Voice

Two personas, one recorded line set each — a greeting, the generic lines,
and three lines per place (suggestion, short name, best time).

| persona | الاسم | وصف | lines | characters |
| --- | --- | --- | --- | --- |
| `shouq` | شوق | صوت كويتي شبابي — بنت | 162 | 6623 |
| `salem` | سالم | صوت كويتي شبابي — ولد | 162 | 6624 |

**13247 characters** for the whole library, which is the number that argues for caching it in CI rather than re-rendering it — see
CLAUDE.md, *صوت وين cannot be generated from a session*.

