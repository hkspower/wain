# Sporta — automatic FTP deployment plan

## The ask, and what it actually means

> "make ftp connect to be auto all time connect"

**A permanently-open FTP connection is not the thing to build.** An idle FTP
control channel is dropped by the server within minutes, and a held-open socket
would not make a deploy happen anyway. What is actually wanted is:

> **every change reaches www.sporta.com.kw with nobody pressing anything.**

That is what this plan delivers, in two halves that cover different hours of the
day.

---

## What the runner has to be able to do

A deploy is not just an upload. It is: build the site (Vite), run the SEO
generator, bundle the PHP endpoints, audit the result, upload over FTPS, then
verify. So the machine doing it needs Node, the repo, and the FTP credential.

| Runner | Runs 24/7? | Can build? | Has the FTP credential? | Verdict |
|---|---|---|---|---|
| Owner's Mac (`publish:watch`) | Only while it is awake | Yes | Yes — `.env.deploy` | **Half the answer** |
| ~~GitHub Actions~~ | Yes | Yes | Would need 3 secrets | **Removed at the owner's request — see Half 2** |
| n8n cloud | Yes | **No** — cannot run `npm run build` | Yes, already configured | Cannot deploy code alone |
| **hPanel → Advanced → GIT** | Yes | **No** — no Node on shared hosting | It *is* the server | **Possible, but only with a pre-built branch** — see below |
| Hostinger cron | Yes | No — and it cannot fetch a build either | It *is* the server | Rejected — see below |
| Claude's sandbox | — | Yes | **No route and no credential** | Impossible — see below |

### Why n8n cannot do this on its own

The account already has a working **FTP credential** and n8n runs in the cloud,
so it looks like the obvious answer. It is not: n8n moves files, it cannot run
`npm run build`. It could only ever upload an artifact that something else had
already built. That adds a moving part without removing one, so it is not part
of this plan. (n8n remains the right tool for the *image-generation* workflow in
`brand/category-art/n8n-banner-workflow.js`, which only moves files.)

### hPanel's own Git deployment — the hPanel-native option

hPanel has a Git section (**Advanced → GIT**) that clones a repository into a
directory and gives back a webhook URL; adding that URL to GitHub makes every
push pull itself onto the server. It is the only auto-deploy that lives *inside*
hPanel, which is where the owner works, so it deserves a straight answer rather
than being left off the table.

**It cannot build.** Shared hosting has no Node, so whatever branch it watches
must already contain the finished `public_html/` tree — `dist/` plus the bundled
PHP, exactly what the zip contains. Producing that is a build, and a build has
to happen somewhere with Node. So this route does not remove the need for a
build step; it
changes what the Action does, from *uploading the site* to *committing the built
site to a branch*.

What that buys, and it is not nothing:

- **No FTP credential ever leaves hPanel.** The Action holds nothing; the server
  pulls. That is a smaller blast radius than three secrets in a CI system.
- The rollback is `git revert` and a webhook, visible in hPanel.

What it costs:

- **A `.git` directory inside the web root.** Everything ever committed becomes
  one careless rule away from public — every old secret, every rotated password.
  This repository's `.htaccess` blocks it today (`/.git/config`, `/.git/HEAD`
  and `/.git/refs/*` all answer 403, asserted in `storage-audit.mjs` since this
  option was considered) — but it blocks it *because that file is there*, and
  the single most common hPanel mistake is uploading without `.htaccess`.
  Missing `.htaccess` is a bad day on its own; missing `.htaccess` **plus** a
  `.git` in the web root is a source-code leak.
- A second branch of built output, which is a second thing to keep honest.
- `git pull` keeps untracked files, so `knet/config.php` survives — but a clean
  re-clone would not, and nothing in hPanel promises which one it does.

**Verdict: technically viable, but NOT taken.** It is a GitHub-based deploy —
a push to a remote is what triggers it — and the owner has asked for those to be
gone, which is a preference and not a limitation to be worked around. It is
described here so the option is a decision on the record rather than an
oversight, and so nobody proposes it again as if it were new.

Half 1 gives the same result with fewer moving parts and no `.git` anywhere
near the web root.

### Why Hostinger's cron is not the answer either

Cron jobs *do* work without SSH: hPanel runs them, and they can execute PHP. So
the reason to say no is not "no shell", it is what the job would have to do —
download a build from somewhere and unpack it over the web root. That is a
script on the server that writes into `public_html`, which is the thing
`sporta-deploy.php` was, minus the listener. Whoever controls the URL it fetches
controls the site. Not worth it when FTPS already works.

### Why Claude cannot be the runner

Tested, not assumed:

| Check | Result |
|---|---|
| TCP to `46.202.158.211:21` | **blocked** |
| DNS for `ftp.sporta.com.kw` | **no record** (as CLAUDE.md warns) |
| `https://www.sporta.com.kw` | **403** at the egress proxy |
| `.env.deploy` in the repo | absent — credentials are the owner's, and correctly git-ignored |

