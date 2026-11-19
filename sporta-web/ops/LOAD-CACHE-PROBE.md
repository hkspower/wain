# Read-only probes of the live stack (2026-11-19, "Load Balancing / caching")

Both probes are one-shot Docker Compose projects on VM 2058651 through the Hostinger connector (`vps_docker_create`, then `vps_docker_logs`, then
`vps_docker_delete`). They write nothing, sign in to nothing, send no body, and print no secret. The first `vps_docker_create` of a project
often leaves it "not found" for a few seconds (state `delayed`): read the logs again. A second create with the same name is not needed.

## 1. `scripts/live-stack-probe.mjs` - host, containers, compose, caching

`SECTION=host|procs|compose|volumes|http` (default: host, procs, compose, http). The script is fetched from `raw.githubusercontent.com` at a PUSHED commit
(a compose file cannot hold a `$`), so push first and put the 40-character SHA in the URL.

```json
{"services":{"probe":{"image":"node:24-alpine","restart":"no","network_mode":"host","pid":"host",
 "environment":{"SECTION":"host,procs,compose,http"},
 "volumes":["/docker/apache:/infra/apache:ro","/docker/traefik:/infra/traefik:ro"],
 "entrypoint":["/bin/sh","-c"],
 "command":["node --input-type=module -e \"import { writeFileSync } from 'node:fs'; const r = await fetch('https://raw.githubusercontent.com/hkspower/wain/<SHA>/sporta-web/scripts/live-stack-probe.mjs'); writeFileSync('/tmp/p.mjs', await r.text())\" && node /tmp/p.mjs"]}}}
```

`pid: host` is what lets the `procs` section see every container's processes (it reads `/proc`, by cgroup id). Without it, drop `procs` from `SECTION`.
The `volumes` section needs only `/docker/apache`. Only the `sporta` service of the apache compose file is printed (the other four are other sites'), its
environment values are printed as `***`, and anything whose name looks like a credential is hidden.

## 2. The PHP and Apache settings of the live image (`apache-sporta`), no network, no mounts

The image already exists on the host, so `pull_policy: never` is enough, and `network_mode: none` means it cannot reach anything. It does not start Apache:
the entrypoint is replaced by a shell that prints settings and exits.

```json
{"services":{"ini":{"image":"apache-sporta","pull_policy":"never","restart":"no","network_mode":"none",
 "entrypoint":["/bin/sh","-c"],
 "command":["php -v | head -1; php -m | grep -i -E 'opcache|apcu'; php --ini | head -8; php -i | grep -E '^(opcache|session)\\.' | grep -E 'enable |validate_timestamps|revalidate_freq|memory_consumption|max_accelerated_files|save_path|gc_maxlifetime|gc_probability|gc_divisor'; apache2ctl -M 2>/dev/null | sort | tr '\\n' ' '; grep -hv '^[[:space:]]*#' /etc/apache2/mods-enabled/mpm_*.conf"]}}}
```

Pitfalls measured on the first run: a `grep -E` alternative that is followed by `) ` needs ONE space, not two, or `opcache.*` and `session.*` print nothing and read like
"OPcache is off"; `php -i` from the CLI shows `opcache.enable_cli` Off, which is the CLI, not Apache.

Delete each project afterwards (`vps_docker_delete`) and confirm with `vps_docker_list` that nothing of yours is left.
