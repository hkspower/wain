import type { Metadata } from "next";
import HubLobby from "./HubLobby";

export const metadata: Metadata = {
  title: "Online Hub — Night Racer | Wain?",
  description:
    "The Night Racer online hub: see who's cruising, chat, check the best-lap leaderboard, and join the shared midnight cruise.",
};

export default function HubPage() {
  return <HubLobby />;
}
