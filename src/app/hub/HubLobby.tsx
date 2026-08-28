"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Team,
  Crew,
  DEFAULT_LOGO,
  loadCrew,
  saveCrew,
  teamLogoDataUrl,
  sanitizeTag,
} from "@/game/teams";
import CrewBuilder from "@/components/CrewBuilder";
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
import {
  QUESTS,
  EMPTY_PROGRESS,
  loadProgress,
  questDone,
  questFraction,
  questLabel,
  type QuestProgress,
} from "@/game/quests";
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
  // Read on mount, not at module scope: local storage does not exist
  // while this renders on the server.
  const [runs, setRuns] = useState<QuestProgress>(EMPTY_PROGRESS);
  const [color, setColor] = useState(CAR_COLORS[0]);
  const [status, setStatus] = useState<Status>("setup");
  const [players, setPlayers] = useState<HubPlayer[]>([]);
  const [leaderboard, setLeaderboard] = useState<LapEntry[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [teams, setTeams] = useState<Team[]>([]);
  const [myTeam, setMyTeam] = useState<Team | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // The form starts from the crew this save already flies — built in the
  // garage, most likely — so taking your own colours online is publishing
  // them, not designing them a second time from scratch.
  const [crew, setCrew] = useState<Crew>({ name: "", tag: "", logo: DEFAULT_LOGO });
  /** Whether the hub has ever said we are in a crew on this connection. */
  const hadTeam = useRef(false);
  /** The hub refused the name — somebody founded it first. */
  const [crewMsg, setCrewMsg] = useState<string | null>(null);
  useEffect(() => {
    const saved = loadCrew();
    if (saved) setCrew(saved);
  }, []);
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
    setRuns(loadProgress());
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
        onTeamTaken: (name, tag) => {
          setCrewMsg(`"${name}" [${tag}] is already somebody's crew — pick another name.`);
          setShowCreate(true);
        },
        onMyTeam: (t) => {
          setMyTeam(t);
          setCrewMsg(null);
          setShowCreate(false);
          if (t) {
            // The crew the hub says you are in is the crew this save
            // flies, so it goes where the game reads it from — one
            // store, which the car's livery and the garage both use.
            hadTeam.current = true;
            const c = { name: t.name, tag: t.tag, logo: t.logo };
            saveCrew(c);
            setCrew(c);
            return;
          }
          // No crew, according to the hub — and that is two completely
          // different things. The server sends this on every welcome,
          // so treating it as "you have no crew" would delete a crew
          // built in the garage the moment the player opened the lobby.
          if (hadTeam.current) {
            hadTeam.current = false;
            saveCrew(null);
            return;
          }
          // Otherwise the hub has simply never heard of your crew —
          // fresh connection, or the process restarted and took its
          // in-memory roster with it. Publish it again. This is what
          // makes a crew survive a hub restart from the only side that
          // actually remembers it.
          const mine = loadCrew();
          if (mine) clientRef.current?.createTeam(mine.name, mine.tag, mine.logo);
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
          <Link href="/" className="text-sm text-white/74 transition hover:text-white">
            ← Wain?
          </Link>
          <Link href="/race" className="text-sm text-white/74 transition hover:text-white">
            Solo mode →
          </Link>
        </div>

        <div className="mt-6 text-center">
          <div className="grn-label text-[0.8rem] tracking-[0.42em] text-gulf-400 [text-shadow:0_0_18px_rgba(56,201,238,0.45)]">
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
            <label className="grn-label text-[0.75rem]">
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
            <label className="grn-label mt-6 block text-[0.75rem]">
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
              <h2 className="grn-label border-b border-white/10 pb-2 text-[0.75rem]">
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
                      <span className="text-xs font-normal text-white/66">(you)</span>
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
              <p className="mt-2 text-center text-[11px] text-white/66">
                {myTeam
                  ? `Racing as [${myTeam.tag}] ${myTeam.name}`
                  : "Racing solo — join or found a crew below"}
              </p>
            </div>

            {/* Chat */}
            <div className="grn-panel flex flex-col p-5">
              <h2 className="grn-label border-b border-white/10 pb-2 text-[0.75rem]">
                Diwaniya chat — <span className="grn-ar" lang="ar">الديوانية</span>
              </h2>
              <div className="mt-3 h-64 flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm">
                {chat.length === 0 && (
                  <p className="text-white/58">No messages yet — say salam</p>
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
                <h2 className="grn-label text-[0.75rem]">
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
                    <div className="grn-label mt-1 text-[0.7rem] text-sodium-400">
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
                          <span className={m.online ? "text-white/90" : "text-white/70"}>
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
                <div className="mt-4 border-b border-white/10 pb-5">
                  <CrewBuilder value={crew} onChange={setCrew} size={112} />
                  <button
                    onClick={() => {
                      const n = crew.name.trim();
                      const tg = sanitizeTag(crew.tag);
                      if (!n || !tg) return;
                      // Saved locally first. The socket may drop the
                      // message, the hub may restart, and the crew is
                      // still yours and still on the car either way.
                      saveCrew({ name: n, tag: tg, logo: crew.logo });
                      setCrewMsg(null);
                      clientRef.current?.createTeam(n, tg, crew.logo);
                    }}
                    disabled={!crew.name.trim() || !sanitizeTag(crew.tag)}
                    className="grn-btn grn-btn-primary mt-4 px-6 py-2.5 text-sm disabled:opacity-40"
                  >
                    FOUND THE CREW — <span className="grn-ar" lang="ar">أسس فريقك</span>
                  </button>
                  {crewMsg && (
                    <p className="mt-3 text-sm text-red-300">{crewMsg}</p>
                  )}
                </div>
              )}

              {/* Everyone else's crews */}
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {teams.length === 0 && (
                  <p className="text-sm text-white/62">
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
                      <div className="grn-label text-[0.7rem]">
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
              <h2 className="grn-label border-b border-white/10 pb-2 text-[0.75rem]">
                Community — <span className="grn-ar" lang="ar">المجتمع</span>
              </h2>
              <p className="mt-1 text-[11px] leading-5 text-white/62">
                Send a friend your code. When they use it, you both get{" "}
                {REFERRAL_KD} KD — which is a whole starting balance each.
              </p>

              <div className="mt-4">
                <div className="grn-label text-[0.7rem] text-white/70">Your code</div>
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
                    className="grn-btn-primary shrink-0 px-3 py-2 text-[0.8rem] disabled:opacity-40"
                  >
                    {copied ? "Copied ✓" : "Copy link"}
                  </button>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-white/66">
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
                  <div className="grn-label text-[0.7rem] text-white/70">
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
                      className="grn-btn-primary shrink-0 px-3 py-2 text-[0.8rem] disabled:opacity-40"
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

            {/* The runs. quests.ts is the design and the wording; this
                only draws them. They live here rather than in the pause
                menu because every one of them needs another player, and
                this is the page about other players. */}
            <div className="grn-panel p-5">
              <h2 className="grn-label border-b border-white/10 pb-2 text-[0.75rem]">
                Runs — <span className="grn-ar" lang="ar">المشاوير</span>
              </h2>
              <p className="mt-1 text-[11px] leading-5 text-white/62">
                Things you can only do with somebody else on the road. Nothing here expires —
                the night ends at 05:50 and that is clock enough.
              </p>
              <ul className="mt-4 space-y-3">
                {QUESTS.map((q) => {
                  const done = questDone(q, runs);
                  return (
                    <li key={q.id}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span
                          className={`grn-label text-[0.72rem] ${
                            done ? "text-emerald-300" : "text-white/85"
                          }`}
                        >
                          {done ? "✓ " : ""}
                          {q.name}
                          {" · "}
                          <span className="grn-ar" lang="ar">
                            {q.ar}
                          </span>
                        </span>
                        <span
                          className={`shrink-0 font-mono text-[11px] tabular-nums ${
                            done ? "text-emerald-300" : "text-white/70"
                          }`}
                        >
                          {done ? `${q.reward} KD` : questLabel(q, runs)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-4 text-white/62">{q.hint}</p>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/12">
                        <div
                          className={`h-full rounded-full ${
                            done ? "bg-emerald-400" : "bg-sodium-400"
                          }`}
                          style={{ width: `${(questFraction(q, runs) * 100).toFixed(1)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Leaderboard */}
            <div className="grn-panel p-5">
              <h2 className="grn-label border-b border-white/10 pb-2 text-[0.75rem]">
                Best laps — <span className="grn-ar" lang="ar">أفضل اللفات</span>
              </h2>
              <p className="mt-1 text-[11px] text-white/62">
                Full 8.5 km laps — Gulf Road out, the Second Ring back
              </p>
              <ol className="mt-3 space-y-2">
                {leaderboard.length === 0 && (
                  <p className="text-sm text-white/58">No laps yet — go set one!</p>
                )}
                {leaderboard.map((e, i) => (
                  <li key={e.name} className="flex items-center justify-between text-sm">
                    <span className="font-semibold">
                      <span className={`grn-display mr-2 ${i === 0 ? "text-sodium-400" : "text-white/66"}`}>
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