Claude ships verified artifacts; the runners below do the uploading.

---

## The blocker nobody has hit yet: there is no production branch

This repository holds **several unrelated projects**:

```
main                                  ← an Expo/React Native app. NO sporta-web at all.
claude/sporta-integration-tveo8b      ← the Sporta storefront (only here)
claude/almuhalla-code-editor-...      ← different project
claude/tokyo-racer-kuwait-...         ← different project
claude/wainkw-design-issues-...       ← different project
```

So an automatic deploy cannot simply watch `main` (it would build the wrong
project) and must not watch `claude/*` (every experimental commit would land on
a live store that takes real payments).

**Therefore: create a branch called `sporta-live`.** It is the promotion point.
Nothing reaches the shop until it is merged into that branch. That single
decision is what makes "always on" safe rather than reckless.

---

## Half 1 — while you are at your machine: `npm run publish:watch`

Ready now. No secrets to add, nothing in the cloud, no new attack surface.

```bash
cd sporta-web
npm run publish:watch          # or: npm run publish:watch -- --dry-run
```

It watches `src/`, `public/`, `index.html`, the Tailwind/Vite configs and
`dropin/`; waits 2.5 s for the edits to settle; then runs the ordinary publish.
It never runs two publishes at once — if you save during an upload it queues one
follow-up instead, because two concurrent uploads interleave two versions of the
site on the server. A failed publish does not kill the watcher.

Stops when the machine sleeps — and that is now the whole story. See below.

## Half 2 — while you are asleep: **there is no longer one**

There used to be a GitHub Actions workflow here that built and uploaded from
GitHub's cloud, so deploys kept happening while the owner's machine was off.
**It has been deleted at the owner's request, along with the rest of the
GitHub- and Lovable-era tooling, and it should not be reintroduced.**

That is a real trade and it is worth writing down rather than discovering:

* **What was given up.** Nothing deploys while the Mac is asleep. "Automatic"
  now means "automatic whenever you are working", not "automatic always".
* **What was gained.** No FTP password stored outside the owner's own machine,
  no third party holding a credential to the live store, and one fewer system
  that can publish to a shop taking real payments. The standing preference in
  CLAUDE.md — the owner does not want a CI workflow in their life — is now
  simply true rather than true-with-an-exception.

If "deploy while asleep" is ever wanted again, the honest options are a machine
that stays on, or a scheduled run on a host that has Node — not a PHP endpoint
on the server. See "Never build a PHP deploy endpoint" in CLAUDE.md: the live
site already had one of those once.
---

## What protects the live store on every automatic run

Nothing below is new — automation reuses the guards that already exist, which is
the reason this is safe to run unattended:

- **The file audit gates the upload.** `publish-ftps.mjs` runs
  `file-audit.mjs` and refuses to upload at all if it fails.
- **`config.js` and `knet/config.php` are on a hard-coded never-touch list**, so
  no deploy can overwrite the live database or Tranportal credentials.
- **`index.html` is uploaded last**, so an interrupted run is never a white
  screen.
- **Post-upload verification**: `.htaccess`, `knet/.htaccess` and `index.html`
  are re-downloaded and compared byte for byte; a mismatch fails the run.
- **Nothing is ever deleted** — `mirror` stays `false`.
- **One deploy at a time**, enforced in both halves (a mutex in the watcher, a
  `concurrency` group in the Action, with `cancel-in-progress: false` because a
  cancelled deploy is a half-uploaded site).

## Before trusting any of it: `npm run test:publish`

Automation means `npm run publish` runs with nobody looking, so the run itself
is worth proving first. `npm run test:publish` stands up a **real FTPS server**
with TLS, seeds it with a `config.js`, `knet/config.php`, `pay/config.php` and
`api/config.php` holding pretend-live credentials, and does a genuine publish
into it. Then it checks the things that only matter when nobody is watching:

- all four credential files still hold their original values,
- a file the deploy did not put there is still there (`mirror` is false),
- `index.html`, `.htaccess`, `knet/.htaccess` and `sw.js` arrived byte for byte,
- `index.html` was uploaded **last** of 108,
- the setup tools the owner was told to delete were not put back,
- `.env` and `.env.deploy` were never sent.

It skips itself if pyftpdlib or openssl is absent, rather than passing quietly.

## Order to do this in

1. `cd sporta-web && npm run ftp:doctor` — confirm the real FTP host.
1b. `npm run test:publish` — prove the publish itself, before automating it.
2. Fill `sporta-web/.env.deploy` (git-ignored) and run `npm run publish` **once,
   by hand**, to prove the credentials end to end.
3. `npm run publish:watch` — you now have automatic deploys while you work.
4. Decide on Half 2. If yes: create `sporta-live`, add the three secrets, merge.
5. After the first automatic deploy, run `./scan-server-response.sh`.
