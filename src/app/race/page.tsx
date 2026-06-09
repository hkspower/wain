import type { Metadata } from "next";
import RaceClient from "./RaceClient";

export const metadata: Metadata = {
  title: "Gulf Road Nights — ليالي شارع الخليج | Wain?",
  description:
    "Kuwait Xtreme Racer: midnight highway battles on Gulf Road. Flash your headlights, drain rival spirit, and become King of Gulf Road.",
};

export default function RacePage() {
  return <RaceClient />;
}
