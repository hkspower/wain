import type { Metadata } from "next";
import HubLobby from "./HubLobby";

export const metadata: Metadata = {
  title: "Online Hub — Night Racers",
  description:
    "The Night Racers online hub: see who's cruising, chat, check the best-lap leaderboard, and join the shared midnight cruise.",
};

export default function HubPage() {
  return <HubLobby />;
}
