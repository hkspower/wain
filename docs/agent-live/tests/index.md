# شوق's attached tests

The 25 tests attached to agent `agent_1701m1gcrccrethae9y3nyv1e116`, exported
verbatim with `agents_get_test` on 7 October 2026. One JSON file per test, named
by its id. These files are a copy: the tests live in ElevenLabs. There is no
update-test tool, so a changed test gets a new id.

| id | name | type | what it checks |
|---|---|---|---|
| `test_3101m1rj0dk8freb7sthadfnn8sr` | ذكاء ١ — قيود متعددة (منطقة + عيال + حر) | llm | Salmiya + kids + heat: the place must be air-conditioned, child-friendly and in or near Salmiya. |
| `test_8701m1rj14etezk8z322ppmyfxzg` | ذكاء ٢ — ترفض الطلب لمّا الوقت غلط (أغسطس الظهر) | llm | The caller asks for the beach at 1pm in August: she declines and offers after sunset or an air-conditioned place instead. |
| `test_1901m1rj1y6sevp92sqeqmw1v2kq` | ذكاء ٣ — ترتّب الليلة بالمسافات | llm | Dinner then coffee: two places that are actually close in the KB's distance data, and no driving times in minutes. |
| `test_7101m1rj34mnf4gbdarm2jt8kd5c` | ذكاء ٤ — تعرف إنها ما تدري | llm | "Is there a Starbucks in the Avenues, and how much is a cappuccino?": she confirms neither the shop nor any price. |
| `test_7001m1rj3vceefksqwtdwnfmr4nx` | ذكاء ٥ — الجمعة الصبح | llm | Friday morning outing: she says Friday morning is quiet or closed and suggests later (Souq al-Jumaa is the allowed exception). |
| `test_8301m1rj4takf2mbfqmkq6bm9c4p` | ذكاء ٦ — ميزانية محدودة بدون أسعار | llm | "I only have 5 KD": a budget place from the KB, and no dinar or fils figures. |
| `test_4401m1rs9ms6ec5arbw48pxgxxae` | ذكاء ٧ — تعرف الأماكن الجديدة (KB v4) | llm | Sheikh Jaber Causeway is described from the KB (36 km, to Subiya, the drive itself, sunset) with no invented tolls or hours. |
| `test_6101m1rhf19yegztvzn79pfrbhtv` | وين — ذيل قاعدة المعرفة (المناطق القريبة) | llm | Checks the end of the KB is still there: areas near Al-Zahra are Al-Omariya and Al-Rai. |
| `test_3901m1rhce1de1pv2xqcg9ex7nxw` | وين — المسافة بين مكانين (KB v3) | llm | Kuwait Towers to Souq Sharq is ~1.2 km, in Kuwaiti dialect, with no drive time and no call-centre phrasing. |
| `test_0801m1wsazjheg8syp2eap0zbnxj` | لهجة — يفهم السلنق ويرد بكويتي | llm | Heavy Kuwaiti slang: she understands it, recommends a seaside evening place for friends, answers in dialect with no MSA, and ends on a question. |
| `test_4901m1xhe048f26atne1ybjebf5w` | لهجة ٢ — يفهم المشاعر والسلنق (طفشان + ميت جوع + طقة حر + حالتي حالة) | llm | Bored, starving, hot and broke said as slang: a cheap Kuwaiti-food place that respects the heat, no prices, no clarifying question. |
| `test_7501m1xhfeswfy8864fpbek6mph2` | رد فعل — يسمع الاعتراض (بعيد + زحمة) ويرشّح ثاني | llm | After "too far, I'm in Fahaheel, and it's crowded" she accepts the objection and suggests a closer place (ideally Al-Kout Mall). |
| `test_6701m22c5b4nfdbrdmaespgaa9f3` | تسجيل مكان — صاحب كافيه | llm | Café owner asks how to register: free, no account, four fields, review with no promised date, the owner fills in «سجّل مكانك» himself, ends on a question. |
| `test_8501m259crshek7tab477rq9pq85` | منطق ١ — الساعة ١١ بالليل: ترشّح مكان وقته الليل، مو مكان وقته الصبح | llm | At 11pm she suggests a place whose best time is evening or night, not a morning place. |
| `test_2501m259d4enfbaa6v3m73rw2v15` | منطق ٢ — قيدين متعارضين (بحر + مكيّف): تلقى المكان اللي يجمعهم | llm | Sea + air-conditioned: she finds a place that has both (Souq Sharq, Marina Mall, Al-Kout Mall, Scientific Center). |
| `test_0301m259dhydf5xtef7zp5wxt7h6` | منطق ٣ — عنده ساعة وحدة بس: تستبعد أماكن «يوم كامل» والبعيد | llm | One free hour in Kuwait City: a short stop nearby, not a full-day place or a long drive. |
| `test_8401m259dv48fhss0fwjb7qkay8e` | منطق ٤ — طلب له جواب واحد (زبيدي طازج): تجاوب على طول بدون ما تسأل وين هو | llm | Fresh zubaidi: she names the Fish Market right away instead of asking a clarifying question. |
| `test_2501m259e8gmfzta3q36as83ps0n` | منطق ٥ — مع الوالدة كبيرة بالسن: مكان فيه قعدة، مو مشي ولا يوم كامل | llm | Elderly mother who cannot walk much: a place to sit down, not a walk or a full-day place. |
| `test_1301m259vr6te7qrbdmgeecvkr6f` | منطق ٦ — ما قال متى (صيف): تفترض الحين، والمكشوف عقب المغرب مو «العصر» | llm | Seafront walk with no time given, in summer: after sunset (or an air-conditioned sea view), not the KB's year-round "late afternoon". |
| `test_9301m259spdhej58jz87m2x4yg03` | شكل — السؤال يجي قبل نداء show_places، مو بداله | llm | Format check: what she says right before a show_places/open_place call ends with a short question. |
| `test_9601m289k7kyfrcb6ykakpme0rrt` | report_gap يننادى فعلاً عند الفجوة | tool | The caller insists on a Japanese restaurant, which the catalogue lacks: she actually calls the report_gap webhook tool (`tool_4801m27x39vheb8999yyaggkwhjt`). |
| `test_3301m289nj8ze2zs94bkchp2q3z0` | فجوة — طلب ما في الكتالوق | simulation | Simulated caller wants sushi in Jabriya: no invented Japanese place, she offers the nearest alternative, makes no promise to add it, and stays in Kuwaiti Arabic. |
| `test_8901m27zd4wkexq8esxnvkt6cmj8` | مو فجوة — طلب في الكتالوق | simulation | Simulated caller wants authentic Kuwaiti food: she recommends a catalogue place and never calls report_gap. |
| `test_7901m2wvg8r5e2qaeff8rqre773g` | شكل — الإعادة بكلمتين ثم مكان بالاسم (قهوة على البحر، سبتمبر) | llm | Format check: echo the request in two to four words, name a KB entry, give an after-sunset time (September), and end with a question. |
| `test_7601m2wbb5ssfafr049ebab0v8mc` | بدر — أحسن أماكن ألعاب للعيال | simulation | Father of a 4- and 7-year-old over several turns: dialect throughout, real kids' places, details on the place he names, no promises she can't keep, each turn ends on a question. |

Counts: 20 llm, 1 tool, 4 simulation.
