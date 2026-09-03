import { NextResponse } from "next/server";
import { buildCars, buildParts, GRN_API_VERSION, GRN_CACHE_CONTROL } from "@/game/api";

export const dynamic = "force-static";

export function GET() {
  const cars = buildCars();
  return NextResponse.json(
    { apiVersion: GRN_API_VERSION, count: cars.length, cars, parts: buildParts() },
    { headers: { "Cache-Control": GRN_CACHE_CONTROL } }
  );
}
