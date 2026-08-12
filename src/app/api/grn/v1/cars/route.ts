import { NextResponse } from "next/server";
import { buildCars, buildParts, GRN_API_VERSION } from "@/game/api";

export const dynamic = "force-static";

export function GET() {
  const cars = buildCars();
  return NextResponse.json(
    { apiVersion: GRN_API_VERSION, count: cars.length, cars, parts: buildParts() },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
