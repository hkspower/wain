# How a call centre trains an agent — and what of it applies to شوق

شوق was given four call-centre habits in commit `8d59343`: read back what you
heard, say what you put on screen, hand the turn back, close in one sentence.
They were written from intuition about what a service call sounds like. They
turned out to be right, but «turned out to be right» is not a method, and four
habits is not a training programme.

This is the research behind them, what else it says, and — the part that
matters — what it exposes in شوق's **live configuration** that nobody had
looked at.

---

## 1. First, the thing that would mislead you

Search «call centre agent training» and most of what comes back is about
**complaint handling**: de-escalation, the HEARD method, angry customers,
apology and recovery, escalation paths. The industry's centre of gravity is
inbound support.

**شوق takes zero complaints.** Nobody calls وين because something broke.
They call because they do not know where to go tonight. She is a **concierge**,
not a support agent — the closest real-world job is a hotel concierge or a
front-desk recommendation, not a helpdesk.

So the training corpus splits in three, and the split has to be made before
anything is copied:

| Transfers directly | Transfers with changes | Does not apply |
| --- | --- | --- |
| Call opening and greeting | QA scorecard (reweighted) | De-escalation / HEARD |
| Read-back and confirmation | Discovery questioning | Apology and recovery |
| Turn-taking and closing | Product knowledge | Escalation to a supervisor |
| Never inventing an answer | Coaching → prompt revision | Average Handle Time as a target |
| Calibration (agreeing what «good» is) | Compliance → the honesty rules | Upsell / cross-sell |

The single most-repeated piece of call-centre advice — *empathise with the
customer's frustration* — is close to useless here and actively harmful if
copied, because it produces an agent that sympathises with someone who is
merely undecided. «أعتذر عن الإزعاج» to a man asking where to get coffee is
worse than saying nothing.

---

## 2. How a real programme is actually structured

Consistent across the training guides:

- **Duration.** One to three weeks of structured onboarding, then *continuous*
  coaching and monitoring. Nobody treats training as a one-off event.
- **Curriculum order.** Orientation → product/service knowledge → quality
  standards and KPIs → compliance and data-privacy rules → handling
  escalations → time management.
- **Method.** Blended, and **role-play and simulated calls** are named in every
  source as the thing that actually prepares an agent, rather than reading.
- **Measured by.** CSAT, First Call Resolution, Average Handle Time, quality
  score, escalation rate.

The useful translation for an LLM agent is not «شوق needs two weeks». It is
the **shape**:

| Human agent | شوق |
| --- | --- |
| Product knowledge training | `docs/wain-ai-kb.md` — the 44 places |
| Company procedure manual | the system prompt |
| Compliance rules | «لا تخترعين مكان» · «لا تعطين مواعيد دوام دقيقة» |
| Role-play and simulated calls | ElevenLabs agent tests (`agents_run_tests`) |
| Coaching after a bad call | reading transcripts → editing the prompt |
| Refresher when the product changes | `npm run ai:brief` → re-import the KB |

Every row on the left exists on the right. **Only one of them is currently
being run regularly**, which is the honest state of things.

---

## 3. The QA scorecard — the part that transfers best

This is the most valuable import, because it turns «is she any good?» into
something with an answer.

A scorecard breaks a call into measurable criteria so that any two reviewers
reach the same verdict. The standard call-flow spine is:

1. **Opening and disclosures** — greeting, identification
2. **Discovery** — the questions that establish what is actually wanted
3. **Presentation** — the recommendation itself
4. **Objection handling** — «مو هذا اللي أبيه»
5. **Compliance** — the things that must and must not be said
6. **Closing** — how the call ends

And the weighting rule, which is the part people get wrong: **compliance and
resolution accuracy are weighted more heavily than the exact wording of the
greeting.** A perfect greeting on a call that invented a phone number is a
failed call.

**Calibration** is the other half. QA reviewers periodically score the *same*
call and argue until they converge, so an agent is judged consistently no
matter who listens. For شوق, the equivalent is the success-condition text in
an agent test: writing it down is what stops «good answer» drifting.

---

## 4. Discovery — the concierge half

From hospitality/concierge phone standards rather than the support literature:

- **Thorough questioning to understand need** before recommending — but on a
  phone that means *one* question, not a form. شوق's prompt already says one
  clarifying question only when the request is ambiguous.
- **Knowledgeable local recommendation**, in the guest's own frame.
- **Prioritise on-property options.** The وين translation is exact and already
  enforced: recommend from the 44, and say so plainly when nothing fits rather
  than reaching outside the knowledge base.
- **Use the guest's own words back.** This is the read-back habit, arrived at
  independently — the concierge literature has it as standard practice.

---

## 5. What voice adds that phone-agent training never had to say

A human agent does not need to be taught to notice that someone has stopped
talking. A voice agent does, and this is where the 2026 voice-AI material adds
something the call-centre material cannot.

