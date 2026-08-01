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
| GitHub Actions | **Yes** | Yes | Needs 3 secrets added | **The other half** |
| n8n cloud | Yes | **No** — cannot run `npm run build` | Yes, already configured | Cannot deploy code alone |
| Hostinger cron | Yes | No — the account has no shell (`/sbin/nologin`), SSH is off for good | It *is* the server | Not available |
| Claude's sandbox | — | Yes | **No route and no credential** | Impossible — see below |

### Why n8n cannot do this on its own

The account already has a working **FTP credential** and n8n runs in the cloud,
so it looks like the obvious answer. It is not: n8n moves files, it cannot run
`npm run build`. It could only ever upload an artifact that something else had
already built. That adds a moving part without removing one, so it is not part
of this plan. (n8n remains the right tool for the *image-generation* workflow in
`brand/category-art/n8n-banner-workflow.js`, which only moves files.)

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

Ready now. No secrets to add, no GitHub, no new attack surface.

```bash
cd sporta-web
npm run publish:watch          # or: npm run publish:watch -- --dry-run
```

It watches `src/`, `public/`, `index.html`, the Tailwind/Vite configs and
`dropin/`; waits 2.5 s for the edits to settle; then runs the ordinary publish.
It never runs two publishes at once — if you save during an upload it queues one
follow-up instead, because two concurrent uploads interleave two versions of the
site on the server. A failed publish does not kill the watcher.

Stops when the machine sleeps. That is what Half 2 is for.

## Half 2 — while you are asleep: GitHub Actions

`.github/workflows/deploy-sporta.yml`, already in the repo and **deliberately
inert**. It cannot deploy anything until both of these exist, so committing it
was safe:

1. the branch **`sporta-live`**, and
2. the repository secrets **`FTP_HOST`**, **`FTP_USER`**, **`FTP_PASSWORD`**
   (Settings → Secrets and variables → Actions). Values come from
   hPanel → Files → FTP Accounts. **Do not guess the host** — run
   `npm run ftp:doctor` locally to find the right one.

Then the loop is: merge into `sporta-live` → it builds, audits, uploads,
verifies. There is also a **Run workflow** button for redeploying the current
`sporta-live` without inventing a commit, which is the rollback path.

### Note on the standing "no GitHub workflow" preference

CLAUDE.md records: *"No GitHub-based workflow is required of the user."* Half 2
uses GitHub, so it is worth being explicit: it does not put GitHub **in your
way** — you never open it, and the hPanel/zip route and `npm run publish` both
keep working exactly as before. But it is the only runner that exists while your
machine is off, so "auto all the time" is not achievable without something like
it. **If you would rather not have it, delete the workflow file and Half 1 still
gives you automatic deploys whenever you are working.** That is your call, not
mine.

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

## Order to do this in

1. `cd sporta-web && npm run ftp:doctor` — confirm the real FTP host.
2. Fill `sporta-web/.env.deploy` (git-ignored) and run `npm run publish` **once,
   by hand**, to prove the credentials end to end.
3. `npm run publish:watch` — you now have automatic deploys while you work.
4. Decide on Half 2. If yes: create `sporta-live`, add the three secrets, merge.
5. After the first automatic deploy, run `./scan-server-response.sh`.
