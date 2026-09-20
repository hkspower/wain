# The hub server

The game's backend: one Node process (`server/hub-server.mjs`, plain
`.mjs`, one dependency) that runs the online cruise — live positions at
10 Hz, chat, PvP duels with a server-side referee, crews, referrals,
a session leaderboard, and a REST API the Unity/Unreal ports share.

## Run it

    npm run hub                 # ws://localhost:8787
    HUB_PORT=9000 npm run hub   # another port
    HUB_LEDGER=/data/referrals.json npm run hub
    HUB_PART_PROPOSALS=/data/part-proposals.json npm run hub

The web client finds it through `NEXT_PUBLIC_HUB_WS` (defaults to
`ws://localhost:8787`). In production put TLS in front — any reverse
proxy that speaks WebSocket works — and point `NEXT_PUBLIC_HUB_WS` at
the `wss://` address.

## What persists, and what deliberately does not

`HUB_LEDGER` (default `server/data/referrals.json`) holds referrals and
crews — the promises. It is written atomically, flushed on change, on a
ten-second interval, and on SIGTERM/SIGINT, so a deploy cannot drop it.

`HUB_PART_PROPOSALS` (default `server/data/part-proposals.json`) holds
the `/admin` dashboard's one write path: new garage parts an operator
has queued through the form there, same atomic-write-and-flush
treatment as the ledger. It is an inbox, not a publish button — nothing
here ever writes to `src/game/mods.ts`. Landing a proposal into the game
is still a diff a person writes, the same boundary the dev-only car
editor already draws around `CARS` (`scripts/lib/car-source.mjs`); the
dashboard's "copy" button on each row just saves retyping the six
fields once someone has decided to.

Positions, chat, duels, careers and the lap leaderboard are in-memory
on purpose: they describe a moment, and the server's own comments are
blunt about why pretending otherwise would be a lie. If a persistent
leaderboard is ever wanted it needs accounts first — a name-keyed one
cannot be authenticated, which is documented where the endpoint lives.

## Limits it holds itself to

Connections, per-socket message rate, WebSocket frame size, and the two
name-keyed stores are all bounded; the bounds and each attack they stop
are asserted by `npm run test:hubsec`, which runs the attacks rather
than trusting the code. `npm run test:hubparts` does the same for the
part-proposal queue: every required field checked, the same bilingual
discipline the rest of the catalogue keeps, duplicates refused against
both the shipped catalogue and the queue itself, and the queue's own
cap.

## Docker

    docker build -t grn-hub -f server/Dockerfile .
    docker run -p 8787:8787 -v grn-ledger:/data \
      -e HUB_LEDGER=/data/referrals.json grn-hub

`/api/v1/status` is the health check.
