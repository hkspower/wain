import type { Metadata } from "next";
import RaceClient from "./RaceClient";

export const metadata: Metadata = {
  title: "Night Racers — متسابقو الليل",
  description:
    "Night Racers: midnight battles on the Gulf Road. Flash your headlights, drain a rival's spirit, and become King of Gulf Road.",
};

export default function RacePage() {
  return <RaceClient />;
}
