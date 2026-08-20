"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Team,
  TeamLogo,
  DEFAULT_LOGO,
  LOGO_SHAPES,
  LOGO_SYMBOLS,
  LOGO_COLORS,
  teamLogoDataUrl,
  sanitizeTag,
} from "@/game/teams";
import {
  HubClient,
  HubPlayer,
  LapEntry,
  DEFAULT_HUB_URL,
  loadProfile,
  saveProfile,
  formatLap,
} from "@/game/net";
import {
  inviteCode,
  inviteLink,
  isCodeShaped,
  markReferralPaid,
  normaliseCode,
  paidReferrals,
  playerId,
  REFERRAL_KD,
} from "@/game/community";
import { addKd } from "@/game/mods";
import type { ReferralState } from "@/game/net";

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
  const [teams, setTeams] = useState<Team[]>([]);
  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamTag, setTeamTag] = useState("");
  const [logo, setLogo] = useState<TeamLogo>(DEFAULT_LOGO);
  const [referral, setReferral] = useState<ReferralState | null>(null);
  const [codeDraft, setCodeDraft] = useState("");
  const [refMsg, setRefMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [myCode, setMyCode] = useState("");

  const clientRef = useRef<HubClient | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatKey = useRef(0);

  useEffect(() => {
    const p = loadProfile();
    setName(p.name);
    if (CAR_COLORS.includes(p.color)) setColor(p.color);
    // The code is derived from an id in local storage, so it exists
    // before the socket does and survives every reload.
    setMyCode(inviteCode(playerId()));
    // An invite link drops the friend's code straight into the box, so
    // the only thing left to do is press the button.
    try {
      const fromLink = new URLSearchParams(location.search).get("invite");
      if (fromLink) setCodeDraft(normaliseCode(fromLink));
    } catch {}
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
        // The server keeps the ledger; this only banks what it says is
        // owed. Rewards are paid into the save FIRST and acknowledged
        // afterwards — acknowledge first and a reload in the wrong
        // half-second loses somebody ten dinars that nothing can give
        // back. Paying twice is the failure this cannot have, so the
        // token list in local storage is checked as well.
        onReferralState: (st) => {
          setReferral(st);
          const already = paidReferrals();
          const fresh = st.owed.filter((o) => !already.includes(o.token));
          if (fresh.length) {
            const total = fresh.reduce((sum, o) => sum + o.kd, 0);
            addKd(total);
            for (const o of fresh) markReferralPaid(o.token);
            setRefMsg({ ok: true, text: `+${total} KD — ${fresh[0].why}` });
          }
          if (st.owed.length) clientRef.current?.bankRewards(st.owed.map((o) => o.token));
        },
        onReferralResult: (ok, reason) => setRefMsg({ ok, text: reason }),
        onTeams: setTeams,
        onMyTeam: (t) => {
          setMyTeam(t);
          setShowCreate(false);
          // Mirror the crew into the local profile so the race scene can
          // decal the car and show the tag while playing solo
          const p = loadProfile();
          saveProfile({
            ...p,
            teamTag: t?.tag,
            teamName: t?.name,
            teamLogo: t?.logo,
          });
        },
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
    <div className="fixed inset-0 z-[60] overflow-y-auto menu-backdrop text-white">
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
          <div className="grn-ar mt-2 text-xl text-white/75" dir="rtl" lang="ar">
            تجمع شارع الخليج
          </div>
        </div>

        {/* Profile + join */}
        {status !== "online" && (
          <div className="grn-panel mx-auto mt-8 max-w-md p-7">
            <label className="grn-label text-[0.64rem]">
              Driver name — <span className="grn-ar" lang="ar">اسم السائق</span>
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
              Car colour — <span className="grn-ar" lang="ar">لون السيارة</span>
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
              {status === "connecting" ? "CONNECTING…" : <>JOIN THE HUB — <span className="grn-ar" lang="ar">يلا</span></>}
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
                ENTER THE CRUISE
              </Link>
              <p className="mt-2 text-center text-[11px] text-white/40">
                {myTeam
                  ? `Racing as [${myTeam.tag}] ${myTeam.name}`
                  : "Racing solo — join or found a crew below"}
              </p>
            </div>

            {/* Chat */}
            <div className="grn-panel flex flex-col p-5">
              <h2 className="grn-label border-b border-white/10 pb-2 text-[0.66rem]">
                Diwaniya chat — <span className="grn-ar" lang="ar">الديوانية</span>
              </h2>
              <div className="mt-3 h-64 flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm">
                {chat.length === 0 && (
                  <p className="text-white/30">No messages yet — say salam</p>
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

            {/* Crews */}
            <div className="grn-panel p-5 lg:col-span-3">
              <div className="flex items-center justify-between">
                <h2 className="grn-label text-[0.66rem]">
                  Crews — <span className="grn-ar" lang="ar">الفرق</span>
                </h2>
                {myTeam ? (
                  <button
                    onClick={() => clientRef.current?.leaveTeam()}
                    className="grn-btn border border-white/20 px-4 py-1.5 text-xs text-white/70 hover:bg-white/10"
                  >
                    LEAVE CREW
                  </button>
                ) : (
                  <button
                    onClick={() => setShowCreate((v) => !v)}
                    className="grn-btn grn-btn-ghost px-4 py-1.5 text-xs"
                  >
                    {showCreate ? "CANCEL" : "+ CREATE CREW"}
                  </button>
                )}
              </div>

              {/* Your crew */}
              {myTeam && (
                <div className="mt-4 flex items-center gap-5 border-b border-white/10 pb-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={teamLogoDataUrl(myTeam.logo, 160, myTeam.tag)}
                    alt={`${myTeam.name} emblem`}
                    className="size-24 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="grn-display text-3xl italic leading-none">{myTeam.name}</div>
                    <div className="grn-label mt-1 text-[0.6rem] text-sodium-400">
                      [{myTeam.tag}] · founded by {myTeam.founder}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {myTeam.members.map((m) => (
                        <span key={m.name} className="flex items-center gap-1.5">
                          <span
                            className={`size-1.5 rounded-full ${
                              m.online ? "bg-emerald-400" : "bg-white/25"
                            }`}
                          />
                          <span className={m.online ? "text-white/90" : "text-white/45"}>
                            {m.name}
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Create form */}
              {showCreate && !myTeam && (
                <div className="mt-4 grid gap-5 border-b border-white/10 pb-5 sm:grid-cols-[auto_1fr]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={teamLogoDataUrl(logo, 160, teamTag || "TAG")}
                    alt="crew emblem preview"
                    className="size-28"
                  />
                  <div>
                    <div className="flex flex-wrap gap-3">
                      <div className="min-w-[12rem] flex-1">
                        <label className="grn-label text-[0.58rem]">Crew name</label>
                        <input
                          value={teamName}
                          onChange={(e) => setTeamName(e.target.value)}
                          maxLength={28}
                          placeholder="Salmiya Street Kings"
                          className="mt-1 w-full rounded-lg border border-white/15 bg-black/45 px-3 py-2 text-sm font-semibold outline-none focus:border-gulf-400"
                        />
                      </div>
                      <div className="w-24">
                        <label className="grn-label text-[0.58rem]">Tag</label>
                        <input
                          value={teamTag}
                          onChange={(e) => setTeamTag(sanitizeTag(e.target.value))}
                          placeholder="SSK"
                          className="grn-display mt-1 w-full rounded-lg border border-white/15 bg-black/45 px-3 py-2 text-center text-sm outline-none focus:border-gulf-400"
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-4">
                      <div>
                        <label className="grn-label text-[0.55rem]">Shape</label>
                        <div className="mt-1 flex gap-1.5">
                          {LOGO_SHAPES.map((sh) => (
                            <button
                              key={sh}
                              onClick={() => setLogo({ ...logo, shape: sh })}
                              className={`rounded-md border px-2.5 py-1 text-[0.7rem] capitalize transition ${
                                logo.shape === sh
                                  ? "border-gulf-400 text-gulf-300"
                                  : "border-white/15 text-white/60 hover:border-white/35"
                              }`}
                            >
                              {sh}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="grn-label text-[0.55rem]">Colours</label>
                        <div className="mt-1 flex gap-1.5">
                          {LOGO_COLORS.slice(0, 6).map((c) => (
                            <button
                              key={c}
                              onClick={() => setLogo({ ...logo, fg: c })}
                              aria-label={`accent ${c}`}
                              className={`size-6 rounded-full border-2 transition ${
                                logo.fg === c ? "scale-110 border-white" : "border-white/25"
                              }`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <label className="grn-label text-[0.55rem]">Emblem</label>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {LOGO_SYMBOLS.map((sym) => (
                          <button
                            key={sym}
                            onClick={() => setLogo({ ...logo, symbol: sym })}
                            className={`rounded-md border px-2 py-1 text-base transition ${
                              logo.symbol === sym
                                ? "border-gulf-400 bg-gulf-500/15"
                                : "border-white/10 hover:border-white/30"
                            }`}
                          >
                            {sym}
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        const n = teamName.trim();
                        const tg = sanitizeTag(teamTag);
                        if (!n || !tg) return;
                        clientRef.current?.createTeam(n, tg, logo);
                      }}
                      disabled={!teamName.trim() || !sanitizeTag(teamTag)}
                      className="grn-btn grn-btn-primary mt-4 px-6 py-2.5 text-sm disabled:opacity-40"
                    >
                      FOUND THE CREW — <span className="grn-ar" lang="ar">أسس فريقك</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Everyone else's crews */}
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {teams.length === 0 && (
                  <p className="text-sm text-white/35">
                    No crews yet — found the first one, or keep racing solo.
                  </p>
                )}
                {teams.map((t) => (
                  <div
                    key={t.id}
                    className={`flex items-center gap-3 rounded-xl border p-3 ${
                      myTeam?.id === t.id ? "border-sodium-400/70 bg-sodium-500/10" : "border-white/12"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={teamLogoDataUrl(t.logo, 96, t.tag)}
                      alt={`${t.name} emblem`}
                      className="size-14 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="grn-display truncate text-lg leading-tight">{t.name}</div>
                      <div className="grn-label text-[0.55rem]">
                        [{t.tag}] · {t.members.length}{" "}
                        {t.members.length === 1 ? "driver" : "drivers"}
                      </div>
                    </div>
                    {!myTeam && (
                      <button
                        onClick={() => clientRef.current?.joinTeam(t.id)}
                        className="grn-btn grn-btn-ghost shrink-0 px-3 py-1.5 text-xs"
                      >
                        JOIN
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Community — invite a friend, both of you get paid.
                Every number here comes off the socket. The client keeps
                no count of its own: a referral tally a player can edit
                is not a referral tally. */}
            <div className="grn-panel p-5">
              <h2 className="grn-label border-b border-white/10 pb-2 text-[0.66rem]">
                Community — <span className="grn-ar" lang="ar">المجتمع</span>
              </h2>
              <p className="mt-1 text-[11px] leading-5 text-white/35">
                Send a friend your code. When they use it, you both get{" "}
                {REFERRAL_KD} KD — which is a whole starting balance each.
              </p>

              <div className="mt-4">
                <div className="grn-label text-[0.58rem] text-white/45">Your code</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="grn-display flex-1 rounded border border-white/15 bg-black/30 px-3 py-2 text-lg tracking-[0.3em] text-sodium-400">
                    {myCode || "—"}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(inviteLink(myCode)).then(
                        () => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1800);
                        },
                        () => setRefMsg({ ok: false, text: "Could not reach the clipboard." })
                      );
                    }}
                    disabled={!myCode}
                    className="grn-btn-primary shrink-0 px-3 py-2 text-[0.7rem] disabled:opacity-40"
                  >
                    {copied ? "Copied ✓" : "Copy link"}
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-white/40">
                  <span>
                    {referral === null
                      ? "Connecting…"
                      : `${referral.invited} friend${referral.invited === 1 ? "" : "s"} joined`}
                  </span>
                  {referral !== null && referral.invited > 0 && (
                    <span className="text-emerald-300">
                      {referral.invited * REFERRAL_KD} KD earned
                    </span>
                  )}
                </div>
              </div>

              {/* Redeeming is once per save, so once it is done the box
                  goes away rather than sitting there refusing. */}
              {referral?.used ? (
                <p className="mt-4 rounded border border-emerald-400/30 bg-emerald-400/5 px-3 py-2 text-[11px] text-emerald-200">
                  You joined on a friend&apos;s invite. That one is spent — yours still works.
                </p>
              ) : (
                <div className="mt-4">
                  <div className="grn-label text-[0.58rem] text-white/45">
                    Got a friend&apos;s code?
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      value={codeDraft}
                      onChange={(e) => setCodeDraft(normaliseCode(e.target.value))}
                      placeholder="ABC234"
                      maxLength={6}
                      className="grn-display w-full rounded border border-white/15 bg-black/30 px-3 py-2 text-lg tracking-[0.3em] uppercase outline-none focus:border-gulf-400"
                    />
                    <button
                      onClick={() => {
                        setRefMsg(null);
                        clientRef.current?.claimInvite(codeDraft);
                      }}
                      disabled={!isCodeShaped(codeDraft) || status !== "online"}
                      className="grn-btn-primary shrink-0 px-3 py-2 text-[0.7rem] disabled:opacity-40"
                    >
                      Redeem
                    </button>
                  </div>
                </div>
              )}

              {refMsg && (
                <p
                  className={`mt-3 text-[11px] ${
                    refMsg.ok ? "text-emerald-300" : "text-red-300"
                  }`}
                >
                  {refMsg.text}
                </p>
              )}
            </div>

            {/* Leaderboard */}
            <div className="grn-panel p-5">
              <h2 className="grn-label border-b border-white/10 pb-2 text-[0.66rem]">
                Best laps — <span className="grn-ar" lang="ar">أفضل اللفات</span>
              </h2>
              <p className="mt-1 text-[11px] text-white/35">
                Full 8.5 km laps — Gulf Road out, the Second Ring back
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
