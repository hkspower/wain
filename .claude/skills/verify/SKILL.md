---
name: verify
description: Verify a wain web change at runtime: build the static export, serve it, drive it in Chromium, and mock the ElevenLabs socket to see what the agent is sent. Use for changes to شوق, سالم, /search, /find, /salem or the agent handover.
---

# Verifying wain at runtime

wain is a static export. Verify by building, serving and driving the pages in
Chromium. Do not count `npm run scan`, the test suites or `flutter test` as
evidence; they are the author's checks.

## Two builds, because the modes differ

- **Free build** (`npm run build`, no `NEXT_PUBLIC_ELEVENLABS_*` set): the live
  site's free mode. Local answers, the phone's speech, no agent. No `convai-*`
  file in `out/media`.
- **Agent build** (`NEXT_PUBLIC_ELEVENLABS_AGENT_ID=agent_1701m1gcrccrethae9y3nyv1e116
  NEXT_PUBLIC_ELEVENLABS_SALEM_AGENT_ID=agent_5101m4wwgr3ae5qat412ezcnffhn
  NEXT_PUBLIC_WAIN_TTS_URL=none npm run build`): the live site. Build it, then
  copy `out/` aside, because the next build overwrites `out/`.

Build both. The live site is an agent build, so a free build can hide an
agent-mode regression. `npm run build` takes a few minutes; give it a timeout.

## Serve

`python3 -m http.server <port> -d <dir>` maps `/search/` to `index.html` and
redirects `/search` to `/search/`. Start your own servers on fresh ports, and
check each port answers with what you expect. `ss` is not installed here, and
another run's server may already hold a port (`EADDRINUSE` while curl still
answers). Do not kill processes you did not start.

## Drive

Playwright is in `node_modules`. Import it by absolute path from a script kept
outside the repo:

```js
import { chromium } from '/home/user/wain/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
```

- **Handover (free build):** `/search/?q=قهوة` → click «رسّلها للربع» → click
  «كمّل مع سالم». The job is in `sessionStorage['wain:job:v1']`. `/salem/` then
  shows «من جواب شوق: «…» — واخترت «…»», and «وينه؟» names the pick.
- **The agent's wire (agent build):** `page.routeWebSocket(/elevenlabs\.io/, ws => …)`
  records every frame the page sends. Reply to `conversation_initiation_client_data`
  with `conversation_initiation_metadata` and a greeting `agent_response`. The
  agent sees `contextual_update` before the first `user_message`.
- **The call (agent build):** `/find/` → `button[aria-controls="wain-ai-panel"]`
  → inside `#wain-ai-panel elevenlabs-convai`, «بدء مكالمة», then «قبول». The
  widget needs its config from `api.elevenlabs.io/…/widget`; the route returns
  `WIDGET_CONFIG`, which is line 69 of `tests/shouq-widget-csp.test.mjs`. Launch
  with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` and
  grant `microphone`.
- **Her tools from the mock:** send
  `{"type":"client_tool_call","client_tool_call":{"tool_name":"show_places","tool_call_id":"t1","parameters":{"query":"بحر"}}}`
  from the socket. The widget answers with `client_tool_result`.

## Gotchas

- During a live call the sheet is full-screen and covers the page. A link under
  it is visible and in the DOM but cannot be tapped. Check with `elementFromPoint`.
- A pick on /search is written to the job only when «كمّل مع سالم» is pressed.
  A share click alone writes nothing.
- The /search result rows set the pointed-at place on `pointerenter` (mouse
  only). Scrolling under a stationary mouse changes the pick.
- `/api/wain.php` answers 404 on a static server. That is expected.
- Clean up your servers and your scratch scripts. Do not commit either.
