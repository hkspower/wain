# Load balancing and caching, 2026-11-19

Owner: "Load Balancing / caching". Method: two read-only one-shot jobs on the VPS (`ops/LOAD-CACHE-PROBE.md`; `scripts/live-stack-probe.mjs`, commit `0bb1d145`, and a no-network run of the live
image), the VPS record from the Hostinger API, and a two-container test on this machine. Nothing on the server was changed; both probe projects were deleted.

## Result

1. **The shop does not need a load balancer for capacity.** The VPS was idle (load 0.00 / 0.04 / 0.03 on 4 CPUs, 14.6 of 16 GB free, the shop's container at 0.0% CPU over a 5 s window) and every page
   piece is answered in 2 to 8 ms of server time. **Traefik already is the load balancer**; it has one web container to send to.
2. **Caching is already tiered and correct.** I found nothing to fix in the HTTP caching of the site. The one visible miss, the `variants.txt` 404 on first visits, is already remembered for 6 hours by the add-on
   (`MISS_MS`); the lasting fix is a server job (run `make-image-variants.mjs` once).
3. **What does cost a visitor time is distance, not the server.** The VPS is in **Duesseldorf** (data centre `dus`, id 25); the visitors are in Kuwait. A cold HTTPS connection needs about three round trips before the
   first byte (TCP, TLS, request): at a typical 90-120 ms round trip (an estimate from the distance; not measured from Kuwait) that is 300-360 ms, of which the server's 5 ms is 1-2%. Only an edge close to the
   visitor (a CDN with a Gulf point of presence) or a server closer to Kuwait changes that. This is the one real lever, and it is the owner's decision (below).
4. **One real defect found and fixed in the repo: the customer session.** It lived in the container's own `/tmp`, which PHP sweeps after 24 minutes (the live image loads no `php.ini`:
   `session.gc_maxlifetime` 1440, `session.save_path` empty), although the account code allows 8 hours idle and 7 days in all; it is also lost whenever the container is rebuilt, and a second container would
   not see it. The Google sign-in flow had the same fault across containers. Both now use their own shared directory (`customer_session_dir`, `google_session_dir`; default `/var/lib/sporta/<kind>-sessions`,
   the persistent mount the admin session already used). Not deployed: it ships with the next API release, behind the gate.
5. **A second container is built and proven, not applied.** `ops/lb/` holds the runbook and two compose overrides; `npm run test:multi-replica` (34 checks) shows a browser moving between two containers; 11 of its
   checks fail on the code as it was, none now.

## What was measured

### The machine (probe at 10:17 UTC, host up 52 minutes)

