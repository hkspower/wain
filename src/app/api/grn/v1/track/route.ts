import { NextResponse } from "next/server";
import { buildTrack, GRN_API_VERSION } from "@/game/api";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    { apiVersion: GRN_API_VERSION, track: buildTrack() },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