**The timing budget**, which is the part with real numbers:

| Measure | Target |
| --- | --- |
| Human turn transitions in natural conversation | 0–200 ms — the bar callers unconsciously measure against |
| Barge-in: end-of-user-speech → stop the agent's audio | under 150 ms |
| Turn gap: end-of-agent-speech → first audio of next turn | 200–450 ms |
| Voice-activity detection before treating speech as an interruption | ~200–300 ms sustained, classifier confidence > 0.7 |

**Backchannels versus interruptions.** This is the finding that matters most
for an Arabic agent and it has no equivalent in human training, because a human
simply *knows*. Kuwaiti speakers backchannel constantly — «إي»، «إي إي»،
«زين»، «تمام»، «صج؟»، «أها» — and these are not attempts to take the floor.
A voice agent that treats every sound as a barge-in stops mid-sentence every
time the caller agrees with it. Production systems keep an explicit
ignore-terms list for exactly this.

**Fillers for latency.** When the model is thinking, silence reads as a dropped
call. The standard remedy is a short filler phrase after a soft timeout.

**Design the unhappy path first.** The recurring 2026 conversation-design
advice: the happy path demos well, but recovery is what earns trust — decide
what the agent does when it does not know, and when it mishears.

**Dialect is a first-class problem.** Speech recognition has historically done
well on MSA and poorly on regional dialects; a system trained mostly on MSA
hears Khaleeji as close to noise. Gulf call centres address this with native
linguists in QA who score not only script adherence but tone and correct
register — the same reason `npm run audit:arabic` exists here.

**How the industry evaluates voice agents** — worth naming because it is
exactly what was built for شوق today: simulate conversations, score the
transcripts against written success criteria with an LLM as judge, and re-run
them as regression tests. The recommended four things to score: did it *hear*
correctly, did it *respond* correctly, did it call *tools* correctly, and did
it *feel* right (turn-taking and latency).

---

## 6. What شوق's live configuration actually says

Read against the above, on agent `agent_1701m1gcrccrethae9y3nyv1e116`. These
are observations, not changes — nothing here has been altered.

| Setting | Value | What the research says about it |
| --- | --- | --- |
| `interruption_ignore_terms` | `[]` | **Nothing is exempt.** Every «إي» and «زين» from the caller can cut her off mid-recommendation. The one gap with a direct, cheap fix. |
| `asr.keywords` | `[]` | No keyword boosting, on an agent whose entire vocabulary is Kuwaiti place names and dialect food words — «المباركية»، «الأفنيوز»، «مچبوس»، «كشتة» — against a recogniser that is weakest on exactly this. |
| `soft_timeout_config.message` | `"Hhmmmm...yeah."` | An **English** filler on an `ar` agent. Currently inert (`timeout_seconds: -1`), so no caller has heard it — but it is the default, and the moment anyone enables fillers to cover latency, a Kuwaiti guide says «Hhmmmm…yeah.» |
| `turn_timeout` | `7` seconds | Seven seconds of silence before she re-engages. Her own prompt (habit ٧) says silence on a phone means the call dropped. The prompt and the config disagree. |
| `max_duration_seconds` | `600` | A ten-minute ceiling on «وين أطلع اليوم؟». |
| `evaluation.criteria` | `[]` | **No QA scorecard exists.** Every call is unscored. This is the single biggest gap against call-centre practice. |
| `testing.attached_tests` | `[]` | The two tests written today are not attached, so nothing runs them automatically. |
| `speculative_turn` | `false` | Off. Trades LLM cost for lower perceived latency; worth measuring, not assuming. |
| `background_sound` | volume + crossfade set, **no `source_id`** | Half-configured: the knobs are set but no sound is selected, so it does nothing. |
| `optimize_streaming_latency` | `3` | A no-op — the field is deprecated and ignored. Reading it as a live latency setting would mislead. |
| `llm` / `temperature` | `gemini-2.5-flash` / `0` | Right call for an agent that must not invent places. |

---

## 7. A scorecard for شوق, if one is wanted

Weighted the way the literature says to weight it — compliance and accuracy
above phrasing. Each row is expressible as an ElevenLabs evaluation criterion
(scored per conversation) or as an agent test (scored per scripted turn).

| # | Criterion | Weight | Fails when |
| --- | --- | --- | --- |
| 1 | **Grounded** — every place, area, distance and price level comes from the KB | 30 | Any invented place, phone number, address or price |
| 2 | **Honest about limits** — says so rather than guessing | 15 | Gives opening hours, a drive time in minutes, or a governorate |
| 3 | **Answered the actual question** — the recommendation fits what was asked | 15 | Recommends a beach at noon in August; ignores «مع العيال» |
| 4 | **Read back before answering** | 10 | Answers a misheard question at length without confirming |
| 5 | **Said what changed on screen** | 10 | Calls `show_places` silently |
| 6 | **Handed the turn back** | 10 | Ends on a statement and goes quiet |
| 7 | **Register** — Kuwaiti, not MSA, not call-centre boilerplate | 10 | «يرجى الانتظار»، «كيف يمكنني مساعدتك»، «تحت أمرك» |

