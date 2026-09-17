"use client";

import { loadSupabase } from "@/lib/supabase";
import { deadlineFetch, describeNetError } from "@/lib/net";
import { toArabicDigits, toArabicNumber } from "@/lib/places";

/**
 * Business media: a logo and photos, uploaded by whoever is registering the
 * place, reviewed before anything is shown.
 *
 * The upload half and the review half are on two different backends now, and
 * that split is deliberate rather than half-finished.
 *
 * `uploadPending()` posts to `/api/media.php` — wain's own bridge, matching
 * `/api/tts.php`'s pattern — because it used to go straight into Supabase
 * Storage, and Supabase is unconfigured here: both env vars are empty, so
 * every upload used to fail at `loadSupabase()` before a byte left the
 * browser. See `scripts/publish/media-endpoint.php`'s own header for why an
 * unauthenticated upload endpoint is safe enough to ship.
 *
 * `signedPendingUrl`, `publishMedia` and `discardPending` below are still
 * Supabase-only, UNTOUCHED, and that is not an oversight either:
 * `submitBusiness()` in `lib/submissions.ts` inserts into a Supabase table
 * that does not exist here, so admin review needs Supabase regardless of
 * which server holds the bytes — wiring these three to the new bridge now
 * would be building a review flow with nothing yet to review. A file that
 * uploads through the bridge and is never turned into a submission is an
 * orphan; `scripts/publish/media-endpoint.php`'s `prune` mode exists because
 * of that, not despite it.
 */

export const PENDING_BUCKET = "business-pending";
export const PUBLIC_BUCKET = "business-media";

/**
 * Same-origin by default, same reason `/api/tts.php` is: no CORS allowlist to
 * keep in step with a new subdomain. The override exists for the same case
 * `NEXT_PUBLIC_WAIN_TTS_URL` was added for — a bundle with no origin, like the
 * iOS app — though nothing points it there yet, because registration is
 * inert in that shell too until `submitBusiness()` has somewhere to write.
 */
const MEDIA_BRIDGE_URL = process.env.NEXT_PUBLIC_WAIN_MEDIA_URL || "/api/media.php";

/** Matches the bucket's allowed_mime_types, so a rejection is caught here
 *  with a sentence the visitor can act on rather than as a storage error. */
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ACCEPT_ATTR = ACCEPTED_TYPES.join(",");
/**
 * Matches the bucket's file_size_limit in scripts/gen-schema.mjs. These two
 * numbers must move together: the browser check is a courtesy, the bucket
 * limit is the real one, and a browser limit above it turns a clear Arabic
 * "too big" message into an opaque upload failure after the whole file has
 * been sent.
 *
 * 5MB rejected ordinary phone photos — a 12MP JPEG off a recent iPhone or
 * Galaxy routinely lands between 4 and 9MB, so a business photographing its
 * own shop hit the limit on pictures it had no idea were large.
 */
export const MAX_BYTES = 12 * 1024 * 1024;
export const MAX_PHOTOS = 12;

/**
 * The size limit as it appears in Arabic copy. Three separate strings used to
 * spell out "٥ ميجا" by hand, so raising MAX_BYTES left the interface quoting
 * a limit that was no longer true. Derived here so that cannot happen again.
 */
export const MAX_SIZE_AR = `${toArabicDigits(Math.round(MAX_BYTES / (1024 * 1024)))} ميجا`;

export interface PickedFile {
  file: File;
  /** Object URL for the preview. Revoked when the picker drops the file. */
  preview: string;
  id: string;
}

/**
 * A file size in the same numerals as the sentence around it.
 *
 * This read "٧.٢MB — الحد ٥ ميجا": Western digits and a Latin unit sitting
 * inside an Arabic sentence that then gives the limit in Arabic-Indic. The
 * decimal separator is the Arabic one too, since ٧٫٢ with a Latin dot reads
 * as a thousands mark.
 */
export function describeSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1
    ? `${toArabicNumber(mb)} ميجا`
    : `${toArabicDigits(Math.round(bytes / 1024))} كيلو`;
}

/** Why this file cannot be used, in words the visitor can act on. */
export function rejectReason(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) {
    return `«${file.name}» مو صورة مدعومة. المدعوم: JPG أو PNG أو WebP.`;
  }
  if (file.size > MAX_BYTES) {
    return `«${file.name}» حجمها ${describeSize(file.size)} — الحد ${MAX_SIZE_AR}.`;
  }
  if (file.size === 0) return `«${file.name}» فاضية.`;
  return null;
}