| | |
|---|---|
| VPS | KVM 4: 4 CPU, 16 GB, 200 GB; Ubuntu 24.04 with Docker and Traefik; data centre Duesseldorf |
| Load | 0.00 / 0.04 / 0.03; CPU pressure (PSI) 1.68 / 0.64 / 0.33 (the first boot minutes), memory pressure 0, I/O pressure 0.72 / 0.15 / 0.06 |
| Memory | 15,987 MB total, 14,628 MB available, 2,631 MB cache, swap unused (0 of 2,048 MB) |
| Containers | 22 groups. Five web sites share ONE compose project (`apache`: apache, wain, mawsoool, almuhallab, sporta) and one Traefik; MariaDB for the shop is its own project (`sporta-db`); also ollama, two nginx sites (Unity WebGL builds) and a stopped Unity render job, two node apps, an FTP server, Adminer, a second MariaDB (another app's) and backup and deploy jobs |
| The shop's container | `apache-sporta-1`, image `apache-sporta`, 11 processes, 236 MB resident, 0.0% CPU over 5 s, healthy |
| Uptime | the host had rebooted 52 minutes before the probe (09:25 UTC): one VM is one failure domain, and a reboot is an outage of every site on it |
| Shared project | `.build.log` ends with the whole project started together at 06:37 UTC; at 10:38 another site's container (`apache-wain-1`) had been recreated 8 minutes earlier while the shop stayed up |

### The web container (the live image, no network)

PHP 8.4.27 as an Apache module, Apache 2.4.69, `mpm_prefork` (StartServers 5, MaxRequestWorkers 150, MaxConnectionsPerChild 0). **OPcache is on**: 128 MB, `max_accelerated_files` 10,000,
`validate_timestamps` on, `revalidate_freq` 2 s, JIT off. `memory_limit` 128M. Modules: `deflate`, **`brotli`**, `expires`, `headers`, `rewrite`, `reqtimeout`; no `mod_cache`, no `remoteip`
(the client address is taken from `X-Forwarded-For` by `sporta_client_ip()`, with Traefik as the trusted proxy). `zend.assertions=1`, but there is no `assert()` call anywhere in the PHP code, so it costs nothing.
Three site ini files are loaded (`90-sporta-mail`, `91-sporta-upload`, `92-sporta-errors`); sessions are PHP's file handler with the defaults named above.

The service in the compose file: `restart: unless-stopped`; a health check (`curl http://127.0.0.1/`, every 30 s, 3 tries, 15 s start period); networks `default` and `sporta-db_default`; Traefik labels for the
host names `sporta.com.kw` and `www.sporta.com.kw`, entry point `websecure`, certificate resolver `letsencrypt`, backend port 80; no `container_name` (so it can be scaled), no CPU or memory limit.
Mounts: the site (`/docker/sporta/site` to `/var/www/html`), the product-photo directory, the read-only category and hero photos, the config directory, `api-config.php`, the mail directory, the three database
secret files, **`/docker/sporta/private/voice` to `/var/lib/sporta`** (payment logs, the CBK token, the voice cache, the admin sessions) and two admin helper scripts. Traefik runs with the Docker provider, ports 80 and
443, an HTTP-to-HTTPS redirect and Let's Encrypt (HTTP challenge); no compression, no cache, no HTTP/3 flag.

### Response times and caching (from the VPS itself: no internet in between; 7 samples after a warm-up)

| Kind | Cache-Control | Sent (br) / decoded | TTFB median / p90 | Conditional request |
|---|---|---|---|---|
| HTML page (shell and product pages) | `no-cache, stale-while-revalidate=60`, ETag | 6.3 kB / 19 kB | 5-7 / 6-8 ms | 304 |
| Hashed app JS and CSS | `public, max-age=31536000, immutable` | 48 kB / 165 kB (JS), 30 kB / 185 kB (CSS) | 5-6 / 6-7 ms | 304 |
| Fonts, product photos, small photo copies | `public, max-age=2592000, stale-while-revalidate=604800` | 22 kB, 129 kB, 12 kB | 2 / 2 ms | 304 |
| Hero image | `public, max-age=86400, stale-while-revalidate=2592000` | 146 kB | 2 / 2 ms | 304 |
| Logo, favicon | 30 days (+ stale-while-revalidate a week) | 40 kB, 1.4 kB | 2-3 ms | 304 |
| Add-on JS and CSS (the shop's own files, un-hashed names) | `no-cache, must-revalidate`, ETag | 79 kB / 273 kB, 33 kB / 136 kB | 5-8 ms | 304 |
| `sw.js`, `config.js`, `boot.js` | `no-cache, must-revalidate` | 5.3 kB, 0.6 kB, 3.2 kB | 3 ms | 304 |
| `robots.txt`, sitemaps | `public, max-age=3600, stale-while-revalidate=86400` | 0.8-1.3 kB | 3-6 ms | 304 |
| API reads (`products`, `slides`, `brands`, `content`, `stock`, `checkout_config`, `text_style`) | `no-store` | 55 B to 1.4 kB (br) | 5-8 ms | none (by design) |

Reading it: static files are served fresh for a month to a year with a validator behind them; HTML and the add-ons are revalidated, which costs one conditional round trip and no body; the API is never cached,
because stock and prices must be what the server says, and it is small enough that this costs nothing (the biggest answer, the product list, is 1.4 kB compressed). The only cache layer the stack does not have is
one in front of the origin. Responses are Brotli-compressed by Apache; Traefik adding compression would only recompress them.

## Load balancing: what it would and would not do

| | One container (today) | Two containers (`ops/lb`) |
|---|---|---|
| Capacity | 150 workers, ~0% used | not needed |
| Restart or rebuild of the shop's container | the shop is down for the restart (seconds, up to the 15 s health-check start period) | one container serves while the other restarts: no outage |
| One hung request pool | all requests wait | the other container answers |
| Distance Duesseldorf to Kuwait | unchanged | unchanged |
| VM, disk or database failure, host reboot | outage | outage (same VM) |
| Database connections | at most 150 | at most 150 with the worker cap of step B, 300 without it |
| Cost | | a second set of workers in memory (about 1.6 GB at most when busy; 14.6 GB free), one more container to watch in logs |

A load balancer that removes the single failure domain needs a second VM and a database replica. At this shop's size that is a different order of cost and moving parts; I do not recommend it.
**Recommendation: do not apply the second container now.** Release the session fix (it repairs the 24-minute sign-out with or without replicas); keep `ops/lb` ready, and apply step A when a maintenance
quiet hour matters (a PHP or Apache image change, a planned rebuild).

## Caching: what a CDN would change, and what it needs

The static tiers above are already as long as they can be without changing file names. A CDN would not make them longer; it would answer them from a point of presence near the visitor, terminate TLS there
(round trips of 10-30 ms instead of ~100 ms), speak HTTP/3 to phones, and keep one warm connection to the origin. Rough effect on a cold first load (estimates, not measurements): first byte ~300-360 ms now,
~60 ms for a cached static file and ~160 ms for an uncached one through an edge in the Gulf.

What it needs, none of it done: the domain's name servers moved to the CDN (owner's registrar); SSL mode "full (strict)"; a cache rule that caches `/assets/*`, `/images/*`, `/fonts/*`, `/hero/*`, `/cats/*`
and **bypasses** `/api/*`, `/knet/*`, `/pay/*`, `/backends*` and `/account*` (the bank's callbacks must reach the origin unchallenged); the CDN's address ranges added to `trusted_proxy_ips`, **or every visitor
behind one CDN node shares one rate-limit and one order-cooldown bucket**; "Rocket Loader"-style script rewriting off (the CSP is `script-src 'self'` plus hashes). Alternative with the same aim and more work:
move the VPS to the Mumbai data centre (`mum2`, id 23, nearer to Kuwait than Duesseldorf): a new VPS and a migration of five sites' worth of setup, and the CBK merchant IP (`187.7.78.123`) would change.

**HTTP/3** is a flag on the shared Traefik (`--entrypoints.websecure.http3`) plus UDP 443 open in the VPS firewall group; Traefik here is shared by every site on the box, so it is the owner's call.

## Smaller findings

- **No resource limit protects the shop from its neighbours** (ollama, Unity render jobs, a second MariaDB on the same host). Today they are idle. `ops/lb/sporta.hardening.override.yml` gives the shop `oom_score_adj -500`
  so a memory shortage ends a neighbour first; it is part of step B.
- **A deploy of one of the other sites can touch the shop's project.** The 06:37 whole-project start in `.build.log` shows the five sites share a lifecycle. Moving `sporta` into its own compose project would
  separate that; it is a bigger change than replicas and not done.
- **The add-on files are revalidated on every full page load** (23 conditional requests: 14 CSS, 9 JS). They cannot be hashed because the live `index.html` belongs to the foreign build; `max-age=300,
  stale-while-revalidate` would remove those round trips for repeat visitors, at the price that a deploy reaches a returning browser up to five minutes late and two files that must travel together
  (`sporta-images.css` + `sporta-features.js`) could be seen one new and one old for that time. Not changed: deploy speed was valued over this.
- **`variants.txt` answers 404** until `scripts/make-image-variants.mjs` has been run on the server (it also makes the small photo copies, which are missing for uploads). A browser remembers the miss for 6 hours.
- **Not measured:** a load test (read-only rule, and a test on the live box could hurt the shop), the round trip from Kuwait (no vantage point), MariaDB's `max_connections` (run `scripts/db-pool-probe.mjs`
  before step A).

## What changed in the repo (not deployed)

| File | Change |
|---|---|
| `dropin/php-store/store.php` | `store_session_dir($kind)`: one rule for the admin, customer and Google-flow session directories (admin unchanged, byte for byte the same candidate order) |
| `dropin/php-store/customer-auth.php` | customer session in `customer_session_dir`, swept after 7 days (`CUSTOMER_ABSOLUTE_SECONDS`, `CUSTOMER_IDLE_SECONDS` replace two literals); an empty session made by a cookie that names nothing is ended at once, so the 7-day directory cannot fill with files from `?r=me` probes |
| `dropin/php-store/admin-google.php` | Google flow session in `google_session_dir`, swept after 1 hour |
| `config.example.php`, `scripts/sandbox.sh`, `.gitignore`, `scripts/config-rules-test.mjs` | the two new keys, documented, in the test sandbox, ignored, in the key manifest |
| `scripts/multi-replica-test.mjs`, `npm run test:multi-replica` | the two-container test (34 checks) |
| `ops/lb/`, `ops/LOAD-CACHE-PROBE.md`, `scripts/live-stack-probe.mjs` | the runbook, the two compose overrides, how the probes are run |

## Decisions for the owner

1. **Release the session change** with the next API release? (Recommended. One side effect: the one customer account that exists is signed out once, because its session moves.)
2. **Second web container** (`ops/lb`, step A)? Recommended: not now; apply at a quiet hour when a rebuild is planned. Step B (guard rails) with it or later.
3. **CDN in front** (the biggest gain for Kuwait visitors) or **HTTP/3** on the shared Traefik, or neither? Each changes shared infrastructure or DNS and needs your yes.
4. **Run `make-image-variants.mjs` on the server** (ends the `variants.txt` 404 and makes the small photo copies)?
5. Add-on caching of five minutes (trade-off above): leave as it is?
