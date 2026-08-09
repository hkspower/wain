"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  HubClient,
  HubPlayer,
  LapEntry,
  DEFAULT_HUB_URL,
  loadProfile,
  saveProfile,
  formatLap,
} from "@/game/net";

const CAR_COLORS = [
  "#f2f4f7", // pearl white
  "#0a0a0c", // midnight black
  "#c1121f", // red
  "#f5c211", // yellow
  "#007a3d", // Kuwait green
  "#b84dd6", // violet
  "#38e8ff", // gulf cyan
  "#e8641b", // orange
];

type Status = "setup" | "connecting" | "online" | "offline";

interface ChatMsg {
  name: string;
  text: string;
  key: number;
}

export default function HubLobby() {
  const [name, setName] = useState("");
  const [color, setColor] = useState(CAR_COLORS[0]);
  const [status, setStatus] = useState<Status>("setup");
  const [players, setPlayers] = useState<HubPlayer[]>([]);
  const [leaderboard, setLeaderboard] = useState<LapEntry[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");

  const clientRef = useRef<HubClient | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatKey = useRef(0);

  useEffect(() => {
    const p = loadProfile();
    setName(p.name);
    if (CAR_COLORS.includes(p.color)) setColor(p.color);
    return () => {
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const join = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed || clientRef.current) return;
    saveProfile({ name: trimmed, color });
    setStatus("connecting");
    clientRef.current = new HubClient(
      {
        onWelcome: (_id, roster, lb) => {
          setStatus("online");
          setPlayers(roster);
          setLeaderboard(lb);
        },
        onJoined: (p) => setPlayers((prev) => [...prev, p]),
        onLeft: (id) => setPlayers((prev) => prev.filter((p) => p.id !== id)),
        onChat: (from, text) =>
          setChat((prev) => [...prev.slice(-60), { name: from, text, key: chatKey.current++ }]),
        onLeaderboard: setLeaderboard,
        onClose: () => {
          clientRef.current = null;
          setStatus("offline");
          setPlayers([]);
        },
        onError: () => {
          clientRef.current?.close();
          clientRef.current = null;
          setStatus("offline");
          setPlayers([]);
        },
      },
      trimmed,
      color
    );
  }, [name, color]);

  const sendChat = useCallback(() => {
    const text = draft.trim();
    if (!text || !clientRef.current) return;
    clientRef.current.sendChat(text);
    setDraft("");
  }, [draft]);

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-gradient-to-b from-[#05070f] via-[#0a1226] to-[#05070f] text-white">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-sm text-white/50 transition hover:text-white">
            ← Wain?
          </Link>
          <Link href="/race" className="text-sm text-white/50 transition hover:text-white">
            Solo mode →
          </Link>
        </div>

        <div className="mt-6 text-center">
          <div className="grn-label text-[0.75rem] tracking-[0.42em] text-gulf-400 [text-shadow:0_0_18px_rgba(56,201,238,0.45)]">
            Online Hub
          </div>
          <h1 className="grn-display mt-2 text-5xl italic leading-[0.95] sm:text-6xl">
            THE GULF ROAD <span className="text-sodium-400">CRUISE</span>
          </h1>
          <div className="grn-ar mt-2 text-xl text-white/75" dir="rtl">
            تجمع شارع الخليج
          </div>
        </div>

        {/* Profile + join */}
        {status !== "online" && (
          <div className="grn-panel mx-auto mt-8 max-w-md p-7">
            <label className="grn-label text-[0.64rem]">
              Driver name — <span className="grn-ar">اسم السائق</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && join()}
              maxLength={24}
              placeholder="Bu Dragster"
              className="mt-2 w-full rounded-lg border border-white/15 bg-black/45 px-4 py-3 text-base font-semibold outline-none transition focus:border-gulf-400 focus:ring-2 focus:ring-gulf-400/30"
            />
            <label className="grn-label mt-6 block text-[0.64rem]">
              Car colour — <span className="grn-ar">لون السيارة</span>
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {CAR_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  aria-label={`car colour ${c}`}
                  className={`size-10 rounded-full border-2 transition ${
                    color === c
                      ? "scale-110 border-gulf-300 shadow-[0_0_16px_rgba(127,227,255,0.7)]"
                      : "border-white/20 hover:border-white/50"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <button
              onClick={join}
              disabled={!name.trim() || status === "connecting"}
              className="grn-btn grn-btn-primary mt-7 w-full py-3.5 text-lg disabled:opacity-40 disabled:hover:translate-y-0"
            >
              {status === "connecting" ? "CONNECTING…" : <>JOIN THE HUB — <span className="grn-ar">يلا</span></>}
            </button>
            {status === "offline" && (
              <p className="mt-4 text-center text-xs leading-5 text-red-300">
                Couldn&apos;t reach the hub server at{" "}
                <code className="rounded bg-black/40 px-1">{DEFAULT_HUB_URL}</code>.
                <br />
                Start it with <code className="rounded bg-black/40 px-1">npm run hub</code> and try
                again.
              </p>
            )}
          </div>
        )}

        {/* Lobby */}
        {status === "online" && (
          <div className="mt-8 grid gap-6 lg:grid-cols-3">
            {/* Drivers online */}
            <div className="grn-panel p-5">
              <h2 className="grn-label border-b border-white/10 pb-2 text-[0.66rem]">
                Drivers online — <span className="text-gulf-300">{players.length}</span>
              </h2>
              <ul className="mt-3 space-y-2">
                {players.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 text-sm font-semibold">
                    <span
                      className="inline-block size-3.5 rounded-full border border-white/30"
                      style={{ backgroundColor: p.color }}
                    />
                    {p.name}
                    {clientRef.current?.selfId === p.id && (
                      <span className="text-xs font-normal text-white/40">(you)</span>
                    )}
                  </li>
                ))}
              </ul>
              <Link
                href="/race?online=1"
                className="grn-btn grn-btn-primary mt-6 block py-3.5 text-center text-lg"
              >
                ENTER THE CRUISE 🏁
              </Link>
              <p className="mt-2 text-center text-[11px] text-white/40">
                Everyone here shares the same midnight Gulf Road
              </p>
            </div>

            {/* Chat */}
            <div className="grn-panel flex flex-col p-5">
              <h2 className="grn-label border-b border-white/10 pb-2 text-[0.66rem]">
                Diwaniya chat — <span className="grn-ar">الديوانية</span>
              </h2>
              <div className="mt-3 h-64 flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm">
                {chat.length === 0 && (
                  <p className="text-white/30">No messages yet — say salam 👋</p>
                )}
                {chat.map((m) => (
                  <p key={m.key} className="leading-5">
                    <span className="font-bold text-gulf-300">{m.name}:</span>{" "}
                    <span className="text-white/85">{m.text}</span>
                  </p>
                ))}
                <div ref={chatEndRef} />
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendChat()}
                  maxLength={200}
                  placeholder="Type a message…"
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/45 px-3 py-2 text-sm outline-none transition focus:border-gulf-400"
                />
                <button
                  onClick={sendChat}
                  className="grn-btn bg-white/15 px-4 text-sm hover:bg-white/25"
                >
                  Send
                </button>
              </div>
            </div>

            {/* Leaderboard */}
            <div className="grn-panel p-5">
              <h2 className="grn-label border-b border-white/10 pb-2 text-[0.66rem]">
                Best laps — <span className="grn-ar">أفضل اللفات</span>
              </h2>
              <p className="mt-1 text-[11px] text-white/35">
                Full 7.3 km Gulf Road laps, this session
              </p>
              <ol className="mt-3 space-y-2">
                {leaderboard.length === 0 && (
                  <p className="text-sm text-white/30">No laps yet — go set one!</p>
                )}
                {leaderboard.map((e, i) => (
                  <li key={e.name} className="flex items-center justify-between text-sm">
                    <span className="font-semibold">
                      <span className={`grn-display mr-2 ${i === 0 ? "text-sodium-400" : "text-white/40"}`}>
                        {i + 1}.
                      </span>
                      {e.name}
                    </span>
                    <span className="font-mono tabular-nums text-white/80">{formatLap(e.ms)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
