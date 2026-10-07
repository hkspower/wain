# شوق and سالم — the agent as ElevenLabs holds it

**There is one wain agent, not two.** The workspace holds three agents; only
`agent_1701m1gcrccrethae9y3nyv1e116` («شوق — وين AI», tags `wain shouq wainkw.com`) is wain's.
The other two (`agent_7601k…` «Agent agent», `agent_0001k…` «البحار») belong to the almuhallab
project. **سالم is not a separate agent**: `/salem` and the app's chat open a text-only session
against this same agent (`conversation.text_only` override). His voice (Mustafa,
`TbzNVcMOFmKd8tUT5liY`) is the `tts.voice_id` override, which the agent allows.

## Live now (7 October): Main is the tuned agent, 100% of traffic

`shouq-agtvrsn_6801m4ass4apec1v9apsx2svzscw.json` — Main's configuration as it serves callers,
read back with `agents_get` after the upload («upload agent shoug and salem», 7 October).

Main had the 6 October dashboard rewrite (18 of 25). The tuned agent was first restored on a
branch, `tuned-restore` (24 of 25, see below), and then written onto Main itself so the dashboard's
own test widget and every caller hear the same agent. A merge could not do it: Main had changed
the prompt and the branch had not, so a three-way merge keeps Main's text (`merge_branch_preview`
showed only `llm` moving). Written instead through the per-section update tools:

| field | was on Main | now |
|---|---|---|
| prompt | ~5K rewrite | the tuned ~25K, **byte-identical** to `tuned-restore` (compared after the write) |
| LLM / temperature | `gemini-3.5-flash` / 0.32 | `gemini-3.8-flash` / 0 |
| first message | «أهلاً معاك شوق من فريق وين دوت كوم…» | «هلا والله! أنا شوق من «وين»…» |
| TTS speed / effect | 1.02, phone filter | 1.06, no filter |
| turn | timeout 5, normal, three fillers at 2.5 s | timeout 7, eager, «ثانية وحدة…» once at 3 s |
| background sound | restaurant at 0.01 | none |

Kept from Main on purpose, the only remaining difference from `tuned-restore`: 31 extra ASR
keywords (Sabah Al-Salem areas, coffee words) and six extra «don't interrupt» terms
(«تسلم», «هلا»…). Both only widen recognition. Deployment: Main 100%, `tuned-restore` 0% (kept,
not archived, as the known-good copy).

**Not re-tested on Main.** The suite (24 of 25) ran on `tuned-restore`; Main differs from it only by
the keyword and ignore-term supersets above.

## Full import (7 October) — everything ElevenLabs holds for this agent

| path | what | how it was taken |
|---|---|---|
| `shouq-agent-full.json` | the whole agent document at Main's head: conversation config, widget, evaluation criteria, guardrails, auth, privacy, overrides, attached test ids, procedures, workflow | `agents_get` with no `fields`, saved from the tool's own file, minus the account-permission block |
| `tools/{show_places,open_place,report_gap}.json` | the three custom tools as standalone records, with their ids and usage counts | `agents_get_tool` |
| `tests/<id>.json`, `tests/index.md` | the 25 attached tests | `agents_get_test`, one by one |
| `knowledge-base/<id>.md` + `.meta.json` | all eight knowledge-base documents in the workspace (only `ynRNIOiliu2vKBN4d9H6`, v5, is attached) | URL documents (v3–v7): the file at the commit each one is pinned to — the exact bytes ElevenLabs fetched. Text documents (v1, v2, «المطاعم والكافيهات العصرية الحديثة»): the text ElevenLabs returns, sizes equal to its `size_bytes` |
| `procedure-technical-issue.json` | the one procedure on Main («When user reports a technical issue», a generic dashboard template) | `agents_get_procedure` |
| `branches.json` | the five branches and the live split | `agents_list_branches` |

**Not imported, on purpose:** conversation transcripts and recordings (callers' voices and words — personal
data, and they stay where `privacy` says they are kept), test-run history, and account or billing data.

| KB id | version | size | attached |
|---|---|---|---|
| `ynRNIOiliu2vKBN4d9H6` | v5, commit `e4af2de0` | 73,002 | **yes** |
| `HVj2QHQpi6vhaxukWMOe` | v7, `8215f7d6` (rolled back) | 74,967 | no |
| `QuTdGKOBOWd3gPSCW80m` | v6, `24b18c04` (rolled back) | 76,806 | no |
| `xTqmrvefgSbzdcEyFjtG` | v4, `ab034b04` | 73,002 | no |
| `42rJoevyIOEFNEZ7TfCW` | v3, `1ab701ab` | 61,962 | no |
| `om8zzegLlJKtl4P5cyNb` | v2, text | 49,767 | no |
| `WzkQSLRq7en4DX17AIyL` | v1, text | 22,420 | no |
| `ANkRiRs8Xxy5poyujeTJ` | «المطاعم والكافيهات العصرية الحديثة», text | 3,496 | no — names places that are not in the catalogue |

## History in this folder

- `shouq-agtvrsn_1701m48bqsz4efwadjb8eabgawwt.json` — the last tuned version before the dashboard
  rewrite (6 October): the same prompt, `claude-opus-5-5` at temperature 0, which never answered
  inside the 4 s cascade.
- `shouq-agtvrsn_9001m48eqdd7fef8fykqqtrpqtx9.json` — Main's dashboard rewrite (gemini-3.5-flash,
  temperature 0.32, the 5K prompt with the Sabah Al-Salem section), saved whole before it was replaced.
- `tuned-restore` (`agtbrch_6101m4aqdpy7ej6aezd2qv2qjqeq`), forked from 1701 with `llm` →
  `gemini-3.8-flash`: suite `suite_3701m4aqfdf5fz5azjzqh990k7t6`, **24 of 25**; the one failure is the
  known turn-ends-at-a-tool-call shape («قهوة على البحر»).

## Unchanged facts

| | |
|---|---|
| Voice | Maryam `3AH0h1SXwwhE8vUUWuQW`, `eleven_v4`, expressive, stability 0.35, similarity 0.75 |
| Tools | `show_places`, `open_place` (client — run in the visitor's browser on wainkw.com; the dashboard's test widget does not define them, hence «not defined on client» there), `report_gap` (webhook → n8n `wain-gap`), `end_call`, `language_detection`, `skip_turn` |
| Knowledge base | document `ynRNIOiliu2vKBN4d9H6` (v5), RAG off |
| Auth | no auth; allowlist `www.wainkw.com`, `wainkw.com`, `staging.wainkw.com`; `require_origin_header` false |
| Overrides allowed | `tts.voice_id`, `agent.prompt.llm`, `conversation.text_only` |
| Limits | 600 s a call, `daily_limit` 5000, recording on, retention unlimited |
| Tests | the same 25 attached tests |

Mirror of the prompt in the repository: `scripts/wain-ai-brief.mjs` → `docs/wain-ai-agent.md`
(hand-adapted; see CLAUDE.md before regenerating).
