import { NextResponse } from "next/server";
import { buildTrack, GRN_API_VERSION, GRN_CACHE_CONTROL } from "@/game/api";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    { apiVersion: GRN_API_VERSION, track: buildTrack() },
    { headers: { "Cache-Control": GRN_CACHE_CONTROL } }
  );
}