Rows 1–3 are the call. Rows 4–7 are the manner. A call that scores full marks
on 4–7 and fails row 1 is a failed call, which is what the weighting says.

Two tests exist against this already — both passing:

- **المسافة بين مكانين** — «أبراج الكويت بعيدة عن سوق شرق؟» → she gives 1.2 km,
  in dialect, with no drive time. Covers rows 1, 2 and 7.
- **ذيل قاعدة المعرفة** — «أنا ساكن بالزهراء، شنو المناطق القريبة؟» →
  «العمرية والري». Covers row 1 and doubles as a truncation check on the 61 KB
  knowledge base.

Rows 3–6 have no test yet.

---

## 8. What was deliberately not imported

- **Average Handle Time.** A target that makes an agent hurry someone who is
  choosing where to spend their evening. FCR-style «did she actually answer
  it» is the right measure; speed is not.
- **Upsell and cross-sell.** وين recommends; it does not sell.
- **Verbatim scripts.** The reason the four habits are written as *habits* and
  not as sentences: a script in dialect read by a model becomes stilted
  instantly, and the prompt already bans exactly the phrases a script would
  introduce.
- **Hold, transfer, escalation.** There is nobody to transfer to. «يرجى
  الانتظار» is banned in the prompt for this reason — a hold message on a call
  with no hold is theatre.

---

## Sources

Call-centre training and QA:

- [Contact Center Training: Best Practices & Program Guide — Calabrio](https://www.calabrio.com/blog/contact-center-training-guide/)
- [20 best practices for call center agent training — Aircall](https://aircall.io/blog/call-center/20-best-practices-for-call-center-agent-training/)
- [Designing a Best Practice Call Center QA Scorecard — VeriQuest](https://www.verequest.com/post/designing-a-call-center-quality-assurance-scorecard)
- [Call Center QA Scorecards: 7 Tips — Verint](https://www.verint.com/blog/quality-assurance-qa-scorecard/)
- [Call center quality assurance scorecard guide — Alpharun](https://www.alpharun.com/blog/call-center-quality-assurance-scorecard)
- [Contact Center Calibration — C2Perform](https://www.c2perform.com/blog/contact-center-calibration-supervisor-development)
- [Call Center Agent Coaching: Techniques & Templates — Balto](https://www.balto.ai/blog/call-center-agent-coaching/)

De-escalation and acknowledgement (the part deliberately not imported):

- [The HEARD Method — Pollack Peacebuilding](https://pollackpeacebuilding.com/blog/heard-method/)
- [Acknowledging Statements for the Contact Center — Verint](https://www.verint.com/blog/words-actions-and-acknowledgements-the-tools-of-the-trade-for-contact-center-agents/)

Concierge and hospitality phone standards:

- [Hotel Concierge Service Checklist / Guest Experience QA — Mitti](https://mitti.com/library/hospitality/concierge-ww-request-q-cp-xo5ckhcoovcfmzff)
- [Exceptional Concierge Services: Training for the Ultimate Guest Experience](https://traininghotels.com/2024/08/26/exceptional-concierge-services-training-for-the-ultimate-guest-experience/)

Voice-agent specifics — turn-taking, barge-in, latency, evaluation:

- [Voice Agent Interruption Handling: Barge-In, Backchannels, and Turn Detection — Hamming AI](https://hamming.ai/resources/voice-agent-interruption-handling-runbook)
- [Voice AI Barge-In and Turn-Taking: A 2026 Implementation Guide — Future AGI](https://futureagi.com/blog/voice-ai-barge-in-turn-taking-2026/)
- [Core Latency in AI Voice Agents — Twilio](https://www.twilio.com/en-us/blog/developers/best-practices/guide-core-latency-ai-voice-agents)
- [Conversational AI Design: A Practitioner's Guide — Voiceflow](https://www.voiceflow.com/blog/conversation-design)
- [Voice AI Agent Evaluation: The Complete Guide — Coval](https://www.coval.ai/blog/voice-ai-agent-evaluation-guide/)
- [A Developer's Guide to Voice AI Evaluation Metrics — Cekura](https://www.cekura.ai/blogs/voice-ai-evaluation-metrics)

Gulf Arabic and dialect:

- [How AI Voice Agents Understand Gulf Arabic Dialects — Ehlan](https://blog.ehlan.ai/guide/ai-voice-agents-for-gulf-arabic-dialects/)
- [AI Agents in Arabic: Localizing Voice Tech for the Gulf Market — Brightcall](https://brightcall.ai/blog/ai-agents-in-arabic-localizing-voice-tech-for-the-gulf-market)
