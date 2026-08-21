"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CategoryId, Place } from "@/lib/places";

/**
 * Supabase is optional. With no URL/key configured the site runs exactly as it
 * does today — every page still renders from the build-time snapshot in
 * places.ts — and /admin explains what is missing instead of erroring.
 *
 * The anon key is public by design: row level security decides what it can do.
 * Reads are limited to published rows; every write additionally requires the
 * signed-in user to be listed in the `admins` table. Never put the service_role
 * key in this file — it bypasses RLS.
 */
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabaseEnabled = URL_.length > 0 && ANON.length > 0;

/**
 * Loaded on demand, never at import time.
 *
 * supabase-js is about 60KB gzipped. Importing it statically put all of that
 * into /explore, /search and /add whether or not the site was configured to
 * use it — and with no URL and key set, every one of those bytes was
 * downloaded, parsed, and never called. Behind a dynamic import it becomes a
 * separate chunk that is only ever fetched when there is something to talk to.
 *
 * The promise is cached rather than the client, so two callers racing on the
 * first load share one import and one client instead of creating two.
 */
let clientPromise: Promise<SupabaseClient> | null = null;

export async function loadSupabase(): Promise<SupabaseClient | null> {
  if (!supabaseEnabled) return null;
  clientPromise ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(URL_, ANON, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  );
  try {
    return await clientPromise;
  } catch {
    // A failed chunk fetch must not wedge the app in a broken state — let the
    // next call try again rather than caching the failure forever.
    clientPromise = null;
    return null;
  }
}

/** Shape of a row in public.places. */
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
  rating: number;
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
    rating: Number(r.rating),
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
  };
}

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
    rating: p.rating,
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
    featured: !!p.featured,
    published: p.published ?? true,
    sort_order: p.sortOrder ?? 0,
  };
}
