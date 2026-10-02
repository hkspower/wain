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
the `/admin` dashboard's one write path: new garage parts a signed-in
operator has queued through the form there, same atomic-write-and-flush
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

`HUB_ADMINS` and `HUB_ADMIN_AUDIT` hold the admin accounts and their
audit log; see below.

## The admin panel: `/admin`

`http://<hub>/admin` is the operator panel: who is online, the session
leaderboard, crews, the part-proposal queue, and for owners the
accounts and the audit log. It needs a sign-in, and there is no sign-up
page: the first owner is made on the box itself.

    npm run hub:admin -- add <name> --role owner        # asks for the password twice
    npm run hub:admin -- add <name> --role operator
    npm run hub:admin -- list
    npm run hub:admin -- passwd <name>                  # reset; ends their sessions
    npm run hub:admin -- role <name> viewer|operator|owner
    npm run hub:admin -- disable <name> | enable <name> | remove <name>

For a script or a container, pipe the password instead:
`printf '%s' "$PW" | npm run hub:admin -- add ops --role operator --password-stdin`.
The CLI writes the same file the hub reads, and a running hub picks a
change up within two seconds, ending any session it invalidates. Until
an account exists, `/admin` shows these instructions and nothing else.

| role     | can                                                            |
|----------|----------------------------------------------------------------|
| viewer   | read the dashboard and the proposal queue; change own password |
| operator | also queue and drop part proposals                             |
| owner    | also add, change and remove accounts; read the audit log       |

The last enabled owner cannot be demoted, disabled or removed, and
nobody can remove themselves.

What it does to stay shut:

- Passwords are scrypt hashes (12 to 256 characters); the files are
  written atomically, mode 0600. An unknown name and a wrong password
  fail the same way, in the same time.
- Five wrong passwords lock an account for 15 minutes; twenty failures
  from one address lock that address for 15 minutes, right password or
  not. Both answer 429 with `Retry-After`.
- The session is an `HttpOnly`, `SameSite=Strict` cookie; the hub keeps
  only its SHA-256. It ends after `HUB_ADMIN_IDLE_MIN` minutes idle
  (default 30) or `HUB_ADMIN_MAX_HOURS` hours (default 12), on sign-out,
  and when the account's role, password or enabled state changes.
  Sessions are in memory: a restart signs everyone out.
- Every write needs the session's CSRF token and, when a browser sends
  one, an `Origin` that is the hub itself. Admin routes never grant
  CORS, are `no-store` and unframeable, and the pages run under a nonce
  CSP with no inline handlers.
- Every sign-in, failure, lockout and change is in the audit log
  (`HUB_ADMIN_AUDIT`, last 2,000 entries), never with a password or a
  token in it.

Put it behind TLS like the WebSocket. Behind a reverse proxy set
`HUB_TRUST_PROXY=1` so lockouts and the audit log see the client's
address (`X-Forwarded-For`) and the cookie is marked `Secure` from
`X-Forwarded-Proto`; if the proxy does not send that header, set
`HUB_ADMIN_SECURE_COOKIE=1`. Do not set `HUB_TRUST_PROXY` when the hub
is reachable directly: anyone could then pick their own address.

`npm run test:hubadmin` attacks all of the above against a live hub.

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
    docker run -d --name grn-hub -p 8787:8787 -v grn-ledger:/data \
      -e HUB_LEDGER=/data/referrals.json \
      -e HUB_PART_PROPOSALS=/data/part-proposals.json \
      -e HUB_ADMINS=/data/admins.json -e HUB_ADMIN_AUDIT=/data/admin-audit.json \
      grn-hub
    docker exec -it grn-hub node server/admin-cli.mjs add <name> --role owner

`/api/v1/status` is the health check.
