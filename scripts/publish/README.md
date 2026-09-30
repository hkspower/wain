# scripts/publish — the ones that WRITE to the live server

Everything in this directory changes sporta.com.kw. They are separated from
`../live/` for exactly that reason: the difference between a script that reads
production and one that overwrites it should be visible from the file's path,
not only from its contents.

**The shape they all share**, and none of them may drop:

- The server fetches each file from `raw.githubusercontent.com/hkspower/wain/<commit-sha>/…`
  — **by commit SHA, never by branch.** The working branch has a slash in it and
  GitHub reads the first segment as the ref, returning an EMPTY file silently.
- Each file is verified against a **recorded sha256 BEFORE it is written**. That
  guard exists for a tampered fetch and has so far only ever caught ordinary
  mistakes — a publisher pinned to a stale commit reported `hashMismatch` on all
  three files and touched the shop not at all. Keep it.
- Write via temp file + rename, so a half-downloaded file is never served.
- **One fetch at a time.** Three concurrent fetches of raw.githubusercontent
  produced one good file and two empty ones.

Run them through the Hostinger cron channel — see CLAUDE.md, "The cron channel
is the only way to write to the server", for the measured limits (~64 chars of
payload, no `cd`, no `$VAR`, `%` is a metacharacter, only the last line of
output is captured), and **delete every job when it has run.**

They are fetched over a path anyone can see, because the repository is public.
Nothing here may take a destructive instruction from its query string.
