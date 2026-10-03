"use client";

import { backendOrigin, callSafe, describeApiFailure } from "@/lib/backend";
import { deadlineFetch, describeNetError } from "@/lib/net";
// place-kit, not places: MediaUploader is a client component on /add, and
// this one edge put all 52 records on that page for two number formatters.
// Same shape as the place-rows clamp-helper edge that made place-kit exist.
import { toArabicDigits, toArabicNumber } from "@/lib/place-kit";

/**
 * Business media: a logo and photos, uploaded by whoever is registering the
 * place, reviewed before anything is shown.
 *
 * Two endpoints on one origin. `uploadPending()` posts the bytes to
 * `/api/media.php` (`scripts/publish/media-endpoint.php`, whose header says
 * why an unauthenticated upload endpoint is safe enough to ship); they land in
 * `storage/business-pending/`, outside the document root, where no URL
 * reaches them. The review half — `signedPendingUrl`, `publishMedia`,
 * `discardPending` — goes through `/api/wain.php` with the admin secret: a
 * pending file is looked at through a URL the server signs for ten minutes,
 * and approving one copies it into `public_html/images/business/`, a
 * directory the deploy's prune never touches. A file that uploads and is
 * never turned into a submission is an orphan; media.php's `prune` mode
 * exists because of that.
 */

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

/** A short-lived URL so an admin can look at something not yet public. The
 *  server signs it on the admin secret; it is good for ten minutes and for
 *  one file, so a link that leaks is dead by the time it is read. */
export async function signedPendingUrl(path: string): Promise<string | null> {
  const r = await callSafe<{ url: string }>("media_sign", { path }, { admin: true });
  return r.ok ? backendOrigin() + r.url : null;
}

/**
 * Approve one file: the server copies the bytes from the private pending store
 * into the public `images/business/<slug>/` and hands back the URL the site
 * will render. The name is the admin's (`logo`, `photo-1`…); the extension is
 * whatever `getimagesize()` decided at upload.
 */
export async function publishMedia(
  pendingPath: string,
  slug: string,
  name: string
): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const r = await callSafe<{ url: string }>("media_publish", { path: pendingPath, slug, name }, { admin: true });
  if (r.ok) return { ok: true, url: backendOrigin() + r.url };
  if (r.error === "not_found") return { ok: false, message: `ما قدرنا نقرأ ${pendingPath}: مو موجود` };
  return { ok: false, message: describeApiFailure(r, `ما قدرنا ننشر الصورة: ${r.error}`) };
}

/** Drop a whole submission's pending files once it has been dealt with. Best
 *  effort: a file that outlives this is caught by media.php's `prune`. */
export async function discardPending(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await callSafe("media_discard", { paths }, { admin: true });
}
