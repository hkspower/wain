# The VPS builds staging

> **Retired, 1 November 2026.** The owner chose no staging host. `scripts/vps/setup-vps.sh` and `scripts/vps/deploy-staging.sh` are deleted, and so are `scripts/publish/setup-staging-endpoint.php` and `restore-production-endpoint.php`. `www.wainkw.com` runs the owner's own source from `/docker/apache/sites/wainkw.com` on this VPS (CLAUDE.md, «How the VPS builds www.wainkw.com»). What follows is the record of the plan, kept as history.

> **Read this as of 14 October 2026; corrected 31 October.** Since then the
> `www.wainkw.com` and `wainkw.com` DNS records point at this same VPS (A records
> to `187.7.78.123`), `staging.wainkw.com` has no DNS record, and the
> `/home/u130124229/domains/wainkw.com/` paths below were not on the Hostinger
> account (CLAUDE.md, «The 31 October scan, continued»). Steps 4 and 5 cannot be
> followed as written, and nothing here has been checked against what the VPS
> runs in front of its web server.

## Getting the PHP endpoints onto the running site — 1 November (not done)

**What was read.** `vps_docker_get` (the Hostinger API, read-only; nothing on the VPS was changed) returns `/docker/apache/docker-compose.yml`: five services. `wain` is `build: ./sites/wainkw.com` with that folder's own `Dockerfile`, and **only `storage/` is mounted into it** (`./sites/wainkw.com/storage:/var/www/storage`). So the PHP files, `api/wain.php` among them, are baked into the image when it is built. **Copying a file into the folder changes nothing live until `wain` is rebuilt.**

