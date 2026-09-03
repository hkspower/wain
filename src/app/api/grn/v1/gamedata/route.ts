import { NextResponse } from "next/server";
import { buildGameData, GRN_API_VERSION, GRN_CACHE_CONTROL } from "@/game/api";

// The whole game definition in one fetch — what the Unreal client asks
// for at boot. Statically generated, so it also lands in the static
// export (out/api/grn/v1/gamedata) and can be served from a CDN, from
// the Electron shell, or straight off disk.
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(buildGameData(), {
    headers: {
      "Cache-Control": GRN_CACHE_CONTROL,
      "X-GRN-Api-Version": String(GRN_API_VERSION),
    },
  });
}
