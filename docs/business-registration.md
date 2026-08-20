# سجّل مكانك — free business registration

Any business in Kuwait can add itself to Wain from `/add/`, free, with no
account. This is the only place on the site where a visitor writes to the
database, so it is worth understanding exactly what that does and does not
allow.

## The flow

1. An owner fills the form at **`/add/`**.
2. The row lands in **`public.submissions`** with `status = 'pending'`.
   Nothing on the public site changes.
3. An admin opens **`/admin` → طلبات التسجيل**, reads the submission, and
   either rejects it (with a note) or presses **راجع واعتمد**.
4. Approving opens the normal place editor, prefilled from the submission.
   The admin fills in what an owner cannot be asked for — the rating, the
   emoji, the final slug — and saves.
5. Saving creates the row in `public.places` **and** closes the submission in
   the same step (`status = 'approved'`, `published_slug` recorded).

A new place appears in listings and search straight away, because those read
live from Supabase. Its own `/places/<slug>/` page is generated at build time,
so it becomes reachable after the next deploy — the same as any place added
in the admin.

## Logo, bio and photos

A business can send a brand mark, a bio in its own words, and up to eight
photos. None of it is public until an admin has looked at it.

**Two buckets, because "approved" has to be a property of where a file lives,
not a flag someone remembers to check:**

| bucket | who writes | who reads |
|---|---|---|
| `business-pending` | anyone | admins only (short-lived signed URLs) |
| `business-media` | admins only | everyone |

An unreviewed photo of someone's shop is not public just because its URL is
hard to guess, so pending uploads go in a private bucket. Approving copies the
bytes across. A file being publicly readable therefore *is* the record that a
human approved it.

Approval is per image. Nothing starts selected — a photo goes public because
someone chose it, not because nobody looked. The admin also decides on the
logo separately. Once the submission is closed, the pending originals are
deleted, approved and rejected alike: keeping photos nobody approved is the
kind of thing that quietly becomes a data-protection problem.

Both buckets are capped at 5MB per file and restricted to JPEG, PNG and WebP
at the bucket level, so a rejection holds even if the form is bypassed. The
form checks the same limits first, so the visitor gets a sentence they can act
on rather than a storage error.

Files upload only after the rest of the form validates. Uploading as they are
picked would push megabytes into storage for submissions that are never
created. Stored filenames are generated, never the visitor's — an uploaded
filename is untrusted text, and letting it become a storage path invites
traversal and collisions.

On the place page: the logo sits beside the name, the bio is rendered as a
quotation and labelled as the owner's words (the description above it is the
site speaking), and the photos become a gallery whose first image leads at
double width. All three are optional and absent on the seeded places, so those
pages are unchanged.

**Note for `.htaccess`:** the CSP's `img-src` must include
`https://*.supabase.co`, or approved images are blocked. It does.

## Why it is safe to let anonymous visitors insert

`submissions` is the one table the anon key can write to. The RLS policies are
the whole security boundary:

- **Insert only.** There is deliberately no anon `select` policy. A submitter
  cannot read the table back — not even their own row. Submissions carry phone
  numbers and email addresses, and an open `select` would hand the lot to
  anyone with the anon key, which is public by design.
- **The insert check pins `status = 'pending'`** and requires the review
  columns to be null. Nobody can post a row that is already approved.
- **A submission is not a place.** Nothing written here can reach the site.
  Only an admin, writing to `places`, can publish anything.
- **Column CHECK constraints** bound every field's length, restrict `category`
  to the eight known ids, and require any coordinates to fall inside Kuwait's
  bounding box.
- **A partial unique index** on `(name_ar, area_ar) where status = 'pending'`
  stops the same business queuing twice — usually a double-tap on the button.

## What this does not defend against

Be clear-eyed: there is no CAPTCHA and no server to rate-limit on, because the
site is a static export. Someone determined can script inserts against the
anon key. What protects the site is that **nothing published is automatic** —
every row waits for a human. The realistic failure mode is a spammed review
queue, not spam on the site.

If the queue ever does get abused, the options in increasing order of effort:

1. Delete the junk in the admin (or `delete from submissions where status =
   'pending' and created_at < now() - interval '7 days'`).
2. Add a Cloudflare Turnstile / hCaptcha token and verify it in a Supabase
   Edge Function that owns the insert, moving the anon insert policy off the
   table entirely.
3. Require an email one-time-password before the form submits — Supabase Auth
   already supports it, at the cost of the "no account needed" promise.

Nothing here needs doing until it is actually a problem.

## Setup

The form needs the same two environment variables as the admin
(`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) and the schema
applied. See `docs/admin-setup.md`.

If you already ran `supabase/schema.sql` before this feature existed, run it
again — it is written to be re-runnable, and adds `submissions` without
touching your existing places.

**Without the variables set**, `/add/` still renders and validates, but says
plainly that registration is not connected and refuses to pretend a submission
went through.

## Reaching the owner

`contact_name`, `contact_email` and `contact_phone` are for you, never shown on
the site. The form says so where the owner enters them. Approving a submission
does not email anyone automatically — there is no server to send from. Reply
from your own mailbox, or wire a Supabase Edge Function to
`submissions` if you want that automated later.