**What cannot do it.**
- The Hostinger API has no file write on a VPS. Its only update, `vps_docker_update`, acts on the whole `apache` project, which also builds sporta, almuhallab and mawsoool, and `vps_docker_create` replaces a project of the same name. Neither should be used for one site's PHP files.
- Searched again on 1 November for any other operation (`vps run command execute script ssh terminal`, `vps docker project build compose`, `vps post-install script file upload`). Nothing runs a command or writes a file on a running VPS. `vps_post-install-scripts_*` only run when the machine is recreated (`vps_virtual-machines_recreate` wipes it, so never). `vps_ssh-keys_add-virtual-machine` adds a root key, which is useless while the sandbox cannot reach port 22. The one theoretical route is `vps_docker_create` with a NEW project name whose compose file runs a helper container with the host folder (and Docker's socket) mounted. That is root on the host, built from a prompt, and it was not tried: it needs the owner's explicit yes, and step 2 below (diff before overwriting) still applies.
- The sandbox cannot reach the VPS: DNS for `srv2058651.hstgr.cloud` gives no answer, TCP 22 to `187.7.78.123` does not connect, and no SSH client is installed (1 November). Network settings of the cloud environment apply to a new session, not to a running one.

**Which files.** Only the ones that already exist on the VPS, under the names they have there: `wain-api.php` is `api/wain.php` and `media-endpoint.php` is `api/media.php` (it may not be installed at all; installing it is the owner's decision, `docs/backend.md`). **Do not push `tts-endpoint.php`**: the voice bridge was closed on 15 October and this would reopen it. **Do not push `deploy-call.php`**: it signs deploys to the shared host's endpoint, and nothing on the VPS receives it. These bytes are unchanged since `b037b860`:

| file | bytes | sha256 |
|---|---|---|
| `scripts/publish/wain-api.php` | 113189 | `c7aa5fad3578a6e7b16b484cf1919cbe8e6b00b8ef98262abb55b30ed4710107` |
| `scripts/publish/media-endpoint.php` | 36289 | `33ba98af3620b851ad01ccc17fe7ba38d16b7f2b0e327e77909f18ed991e204d` |

**The route that needs nothing from the sandbox.** As root in the Hostinger browser terminal (hPanel, VPS, Browser terminal), from `/docker/apache/sites/wainkw.com`:

1. **Read the layout.** `cat Dockerfile`, and `find . -path ./storage -prune -o -name 'wain.php' -print` (likewise `media.php`). The Dockerfile says where each file enters the image. The folder is the owner's own source, so nothing below is guessed at.
2. **Look before overwriting.** Back up each file to be replaced (`cp -p f f.bak-<date>`) and `diff` it against the repository's copy, fetched from `https://raw.githubusercontent.com/hkspower/wain/b037b860/scripts/publish/<file>`. A difference nobody recognises is the owner's change: stop and ask.
3. **Check the admin secret.** These endpoints refuse a secret under 32 characters (503 `admin_weak`). From the folder: `php -r 'echo preg_match_all("/./us", trim(file_get_contents("storage/admin.secret")));'`. Under 32 means the board locks after the push: replace the secret first (`docs/admin-setup.md`).
4. **Put the files where step 1 found them** and check their sha256 against the table.
5. **Rebuild only wain:** `docker compose -f /docker/apache/docker-compose.yml up -d --build wain`. Not the project-wide form, which would rebuild the other sites too.
6. **Check:** `docker compose -f /docker/apache/docker-compose.yml exec wain php <path to wain.php> version`, then `migrate` (creates the `gaps` table that `gap_report` needs), then `selftest`, then a request to `https://www.wainkw.com/api/wain.php?a=ping`.

A new session with SSH allowed could do the same steps. It would still have to read the layout first, and it would still stop at step 2 on any difference.

The Hostinger VPS `srv2058651.hstgr.cloud` (IP `187.7.78.123`) builds wain and,
when this was written, sent it to **staging only**, with production
(`www.wainkw.com`) promoted separately by hand. The Hostinger API reports its
template as «Ubuntu 24.04 with Docker and Traefik»; this file first said Ubuntu
26.04, and neither was read from the machine — run `lsb_release -a` before
relying on a version. Nothing here runs on its own.

## Steps (run as root in the Hostinger browser terminal)

1. Copy `scripts/vps/setup-vps.sh` onto the VPS, then:

   ```
   CERT_EMAIL=you@example.com bash setup-vps.sh
   ```

   It installs node 22, php, nginx and certbot, makes a deploy key, and prints
   the public key. On a Docker and Traefik template, nginx and certbot may compete
   with Traefik for ports 80 and 443 — unverified, and not yet checked on the host
   (CLAUDE.md, «The 31 October scan, continued»).

2. In GitHub, open `hkspower/wain` → Settings → Deploy keys → Add deploy key.
   Paste the printed key. Read-only is enough.

3. Run the same command again. It clones the repo and serves
   `/var/www/wain-releases` at `https://srv2058651.hstgr.cloud/releases/`, with
   a certificate.

4. **Not valid as written.** This step ran `php
   /home/u130124229/domains/wainkw.com/storage/d.php allow srv2058651.hstgr.cloud`
   to let the staging endpoint accept downloads from the VPS. That path was not on
   the Hostinger account on 31 October 2026, and `staging.wainkw.com` has no DNS
   record, so there is no staging endpoint to receive it.

5. **Not valid as written.** This step copied the **staging deploy secret** from
   `/home/u130124229/domains/wainkw.com/storage/deploy.secret` on the Hostinger
   server into `/root/wain-deploy/staging.secret` on the VPS (by hand, mode 600,
   never into a chat or a commit). The deploy secret belongs to whichever
   endpoint receives a deploy on the VPS, and that endpoint is not in this
   repository yet.

## If this VPS serves the site behind a reverse proxy

The rate limits in `/api/wain.php`, `media.php` and `tts.php` count the
connection's address, which behind Traefik is Traefik's. To count the visitor,
put the proxy's Docker network in `storage/trusted-proxies.txt` (`docs/backend.md`,
«Which address, behind a reverse proxy»). That is only safe if the PHP container's
port is **not published on the host** and is reachable only through the proxy;
nothing in this repository can check either, and neither was read from the VPS.

## Deploying to staging

```
bash /root/wain-deploy/src/scripts/vps/deploy-staging.sh
```

`--build` builds and prints the zip's URL and checksum without sending anything.

When it worked, a successful run ended with `"ok":true` and `staged <commit> on
staging.wainkw.com`. That host has no DNS record now, so there is nothing for the
script to send to as written. Whatever receives a deploy next, check it the way
`docs/hosting.md` describes: read a file below the root, not only `build.json`.

## What this does not do

- It does not touch production.
- It does not change `deploy.yml.disabled` or the cron route. Those files still
  exist, but the cron route's target, `/home/u130124229/domains/wainkw.com/`, was
  not on the Hostinger account on 31 October 2026.
- It does not commit anything.
