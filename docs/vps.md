# The VPS builds staging

The Hostinger VPS `srv2058651.hstgr.cloud` (IP `187.7.78.123`, Ubuntu 26.04)
builds wain and sends it to **staging only**. Production (`www.wainkw.com`) is
still promoted separately, by hand. Nothing here runs on its own.

## Steps (run as root in the Hostinger browser terminal)

1. Copy `scripts/vps/setup-vps.sh` onto the VPS, then:

   ```
   CERT_EMAIL=you@example.com bash setup-vps.sh
   ```

   It installs node 22, php and nginx, makes a deploy key, and prints the public
   key.

2. In GitHub, open `hkspower/wain` → Settings → Deploy keys → Add deploy key.
   Paste the printed key. Read-only is enough.

3. Run the same command again. It clones the repo and serves
   `/var/www/wain-releases` at `https://srv2058651.hstgr.cloud/releases/`, with
   a certificate.

4. Let the staging server accept downloads from the VPS. This is one line on the
   Hostinger side:

   ```
   php /home/u130124229/domains/wainkw.com/storage/d.php allow srv2058651.hstgr.cloud
   ```

   I can run this for you as a one-time cron job through the Hostinger
   connector, the way earlier installs were done, then delete the job. Tell me
   to go ahead.

5. Put the **staging deploy secret** on the VPS. It is the value of
   `/home/u130124229/domains/wainkw.com/storage/deploy.secret` on the Hostinger
   server. Copy it into the VPS file by hand, and never paste it into a chat or
   a commit:

   ```
   nano /root/wain-deploy/staging.secret
   chmod 600 /root/wain-deploy/staging.secret
   ```

## Deploying to staging

```
bash /root/wain-deploy/src/scripts/vps/deploy-staging.sh
```

`--build` builds and prints the zip's URL and checksum without sending anything.

A successful run ends with `"ok":true` and `staged <commit> on
staging.wainkw.com`. Then check the site the way `docs/hosting.md` describes:
read a file below the root, not only `build.json`.

## What this does not do

- It does not touch production.
- It does not change `deploy.yml.disabled` or the cron route. Those still exist.
- It does not commit anything.
