import type { Metadata } from "next";
import HubLobby from "./HubLobby";

export const metadata: Metadata = {
  title: "Online Hub — Night Racer",
  description:
    "The Night Racer online hub: see who's cruising, chat, check the best-lap leaderboard, and join the shared midnight cruise.",
};

export default function HubPage() {
  return <HubLobby />;
}
