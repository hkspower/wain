# الإبلاغ عن ثغرة · Reporting a vulnerability

**cs@sporta.com.kw** — or واتساب **+965 6589 4110**.

Tell us what you found and how to reproduce it. Please give us a chance to fix
it before publishing. We will confirm we received the report.

There is no bounty programme and we will not pretend otherwise.

## أين التفاصيل · Where the detail is

This file exists so GitHub shows a **Report a vulnerability** path from the
repository root. The real document — what is enforced, what is not, and the
limits that cannot be fixed from a static page — is
**[`almuhallab/SECURITY.md`](almuhallab/SECURITY.md)**.

The short version:

| | |
|---|---|
| The website | `default-src 'none'` CSP on every page, no external origin of any kind, no build step and no dependencies |
| النوخذة (web) | every record lives in the visitor's own browser; `localStorage` is treated as untrusted input on read |
| النوخذة (desktop) | no network capability at all — no network-capable package in the tree and no socket in the code, both enforced by a test that fails the build |
| The build | every GitHub Action is pinned to a commit SHA, not a tag; each job holds only the permissions it uses; every release carries a SHA-256 and a GitHub-signed provenance attestation |
| What is **not** true | the Windows and macOS builds are **not code-signed** — no certificate has been bought yet, so both systems will warn about an unknown publisher. Said plainly in `nokhatha_app/docs/WINDOWS-TRUST.md` |
