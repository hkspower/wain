# Terminal runbook

This was a one-time list of paused tasks from the Lovable era. All of them are
done, and its instructions describe a stack the shop no longer runs on (a
hosted Postgres backend, `VITE_SUPABASE_*` in `.env`, a device-passcode
quick-unlock). Following it now would undo working things, so it has been
emptied rather than left to mislead.

`HANDOFF.md` points at the current documentation. What is genuinely still
outstanding is tracked in `CLAUDE.md` under "Going live":

- **Real product photography** — the biggest remaining gap.
- **SPF, DKIM and DMARC** — the records in `DNS-EMAIL-RECORDS.txt`. Without
  them the warehouse email is silently spam-filtered, which looks exactly like
  everything working.

## The commands worth knowing

```bash
cd sporta-web

npm run publish        # SEO regen → build → file audit → FTPS upload → verify
npm run publish:dry    # what would change, without writing anything
npm run package        # regenerate SPORTA-GO-LIVE.zip (never hand-assemble it)

npm run test:native    # the /api contract, against real MariaDB
npm run test:native-e2e # the built site in a real browser, end to end
npm run test:knet      # the card path against a fake bank speaking Tranportal
npm run test:tpay      # T-Pay against a fake CBK gateway
npm run audit:files    # what ships
npm run audit:storage  # what a real Apache would serve from it
npm run scan           # every route, both languages
```

After any deploy: `./scan-server-response.sh` from the repo root.
