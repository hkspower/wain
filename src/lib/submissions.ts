"use client";

import { backendEnabled, call, describeApiFailure } from "@/lib/backend";
import { describeNetError } from "@/lib/net";
import type { CategoryId } from "@/lib/places";

/**
 * Free business registration.
 *
 * A submission is not a place. It lands in the `submissions` table with status
 * 'pending' and reaches the site only when an admin approves it, which copies
 * the fields into `places`. A visitor can only ever add one; reading them back
 * is an admin action, so one submitter can never see another's phone number.
 */
export interface SubmissionInput {
  name: string;
  nameAr: string;
  category: CategoryId;
  areaAr: string;
  addressAr: string;
  lat: number | null;
  lng: number | null;
  priceLevel: 1 | 2 | 3;
  taglineAr: string;
  descriptionAr: string;
  /** The business in its own words. */
  bioAr: string;
  /** What it sells or offers, one short line each. Capped at 20 by the table. */
  productsAr: string[];
  /** Paths under the server's private pending store, as `/api/media.php`
   *  returned them after the upload. */
  logoPath: string | null;
  imagePaths: string[];
  phone: string;
  instagram: string;
  website: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
}

export interface SubmissionRow extends Record<string, unknown> {
  id: string;
  status: "pending" | "approved" | "rejected";
  name: string;
  name_ar: string;
  category: CategoryId;
  area_ar: string;
  address_ar: string;
  lat: number | null;
  lng: number | null;
  price_level: 1 | 2 | 3;
  tagline_ar: string;
  description_ar: string;
  bio_ar: string;
  products_ar: string[];
  logo_path: string | null;
  image_paths: string[];
  phone: string;
  instagram: string;
  website: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  admin_note: string;
  published_slug: string | null;
  created_at: string;
}

/** Kuwait's bounding box, matching the CHECK constraints on the table. */
export const KUWAIT_BOUNDS = { south: 28.5, north: 30.2, west: 46.5, east: 48.6 };

export function inKuwait(lat: number, lng: number): boolean {
  return (
    lat >= KUWAIT_BOUNDS.south && lat <= KUWAIT_BOUNDS.north &&
    lng >= KUWAIT_BOUNDS.west && lng <= KUWAIT_BOUNDS.east
  );
}

/** Instagram is stored as a bare handle, however the owner typed it. */
export function normaliseInstagram(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .slice(0, 80);
}

export type SubmitResult =
  | { ok: true }
  | { ok: false; reason: "disabled" | "duplicate" | "invalid" | "network"; message: string };

/**
 * The two fields a shop owner should not have to produce to be listed.
 *
 * Registration used to demand six things before it would send. Two of them
 * were the wrong things to ask a business in Kuwait for:
 *
 *  - **The English name.** Plenty of owners do not write English, and the
 *    site does not need theirs: `name` is a reference field, and the admin
 *    sets the real English at approval. Asking for it turned "list my
 *    place" into a translation exercise.
 *  - **The tagline.** It is the marketing line on the card, and the form's
 *    own hint already promised «يساعدنا نكتب صفحة أحلى لمكانك» — the team
 *    writes the copy. Requiring the owner to write it first was a blank
 *    page in the middle of the form, and a blank page is where people stop.
 *
 * The table still requires both (`name` 2-120, `tagline_ar` 4-160), and this
 * fills them rather than relaxing the constraint, so nothing has to be
 * migrated before the easier form works. Neither value is invented: the
 * name falls back to the name the owner did give, and the tagline to a plain
 * statement of what and where. Both are placeholders an admin rewrites
 * before anything is published, which is already true of every submission.
 */
export function fillWhatTheOwnerNeedNotWrite(input: SubmissionInput): {
  name: string;
  taglineAr: string;
} {
  const nameAr = input.nameAr.trim();
  const areaAr = input.areaAr.trim();
  const name = input.name.trim() || nameAr;
  const tagline = input.taglineAr.trim();
  if (tagline.length >= 4) return { name, taglineAr: tagline };
  // The table's floor is four characters, which «الاسم في المنطقة» clears for
  // any name and area that passed their own two-character minimums. Its
  // CEILING is 160, and the name and area are allowed 120 and 80 — so the
  // fallback can overflow where the owner's own tagline never could, and an
  // over-long one is rejected by the table with nothing useful to show for it.
  const built = `${nameAr} في ${areaAr}`;
  return { name, taglineAr: built.length <= 160 ? built : built.slice(0, 160).trimEnd() };
}

export async function submitBusiness(input: SubmissionInput): Promise<SubmitResult> {
  if (!backendEnabled) {
    return {
      ok: false,
      reason: "disabled",
      message: "التسجيل مو متاح حالياً. راسلنا وبنضيف مكانك يدوياً.",
    };
  }

  const filled = fillWhatTheOwnerNeedNotWrite(input);
  let result;
  try {
    result = await call<{ id: string }>("submit", {
      name: filled.name,
      name_ar: input.nameAr.trim(),
      category: input.category,
      area_ar: input.areaAr.trim(),
      address_ar: input.addressAr.trim(),
      lat: input.lat,
      lng: input.lng,
      price_level: input.priceLevel,
      tagline_ar: filled.taglineAr,
      description_ar: input.descriptionAr.trim(),
      bio_ar: input.bioAr.trim(),
      products_ar: input.productsAr.map((x) => x.trim()).filter(Boolean).slice(0, 20),
      logo_path: input.logoPath,
      image_paths: input.imagePaths,
      phone: input.phone.trim(),
      instagram: normaliseInstagram(input.instagram),
      website: input.website.trim(),
      contact_name: input.contactName.trim(),
      contact_email: input.contactEmail.trim(),
      contact_phone: input.contactPhone.trim(),
    });
  } catch (err) {
    return {
      ok: false,
      reason: "network",
      message: describeNetError(err, "ما وصل الطلب. تأكد من الاتصال وجرّب مرة ثانية."),
    };
  }

  if (result.ok) return { ok: true };

  // The same business, while its first submission is still pending.
  if (result.error === "duplicate") {
    return {
      ok: false,
      reason: "duplicate",
      message: "هذا المكان مسجّل عندنا وينتظر المراجعة. بنرد عليك قريب.",
    };
  }
  // A field failed a rule the form should have caught first.
  if (result.error === "invalid") {
    return {
      ok: false,
      reason: "invalid",
      message: "في معلومة مو مضبوطة. راجع الحقول وجرّب مرة ثانية.",
    };
  }
  return {
    ok: false,
    reason: "network",
    message: describeApiFailure(result, "ما وصل الطلب. تأكد من الاتصال وجرّب مرة ثانية."),
  };
}