/** Random, unguessable id for one submission's folder. */
export function newDraftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Older Safari. Not security-critical — the folder is private either way.
  return `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** One JSON error code from media-endpoint.php → one Arabic sentence. Kept
 *  separate from `rejectReason`'s messages even where the reason overlaps
 *  (`bad_type`, `file_too_large`): those are the courtesy check on a file the
 *  browser already read; these are what the server decided after actually
 *  looking at the bytes, which can differ — a mislabelled file the browser's
 *  `file.type` trusted and the server's `getimagesize()` did not, say. */
function bridgeErrorMessage(code: string | undefined, name: string): string {
  switch (code) {
    case "bad_type":
      return `«${name}» مو صورة مدعومة. المدعوم: JPG أو PNG أو WebP.`;
    case "file_too_large":
      return `«${name}» حجمها أكبر من الحد ${MAX_SIZE_AR}.`;
    case "file_empty":
      return `«${name}» فاضية.`;
    case "rate_limited":
      return "طلبات كثيرة بسرعة. استنى شوي وجرّب مرة ثانية.";
    case "quota_exceeded":
      return "التخزين ممتلئ مؤقتاً. راسلنا وبنتابعها.";
    default:
      return `ما قدرنا نرفع «${name}». جرّب مرة ثانية.`;
  }
}

/**
 * Upload one file to wain's own bridge. The stored name is generated, never
 * the visitor's: an uploaded filename is untrusted text, and letting it become
 * a storage path invites traversal and collisions. The extension in the
 * returned path is the server's own call, from the bytes it received — never
 * echoed back from what this function sent.
 */
export async function uploadPending(
  draftId: string,
  kind: "logo" | "photo",
  file: File,
  index = 0
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const reason = rejectReason(file);
  if (reason) return { ok: false, message: reason };

  const body = new FormData();
  body.set("draftId", draftId);
  body.set("kind", kind);
  body.set("index", String(index));
  body.set("file", file, file.name);

  let res: Response;
  try {
    res = await deadlineFetch(MEDIA_BRIDGE_URL, { method: "POST", body });
  } catch (err) {
    // A photo can be several megabytes over a phone connection, so "the
    // network went away" is the likeliest reason by far — worth saying,
    // because it tells the person to move rather than to pick another file.
    return {
      ok: false,
      message: describeNetError(err, `ما قدرنا نرفع «${file.name}». جرّب مرة ثانية.`),
    };
  }

  const data = (await res.json().catch(() => null)) as
    | { ok: true; path: string }
    | { ok: false; error?: string }
    | null;
  if (res.ok && data?.ok && "path" in data && typeof data.path === "string") {
    return { ok: true, path: data.path };
  }
  const code = data && !data.ok ? data.error : undefined;
  return { ok: false, message: bridgeErrorMessage(code, file.name) };
}

/** A short-lived URL so an admin can look at something not yet public. */
export async function signedPendingUrl(path: string, seconds = 600): Promise<string | null> {
  const sb = await loadSupabase();
  if (!sb) return null;
  const { data } = await sb.storage.from(PENDING_BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

/**
 * Approve one file: copy the bytes from the private bucket to the public one
 * and hand back the URL the site will render.
 *
 * Done as download-then-upload rather than a server-side copy so it works on
 * whatever storage version the project is running, and so the admin's own
 * session is what authorises the write.
 */
export async function publishMedia(
  pendingPath: string,
  slug: string,
  name: string
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const sb = await loadSupabase();
  if (!sb) return { ok: false, message: "التخزين مو مهيّأ." };

  const { data: blob, error: dlError } = await sb.storage
    .from(PENDING_BUCKET)
    .download(pendingPath);
  if (dlError || !blob) {
    return { ok: false, message: `ما قدرنا نقرأ ${pendingPath}: ${dlError?.message ?? "مو موجود"}` };
  }

  const ext = pendingPath.split(".").pop() ?? "jpg";
  const target = `${slug}/${name}.${ext}`;
  const { error: upError } = await sb.storage.from(PUBLIC_BUCKET).upload(target, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: true,
  });
  if (upError) return { ok: false, message: `ما قدرنا ننشر الصورة: ${upError.message}` };

  const url = sb.storage.from(PUBLIC_BUCKET).getPublicUrl(target).data.publicUrl;
  return { ok: true, url };
}

/** Drop a whole submission's pending folder once it has been dealt with. */
export async function discardPending(paths: string[]): Promise<void> {
  const sb = await loadSupabase();
  if (!sb || paths.length === 0) return;
  await sb.storage.from(PENDING_BUCKET).remove(paths);
}
