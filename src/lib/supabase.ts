"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseEnabled) return null;
  client ??= createClient(URL_, ANON, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
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
    featured: r.featured,
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
    featured: !!p.featured,
    published: p.published ?? true,
    sort_order: p.sortOrder ?? 0,
  };
}
