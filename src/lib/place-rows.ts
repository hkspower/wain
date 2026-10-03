"use client";

import { clampPrepMinutes, clampServiceMinutes, type CategoryId } from "@/lib/place-kit";
// A type only, so this edge is erased at compile time. It matters which module
// the VALUES come from: this file is reachable from the root layout through
// usePlaces, so importing a clamp from the catalogue put every place record
// (36 at the time) on every page of the site.
import type { Place } from "@/lib/places";

/**
 * A place as a database row, and the two mappings between that and `Place`.
 *
 * The column names are `supabase/schema.sql`'s, which `/api/wain.php` kept
 * when it replaced Postgres (4 October) — so this file moved out of the old
 * `supabase.ts` unchanged and nothing that read a row had to change with it.
 */
export interface PlaceRow {
  id: string;
  slug: string;
  name: string;
  name_ar: string;
  category: CategoryId;
  area: string;
  area_ar: string;
  lat: number;
  lng: number;
  rating: number | null;
  price_level: 1 | 2 | 3;
  emoji: string;
  tagline_ar: string;
  description_ar: string;
  highlights_ar: string[];
  best_time_ar: string;
  setting: "indoor" | "outdoor" | "mixed" | null;
  season_ar: string | null;
  tags_ar: string[] | null;
  logo_url: string | null;
  bio_ar: string | null;
  image_urls: string[] | null;
  phone: string | null;
  instagram: string | null;
  website: string | null;
  products_ar: string[] | null;
  menu_ar: unknown;
  accepts_orders: boolean | null;
  order_note_ar: string | null;
  order_prep_minutes: number | null;
  order_whatsapp: string | null;
  salon_kind: string | null;
  takes_queue: boolean | null;
  queue_service_minutes: number | null;
  featured: boolean;
  published: boolean;
  sort_order: number;
}

export function rowToPlace(r: PlaceRow): Place {
  return {
    slug: r.slug,
    name: r.name,
    nameAr: r.name_ar,
    category: r.category,
    area: r.area,
    areaAr: r.area_ar,
    lat: r.lat,
    lng: r.lng,
    // Number(null) is 0, which would render as a real rating of zero.
    rating: r.rating === null || r.rating === undefined ? undefined : Number(r.rating),
    priceLevel: r.price_level,
    emoji: r.emoji,
    taglineAr: r.tagline_ar,
    descriptionAr: r.description_ar,
    highlightsAr: r.highlights_ar ?? [],
    bestTimeAr: r.best_time_ar,
    setting: r.setting ?? "mixed",
    seasonAr: r.season_ar ?? "",
    tagsAr: r.tags_ar ?? [],
    featured: r.featured,
    logoUrl: r.logo_url ?? undefined,
    bioAr: r.bio_ar || undefined,
    imageUrls: r.image_urls?.length ? r.image_urls : undefined,
    phone: r.phone || undefined,
    instagram: r.instagram || undefined,
    website: r.website || undefined,
    productsAr: r.products_ar?.length ? r.products_ar : undefined,
    menuAr: Array.isArray(r.menu_ar) && r.menu_ar.length ? (r.menu_ar as Place["menuAr"]) : undefined,
    acceptsOrders: r.accepts_orders ?? undefined,
    orderNoteAr: r.order_note_ar || undefined,
    orderPrepMinutes: r.order_prep_minutes ?? undefined,
    orderWhatsApp: r.order_whatsapp || undefined,
    salonKind: r.salon_kind === "men" || r.salon_kind === "women" ? r.salon_kind : undefined,
    takesQueue: r.takes_queue ?? undefined,
    queueServiceMinutes: r.queue_service_minutes ?? undefined,
  };
}

/** The row the server is asked to write. `scripts/gen-places-json.mjs` writes
 *  the export's `data/places.json` in this exact shape, which is what `seed`
 *  reads — so the catalogue, the admin's edits and the seed agree on one
 *  spelling of every column. */
export function placeToRow(p: Place & { published?: boolean; sortOrder?: number }) {
  return {
    slug: p.slug,
    name: p.name,
    name_ar: p.nameAr,
    category: p.category,
    area: p.area,
    area_ar: p.areaAr,
    lat: p.lat,
    lng: p.lng,
    rating: p.rating ?? null,
    price_level: p.priceLevel,
    emoji: p.emoji,
    tagline_ar: p.taglineAr,
    description_ar: p.descriptionAr,
    highlights_ar: p.highlightsAr,
    best_time_ar: p.bestTimeAr,
    setting: p.setting,
    season_ar: p.seasonAr,
    tags_ar: p.tagsAr,
    logo_url: p.logoUrl ?? null,
    bio_ar: p.bioAr ?? "",
    image_urls: p.imageUrls ?? [],
    phone: p.phone ?? "",
    instagram: p.instagram ?? "",
    website: p.website ?? "",
    products_ar: p.productsAr ?? [],
    menu_ar: p.menuAr ?? [],
    accepts_orders: !!p.acceptsOrders,
    order_note_ar: p.orderNoteAr ?? "",
    order_prep_minutes: clampPrepMinutes(p.orderPrepMinutes),
    order_whatsapp: p.orderWhatsApp ?? "",
    salon_kind: p.salonKind ?? "",
    takes_queue: !!p.takesQueue,
    queue_service_minutes: clampServiceMinutes(p.queueServiceMinutes),
    featured: !!p.featured,
    published: p.published ?? true,
    sort_order: p.sortOrder ?? 0,
  };
}
