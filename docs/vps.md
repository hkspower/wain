# The VPS builds staging

> **Retired, 1 November 2026.** The owner chose no staging host. `scripts/vps/setup-vps.sh` and `scripts/vps/deploy-staging.sh` are deleted, and so are `scripts/publish/setup-staging-endpoint.php` and `restore-production-endpoint.php`. `www.wainkw.com` runs the owner's own source from `/docker/apache/sites/wainkw.com` on this VPS (CLAUDE.md, «How the VPS builds www.wainkw.com»). What follows is the record of the plan, kept as history.

> **Read this as of 14 October 2026; corrected 31 October.** Since then the
> `www.wainkw.com` and `wainkw.com` DNS records point at this same VPS (A records
> to `187.7.78.123`), `staging.wainkw.com` has no DNS record, and the
> `/home/u130124229/domains/wainkw.com/` paths below were not on the Hostinger
> account (CLAUDE.md, «The 31 October scan, continued»). Steps 4 and 5 cannot be
> followed as written, and nothing here has been checked against what the VPS
> runs in front of its web server.

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
