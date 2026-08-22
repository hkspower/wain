# Scanning the live shop

`scripts/site-scan.mjs` checks www.sporta.com.kw from outside: what it serves,
what it must never serve, whether every page renders on a phone in Arabic, and
whether the catalogue and both bank dropins answer.

## It cannot be run from the Claude session

This container has no route to the internet. Not to sporta.com.kw and not to
anything else — with the session proxy switched off the browser gets **403 for
every host**, example.com included, so it is the environment's egress control
and not the shop refusing:

```
$ curl https://www.sporta.com.kw/
curl: (56) CONNECT tunnel failed, response 403

$ chromium --no-proxy-server https://example.com/
403
```

DNS resolves (the domain points at Hostinger's CDN); the packets do not leave.

## Run it on your own machine

Node 18 or newer.

```sh
mkdir sporta-scan && cd sporta-scan
npm init -y
npm i playwright
npx playwright install chromium
# copy scripts/site-scan.mjs from the source zip into this folder
node site-scan.mjs
```

Point it somewhere else with `BASE`:

```sh
BASE=https://sporta.com.kw node site-scan.mjs      # the apex, to check the redirect
BASE=http://127.0.0.1:4300 node site-scan.mjs      # a local copy
```

Exit code 0 means nothing failed. Lines marked `warn` are worth a look but are
not failures; `--` lines are notes, usually explaining why a check could not
apply.

## Or open the shop to this session

The environment's network policy is chosen when the environment is created —
see https://code.claude.com/docs/en/claude-code-on-the-web. With
`www.sporta.com.kw` allowed, `node scripts/site-scan.mjs` runs here with no
changes and I can read the result directly.

## What it will not do

- It never submits a payment. It asks each dropin for an order that does not
  exist and checks that it is refused.
- It does not sign in to /backends, and it does not POST anywhere.
- It reads only. Nothing it does can change an order, a price or a stock count.
