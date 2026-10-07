# شوق and سالم — the agent as ElevenLabs holds it (imported 7 October)

**There is one wain agent, not two.** The workspace holds three agents; only
`agent_1701m1gcrccrethae9y3nyv1e116` («شوق — وين AI», tags `wain shouq wainkw.com`) is wain's.
The other two (`agent_7601k…` «Agent agent», `agent_0001k…` «البحار») belong to the almuhallab
project. **سالم is not a separate agent**: `/salem` and the app's chat open a text-only session
against this same agent (`conversation.text_only` override). His voice (Mustafa,
`TbzNVcMOFmKd8tUT5liY`) is the `tts.voice_id` override, which the agent allows.

## What is in this folder

`shouq-agtvrsn_1701m48bqsz4efwadjb8eabgawwt.json` — the full configuration of the last **tuned**
version (6 October, before the dashboard rewrite): the ~25K-character prompt, `claude-opus-5-5`
at temperature 0, the three tools, the 25 attached test ids, the KB v5 document, ASR keywords,
widget and guardrail settings, origin allowlist. It is the document `agents_get` returns for
that `version_id`, minus the account-permission block.

Restoring it is a dashboard action (there is no restore-version call, and a branch forked from it
would not bring the prompt back through a merge). Read-only here; nothing in the repository sends it.

## The live version (`agtvrsn_9001m48eqdd7fef8fykqqtrpqtx9`), summarised, not copied

Not stored verbatim: the prompt there is the short dashboard rewrite that scored 18 of 25 against
45–49 of 50 for the tuned one (see CLAUDE.md, «7 October: widget 0.19.0, and a prompt rewritten
in the dashboard»). Read it with `agents_get`; the facts that matter:

| | live now |
|---|---|
| LLM | `gemini-3.5-flash`, temperature 0.32 |
| Voice | Maryam `3AH0h1SXwwhE8vUUWuQW`, `eleven_v4`, expressive, stability 0.35, similarity 0.75, speed 1.02, phone filter |
| Prompt | ~5K characters, generic personality / environment / tone + a Sabah Al-Salem section |
| Tools | `show_places`, `open_place` (client), `report_gap` (webhook → n8n `wain-gap`), `end_call`, `language_detection`, `skip_turn` |
| Knowledge base | document `ynRNIOiliu2vKBN4d9H6` (v5), RAG off |
| Auth | no auth; allowlist `www.wainkw.com`, `wainkw.com`, `staging.wainkw.com`; `require_origin_header` false |
| Overrides allowed | `tts.voice_id`, `agent.prompt.llm`, `conversation.text_only` |
| Limits | 600 s a call, `daily_limit` 5000, recording on, retention unlimited |
| Tests | the same 25 attached tests |

Mirror of the prompt in the repository: `scripts/wain-ai-brief.mjs` → `docs/wain-ai-agent.md`
(hand-adapted; see CLAUDE.md before regenerating).
