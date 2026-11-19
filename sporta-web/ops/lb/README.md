# Two web containers for the shop (`ops/lb`) - built, proven in the repo, NOT APPLIED

Owner, 2026-11-19: "Load Balancing / caching". The measured answer and the reasons are in `LOAD-CACHE-REPORT-2026-11-19.md`. Short form: the box is idle (load 0.00, 14.6 of 16 GB free,
a page costs 5-8 ms of server time), so a second container is not needed for capacity. What it buys is **no downtime when the shop's container is restarted or rebuilt**, and a spare
worker pool if one request ever hangs. It does not help distance (the VPS is in Duesseldorf, the visitors in Kuwait), a failure of the VM, or the database: those are in the report.

Nothing in this folder runs by itself, and nothing on the server has been changed. Changing the shared compose project is a server change: it needs the owner's explicit yes
(CLAUDE.md, item 4), and it is done as a plan-then-apply job through the Hostinger connector, never by hand and never from CI.

## What makes it safe (done in the repo, proven, not yet deployed)

A second container is only safe if a request leaves nothing in the container that the other one would miss. `npm run test:multi-replica` (34 checks) starts two PHP servers with their own
temp directory and their own default session path, one MariaDB and one set of shared directories, and sends a browser from one to the other. Before this change 11 of its checks fail:

| State | Where it was | Now |
|---|---|---|
| Customer session | the container's own `/tmp` (PHP default; swept after 24 minutes, lost when the container is rebuilt) | `customer_session_dir`, default `/var/lib/sporta/customer-sessions` (the shared persistent mount), swept after 7 days |
| Google sign-in flow (start on one container, callback on the other) | the container's own `/tmp` | `google_session_dir`, default `/var/lib/sporta/google-sessions`, swept after 1 hour |
| Admin session | `/var/lib/sporta/admin-sessions` (already shared) | unchanged |
| Rate limits and sign-in windows, order cooldown, named locks (`GET_LOCK`) | the database | unchanged (the test adds failures up across the two containers) |
| Uploaded product photos, config files, payment logs, the CBK token, the TTS cache | bind mounts | unchanged |
| OPcache | per container | each container revalidates a changed file within 2 s (`validate_timestamps` on, `revalidate_freq` 2), so a deploy reaches both without a restart |

One behaviour changes for the better and the owner should know: a customer who was idle for 24 minutes used to be signed out by PHP's sweep, although the account code allows 8 hours idle and 7 days in all.
The sessions now last what the code says. Existing sessions (one customer account exists today) are signed out once, when the release lands, because they move to the new directory.

## Order of work

1. Release the repo change through the normal gate (API release: `store.php`, `customer-auth.php`, `admin-google.php`). It is worth doing even if the shop stays on one container (the 24-minute sign-out above).
2. Measure the database's connection ceiling with `scripts/db-pool-probe.mjs` (read-only). One container allows 150 simultaneous requests, one connection each; two containers without the worker cap
   allow 300. Step B caps each at 75 (total 150, as today); skip the cap only if `Max_used_connections` is far below `max_connections` and `max_connections` is above 300.
3. **Step A, the second container (`sporta.replicas.override.yml`: `deploy.replicas: 2` and nothing else).** Plan first: `docker compose ... up -d sporta --dry-run` must say `apache-sporta-1 Running` and
   `apache-sporta-2 Created`. A changed replica count is not a changed configuration, so the shop is not restarted. If the plan says `Recreate` for `-1`, stop. Traefik's Docker provider finds the new container by the
   same labels and adds it to the same load-balanced service when its health check passes (no sticky sessions are needed after step 1).
4. Check, read-only: both containers `healthy` in `vps_docker_list`; a probe in the `apache_default` network fetching `http://apache-sporta-1/` and `http://apache-sporta-2/` with `Host: www.sporta.com.kw` gives the
   same answer for `/api/api.php?r=products`; a customer sign-in followed by 20 page loads stays signed in; `docker logs` of both show requests.
5. **Step B, guard rails (`sporta.hardening.override.yml`), later and separately.** Create `/docker/sporta/zz-sporta-workers.conf` on the host from `ops/lb/zz-sporta-workers.conf` (0644, root), then merge both
   override files. This one changes the containers' configuration (a worker cap of 75 each, `oom_score_adj -500`, Traefik's own health check), so Compose recreates them: do it in a quiet hour (02:00-06:00 Kuwait)
   and expect up to ~30 s of 502s (not measured on this host whether the two are recreated at once or one after the other).

## Things that stay true or need care

- **Cron stays on `apache-sporta-1`.** `/etc/cron.d/sporta-cron` execs into `apache-sporta-1` by name (`cron-stock.php --release` every 15 minutes, `cron-fulfilment.php --run` every 5, the monthly voice prune, the
  daily birthday run). Do not change those lines to the second container, and never to both: each job is written to run once. If `-1` is stopped for a rebuild, the next run is simply the one after it.
- **Deploys do not change.** `scripts/vps-deploy.mjs` writes into `/docker/sporta/site`, which both containers mount; its health check goes through the public address and may hit either. `compose --rollback`
  likewise. The admin's "clear cache" button resets OPcache of the container that answered; the other revalidates by itself within 2 s.
- **Rebuilding the image** (a PHP or Apache change) is where the second container pays: rebuild and recreate one, wait for `healthy`, then the other. With one container this is a short outage.
- **A second replica is not a second server.** Same VM, same disk, same MariaDB. A failure of the VM or the database still takes the shop down. A real fix for that is a second VM plus a database
  replica, which is a different order of cost and complexity and is not recommended at this shop's size (see the report).
- **Memory:** a container measured 236 MB resident with 11 processes at rest (21 MB each); 75 workers is at most about 1.6 GB (an upper bound: the resident figure counts shared pages once per process). The host has
  14.6 GB free. Step B gives the shop `oom_score_adj: -500` so a shortage ends a neighbour (ollama, a Unity job) before it ends the shop. It sets no `mem_limit` on purpose: a limit kills workers in a spike,
  which is worse than borrowing from an idle host.
- **If a CDN is put in front later** the CDN's addresses must be listed in `trusted_proxy_ips`, or every visitor behind one CDN node shares one rate-limit bucket (`sporta_client_ip()` walks `X-Forwarded-For`
  from the right and stops at the first address that is not a trusted proxy). This holds with or without replicas.

## Undo

Remove step A (and B) from the merge and `up -d sporta`: Compose removes `apache-sporta-2` (and, if B was applied, recreates `-1` without its guard rails). Nothing is lost: no state lives in a container any more (that is what step 1 and `test:multi-replica` prove), and
the customer and admin sessions stay in the shared directories.
