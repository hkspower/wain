import { NextResponse } from "next/server";
import { GRN_API_VERSION, GRN_CACHE_CONTROL } from "@/game/api";
import { RIVALS } from "@/game/rivals";
import { CARS } from "@/game/mods";

// Discovery document: what a client should hit and what it will find.
// The Unreal client reads this first and refuses payloads whose
// apiVersion it does not understand.
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(
    {
      apiVersion: GRN_API_VERSION,
      game: "Gulf Road Nights",
      arabicName: "ليالي شارع الخليج",
      endpoints: {
        gamedata: "/api/grn/v1/gamedata",
        track: "/api/grn/v1/track",
        rivals: "/api/grn/v1/rivals",
        cars: "/api/grn/v1/cars",
      },
      counts: { rivals: RIVALS.length, cars: CARS.length },
      /** The realtime cruise lives on the hub server, not here. */
      hub: {
        websocket: process.env.NEXT_PUBLIC_HUB_WS ?? "ws://localhost:8787",
        rest: "http://localhost:8787/api",
      },
    },
    { headers: { "Cache-Control": GRN_CACHE_CONTROL } }
  );
}
