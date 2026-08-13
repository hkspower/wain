# Security — المهلب كود · النوخذة

What this system does to protect data, what it cannot do, and how to check
both. Written against the code as it stands; every claim here is either
enforced by `design/test_suite.py` or marked as a limit.

**Reporting an issue:** cs@sporta.com.kw

---

## Where the site actually runs, and what that costs

The site is deployed to **GitHub Pages** (`.github/workflows/pages.yml`).
`almuhallab/.htaccess` exists for Apache/LiteSpeed hosts and **GitHub Pages
ignores it entirely** — so every header it sets is inert in production:

| Header in `.htaccess` | Live on GitHub Pages? | Covered another way? |
|---|---|---|
| `Referrer-Policy: no-referrer` | ❌ | ✅ `<meta name="referrer">` on every page |
| `X-Content-Type-Options: nosniff` | ❌ | ❌ — no static equivalent |
| `X-Frame-Options: SAMEORIGIN` | ❌ | ⚠️ frame-buster script (below) |
| `Permissions-Policy` | ❌ | ❌ — no static equivalent |
| `Strict-Transport-Security` | ❌ | ⚠️ GitHub Pages sends HSTS when *Enforce HTTPS* is on — **check that setting** |

### HTTPS

Only the host can 301 a plaintext request; a static file cannot send a
redirect. On GitHub Pages that is one checkbox — **Settings → Pages → Enforce
HTTPS** — and nothing in this repository can set it. Turn it on.

What the pages do themselves, either way:

- **`upgrade-insecure-requests`** in the CSP of all nine pages. Unlike
  `frame-ancestors`, this directive *is* honoured inside a `<meta>` CSP, so any
  `http://` subresource is fetched over TLS instead.
- **A scheme upgrade** at the top of every page: a visitor who arrives over
  `http://` is sent to `https://` before anything else runs. It cannot protect
  that first request — nothing client-side can — but it protects every request
  after it. `localhost` is exempt so local testing still works.

Neither is a substitute for the checkbox. Both are pinned by the suite.

**If these headers matter to you, move hosting to a server that reads
`.htaccess`** (the file is already written and correct for that case). On
GitHub Pages they cannot be delivered from a static file.

### Clickjacking

`frame-ancestors` is **ignored inside a `<meta>` CSP**, and `X-Frame-Options`
exists only as a real header. So `nokhatha.html`, `nizam.html` and `admin.html`
carry a frame-buster: if the page finds itself framed it hides itself and
navigates the top window away. This is weaker than a header — a sandboxed frame
can block the navigation, which is why the page hides *first* and navigates
second — and it is a mitigation, not a fix. The fix is a server that sends the
header.

---

## What is enforced, in the code

- **Content Security Policy** on all nine pages: `default-src 'none'`, no
  external origin of any kind, `base-uri 'none'`, `form-action 'none'`. Scripts
  and styles are inline-only, so there is nothing to load and nothing to
  poison. This is why no CDN, no font host and no analytics can be added
  without deliberately weakening the policy.
- **Output encoding**: every user-supplied string rendered into HTML goes
  through `esc()` (textContent-based). Numbers are re-coerced and **clamped**
  on read: `localStorage` is user-writable and is treated as untrusted input.
  Verified against hostile payloads — script tags, non-numeric quantities,
  `1e308`, wrong types, broken JSON, `null` entries — none of which execute,
  crash the page, or render.
- **Service worker** (`sw.js`): same-origin GET only; cross-origin responses
  are never cached.
- **Redirect stubs** (`safi.html`, `xbrl.html`, `delivery.html`, `nokha1.html`,
  `404.html`) navigate to **hardcoded** destinations — no parameter reaches
  `location`, so none of them is an open redirect.
- **CSV export** neutralises spreadsheet formula injection: a company name
  beginning `=`, `+`, `-`, `@` or a **TAB** is prefixed with `'`, and CR/LF are
  collapsed to a space so a name can never break the row and inject a new one.

## Accounts (`nokhatha.html` — the النوخذة portal)

`index.html`, the company page, carries **no account UI at all**.

- **PBKDF2-SHA256, 310,000 iterations, 16-byte random per-user salt** via Web
  Crypto. No plaintext, no reversible form.
- Hash comparison is a **constant-time** XOR loop.
- **Login throttling**: 5 failures lock that email for 5 minutes.
- **Sessions expire after 24 hours**, signed out or not.
- Minimum password length 8; email format validated.

## Admin console (`admin.html`)

- Its own PBKDF2-SHA256 passphrase (310,000 iterations, random salt), stored
  separately from customer records; minimum 10 characters.
- Sessions expire after **30 minutes**; 5 failures lock the console for 10.
- Every mutating action is written to an append-only audit log; destructive
  actions require confirmation, and a wipe requires two.

## The Windows app (`nokhatha_app/`)

- Passwords: PBKDF2-SHA256, 310,000 iterations, tested against two published
  RFC 7914 vectors.
- **No network capability at all** — no network-capable package in the
  dependency tree and no socket in the code, enforced by
  `test/supply_chain_test.dart`, which fails the build if either appears.
- No `Process.run`/`Process.start`; the release build is not obfuscated.
- Records are written **atomically** (temp file + rename); a corrupt file is
  kept aside as `.corrupt` rather than destroyed.
- Every release carries a SHA-256 checksum and a **GitHub-signed build
  provenance attestation** (`gh attestation verify`).
- **The records file is not encrypted.** Password hashes are, the records are
  not: anyone with the disk can read them. See `docs/WINDOWS-TRUST.md`.

---

## Limits that are real, and cannot be fixed client-side

1. **Data lives in each visitor's own browser.** Anyone with the device or its
   devtools can read and modify their own records — including their own account
   record. Client-side hashing protects a reused password from casual
   disclosure; it is not server-side authentication.
2. **The lockouts and the admin gate are advisory.** They keep a casual visitor
   out on a shared machine. They are not authorization, and the same user can
   clear them from devtools.
3. **No shared accounts and no server-enforced permissions.** Two people cannot
   see one dataset, and nothing stops a determined local user.

Fixing 1–3 needs a backend: server-side auth (argon2/bcrypt) over TLS, a real
database, and server-enforced permissions. The client-side measures above stay
regardless — defence in depth — but they are not a substitute.
