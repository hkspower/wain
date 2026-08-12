import { NextResponse } from "next/server";
import { buildRivals, GRN_API_VERSION } from "@/game/api";

export const dynamic = "force-static";

export function GET() {
  const rivals = buildRivals();
  return NextResponse.json(
    { apiVersion: GRN_API_VERSION, count: rivals.length, rivals },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}
