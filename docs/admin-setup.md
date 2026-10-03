# لوحة التحكّم — الإعداد

The admin lives at `/admin`. It is a client-side page that talks to the site's
own back end, `/api/wain.php` on the same host (`docs/backend.md`); the site
itself stays a static export on Hostinger, so nothing about hosting, the
domain, or the deploy pipeline changes.

Until the two steps below are done, `/admin` says exactly what is missing and
**the public site behaves as it does today**, serving its built-in copy of the
places. Nothing breaks by not doing this.

## 1. Install the back end (once, from a session)

The fetch-pin-run cron route in `docs/backend.md`: `wget` the pinned
`scripts/publish/wain-api.php`, `php w.php install`, `rm`. `install` puts the
file on both stages, creates the database, seeds it from the export's
`data/places.json`, and creates `storage/admin.secret` **empty**. Then
`php …/api/wain.php selftest` and `version`.

## 2. Set the password (once, by the owner)

1. hPanel → **File Manager** → `domains/wainkw.com/storage/admin.secret`
   (outside `public_html`).
2. Paste a long random secret — 32 characters or more. Nothing else in the
   file.
3. Save. Never paste it into a chat, a commit or an environment variable.

That is the whole login: `/admin` asks for it once per tab and keeps it in
sessionStorage. To change it, change the file; every open tab is signed out
on its next request.

Staging and production share `storage/`, so one secret opens both boards;
each stage has its own database, so staging's edits never reach the live site.

## 3. The build

Nothing to set: the default `NEXT_PUBLIC_WAIN_BACKEND` is `/api/wain.php`,
same origin. A build with `NEXT_PUBLIC_WAIN_BACKEND=none` ships with the board
and every dynamic feature switched off and says so. `build.json` records which.

## What is live, and what waits for a deploy

| Change | Visible on the site |
| --- | --- |
| Editing an existing place | **Immediately**, everywhere — `/explore`, `/search`, شوق's tools, and the place's own page |
| Hiding / unhiding a place | **Immediately** in the listings |
| Adding a new place | Listed immediately; its own `/places/<slug>/` page after the next deploy |
| Home page "featured" | After the next deploy |
| A place's `<title>` and share card | After the next deploy |

Editing used to reach only the listings. A place's own page was a pure function
of the build-time snapshot, so an admin could fix a phone number, watch it
appear in search, tap through, and find the old one still there — the one page
about a place was the last to hear about it. `PlaceLive` now reads the same
`usePlaces` hook the listings do: the prerendered HTML paints first, and the
live row replaces it on hydration.

Two things still wait for a deploy, both for the same reason — there is no
server rendering pages, so anything decided before the browser runs is decided
at build time.

- **A brand-new slug has no page.** `generateStaticParams` can only emit the
  places that existed at build, and the host answers an unknown path with the
  404. Deploy to regenerate.
- **`<title>`, the description and the OG image** come from `generateMetadata`,
  which runs at build. A renamed place shows its new name in the page and its
  old one in the tab and in a WhatsApp preview until the next build.

## Keeping the built-in copy fresh

`src/lib/places.ts` stays the build-time snapshot and the fallback used when
the back end is unreachable or its table is empty. It is not updated
automatically. When the database has drifted meaningfully, refresh it so first
paint and SEO match what the database holds. The other direction is automatic:
a deploy ships `data/places.json` and `php …/api/wain.php seed` inserts any
catalogue place the table lacks, never overwriting a live edit.

## The four tabs

- **الأماكن** — every row, published or not; edit, hide, delete, move the pin.
  Saving a place approved from a submission publishes its approved photos
  into `images/business/<slug>/` first and closes the submission in the same
  click.
- **طلبات التسجيل** — what `/add` sent, with the contact details; «راجع
  واعتمد» opens the editor prefilled, «ارفض» records a note. Photos are shown
  through ten-minute signed URLs.
- **الطلبات المسبقة** — polled every 30 seconds, chime on a new order, «جاهز /
  تسلّم / إلغاء». Customers' names and numbers are here and nowhere public.
- **الطابور** — today's tickets per salon, «نادِ التالي», and «أضف زبون» for a
  walk-in, which takes the next number in the same line.

## Security notes

- Reads of `places` answer published rows only; everything else needs the
  secret.
- The secret is compared in constant time and a wrong guess costs a quarter
  second; the file is 0600 in a directory outside the document root.
- The `/admin` page is `noindex, nofollow` and disallowed in `robots.txt`.
  That keeps it out of search results; it is not a security boundary — the
  secret is.
- `/api/wain.php` logs the action and the hashed address, never a customer's
  name or number. `php …/api/wain.php log` reads it.
