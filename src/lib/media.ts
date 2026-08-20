"use client";

import { loadSupabase } from "@/lib/supabase";
import { toArabicDigits } from "@/lib/places";

/**
 * Business media: a logo and photos, uploaded by whoever is registering the
 * place, reviewed before anything is shown.
 *
 * Uploads land in `business-pending`, which is private — an unreviewed photo
 * of someone's shop is not public just because its URL is hard to guess. Only
 * an admin can look at it, and approving copies the bytes into the public
 * bucket. So a file being publicly readable *is* the record that a human
 * approved it, rather than a flag someone has to remember to check.
 */

export const PENDING_BUCKET = "business-pending";
export const PUBLIC_BUCKET = "business-media";

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
    ? `${toArabicDigits(mb.toFixed(1)).replace(".", "٫")} ميجا`
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

function extensionFor(type: string): string {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}

/**
 * Upload one file into the pending bucket. The stored name is generated, never
 * the visitor's: an uploaded filename is untrusted text, and letting it become
 * a storage path invites traversal and collisions.
 */
export async function uploadPending(
  draftId: string,
  kind: "logo" | "photo",
  file: File,
  index = 0
): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  const sb = await loadSupabase();
  if (!sb) return { ok: false, message: "رفع الصور مو متاح حالياً." };

  const reason = rejectReason(file);
  if (reason) return { ok: false, message: reason };

  const path = `${draftId}/${kind}-${index}.${extensionFor(file.type)}`;
  const { error } = await sb.storage.from(PENDING_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: true,
  });
  if (error) {
    return { ok: false, message: `ما قدرنا نرفع «${file.name}». جرّب مرة ثانية.` };
  }
  return { ok: true, path };
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
    return { ok: false, message: `ما قدرنا نقرأ ${pendingPath}: ${dlError?.message ?? "غير موجود"}` };
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
