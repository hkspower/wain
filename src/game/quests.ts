// Something to do while you are out there with other people.
//
// Online, this game is a headcount, a chat feed and a duel you can start
// by flashing somebody. That is a place to be, and it is not a thing to
// do: two drivers who do not want to race have no reason to stay near
// each other, so the road empties into people cruising alone in the same
// world.
//
// So: runs. Small, named objectives that can only be finished with
// somebody else on the road, worded the way the rest of this game is
// worded and counted from things the engine already watches — how many
// other cars it has seen, how long it has been in one's wake, whether a
// drift happened near one, whether a duel was won.
//
// WHAT A RUN IS NOT
//
// It is not a daily, it is not a login streak, and it does not expire at
// midnight to make you come back. The night already ends at 05:50; the
// game does not need a second clock nagging at the player.
//
// And the rewards are small on purpose. community.ts is blunt about why:
// "the wallet is a number in local storage — anybody who opens developer
// tools can set it to a million". A run that paid a car would be a lie
// about what this can enforce. What it pays is enough to notice and not
// enough to farm, and what it is really for is a reason to stay
// alongside somebody for two more corners.

/** What the game counts while you are online. Every field is a running
 *  total for the current save, persisted next to the garage. */
export interface QuestProgress {
  /** Distinct other drivers seen on the road, all time. */
  metDrivers: number;
  /** Metres driven within TOGETHER_M of another player. */
  togetherM: number;
  /** Seconds spent in another player's slipstream. */
  towSeconds: number;
  /** Duels won. */
  duelWins: number;
  /** Seconds held within MATCHED_KMH of another player, both above
   *  MATCHED_FLOOR_KMH. */
  matchedSeconds: number;
  /** Drift score banked while another player was within TOGETHER_M. */
  driftBeside: number;
}

export const EMPTY_PROGRESS: QuestProgress = {
  metDrivers: 0,
  togetherM: 0,
  towSeconds: 0,
  duelWins: 0,
  matchedSeconds: 0,
  driftBeside: 0,
};

/** How close counts as "with somebody", in metres. A lane and a half:
 *  close enough to be deliberate, wide enough that it does not demand
 *  paint-swapping to earn. */
export const TOGETHER_M = 12;
/** How near you have to get before you have MET somebody, in metres.
 *  Wider than TOGETHER_M, because passing close enough to read a
 *  stranger's plate and nod is not the same thing as running with them,
 *  and the first run in the list should be the easy one. */
export const MET_M = 60;
/** Within this of each other's speed counts as matched. */
export const MATCHED_KMH = 6;
/** ...and both of you have to be actually moving for it to mean
 *  anything. Two cars parked side by side are not running together. */
export const MATCHED_FLOOR_KMH = 120;

export interface Quest {
  id: string;
  /** The name, on the card. */
  name: string;
  ar: string;
  /** What to do, in one line. */
  hint: string;
  hintAr: string;
  /** Which running total this reads. */
  metric: keyof QuestProgress;
  /** ...and what it has to reach. */
  target: number;
  /** How the number is shown: a plain count, metres, or seconds. */
  unit: "count" | "metres" | "seconds";
  /** Paid once, in KD. Small — see the header. */
  reward: number;
}

/**
 * The runs.
 *
 * Ordered the way a night goes: you meet somebody, you end up driving
 * with them, you get in their wake, you match them, one of you flashes,
 * and by then you are sideways next to a stranger at four in the
 * morning, which is the entire point of the game.
 */
export const QUESTS: Quest[] = [
  {
    id: "salam",
    name: "Say salam",
    ar: "سلّم عليهم",
    hint: "Meet five other drivers out on the road",
    hintAr: "قابل خمسة سواقين على الشارع",
    metric: "metDrivers",
    target: 5,
    unit: "count",
    reward: 150,
  },
  {
    id: "convoy",
    name: "Two of you",
    ar: "أنت وياه",
    hint: "Drive ten kilometres with somebody in the next lane",
    hintAr: "سوق عشر كيلو ومعك واحد بالحارة الثانية",
    metric: "togetherM",
    target: 10000,
    unit: "metres",
    reward: 300,
  },
  {
    id: "wake",
    name: "In their wake",
    ar: "بسحبته",
    hint: "Sit in another driver's slipstream for a minute, all told",
    hintAr: "خلّك بسحبة واحد ثاني لمدة دقيقة كاملة",
    metric: "towSeconds",
    target: 60,
    unit: "seconds",
    reward: 250,
  },
  {
    id: "matched",
    name: "Same speed",
    ar: "نفس السرعة",
    hint: "Hold their pace, side by side, above 120 for half a minute",
    hintAr: "امش بسرعته جنب بجنب فوق ١٢٠ لمدة نص دقيقة",
    metric: "matchedSeconds",
    target: 30,
    unit: "seconds",
    reward: 350,
  },
  {
    id: "sideways",
    name: "Sideways beside them",
    ar: "درِفت جنبه",
    hint: "Bank a thousand points of drift with somebody alongside",
    // The house spelling of the borrowed word carries a kasra —
    // "الدرِفت", as the drift circle is named on the map — and a line
    // where one word in six is vowelled and the rest are bare is the
    // thing the grammar check asks not to do. The name above carries the
    // word; the hint does not need it twice.
    hintAr: "اجمع ألف نقطة وواحد جنبك",
    metric: "driftBeside",
    target: 1000,
    unit: "count",
    reward: 400,
  },
  {
    id: "answered",
    name: "Answered the flash",
    ar: "رد على الفلاش",
    hint: "Win three duels against other players",
    hintAr: "اربح ثلاث مواجهات ضد لاعبين",
    metric: "duelWins",
    target: 3,
    unit: "count",
    reward: 500,
  },
];

/** How far along one run is, 0..1. */
export function questFraction(q: Quest, p: QuestProgress): number {
  const have = p[q.metric] ?? 0;
  if (q.target <= 0) return 1;
  return Math.max(0, Math.min(1, have / q.target));
}

/** Done, and stays done. */
export function questDone(q: Quest, p: QuestProgress): boolean {
  return (p[q.metric] ?? 0) >= q.target;
}

/** The progress line under a run's name — "3 / 5", "4.2 / 10 km". */
export function questLabel(q: Quest, p: QuestProgress): string {
  const have = p[q.metric] ?? 0;
  if (q.unit === "metres") {
    return `${(Math.min(have, q.target) / 1000).toFixed(1)} / ${(q.target / 1000).toFixed(0)} km`;
  }
  if (q.unit === "seconds") {
    return `${Math.floor(Math.min(have, q.target))} / ${q.target} s`;
  }
  return `${Math.floor(Math.min(have, q.target))} / ${q.target}`;
}

/**
 * Everything finished that was not finished before.
 *
 * Returns the runs that crossed their target between two snapshots, so
 * the caller can pay and announce exactly once. Comparing snapshots
 * rather than holding a "claimed" flag means a save that is rolled back
 * cannot double-pay, and one that is edited cannot skip the payment
 * either — the answer is a function of the two numbers.
 */
export function newlyDone(before: QuestProgress, after: QuestProgress): Quest[] {
  return QUESTS.filter((q) => !questDone(q, before) && questDone(q, after));
}


// ---------------------------------------------------------------------
// Where the totals live.
//
// Next to the garage, in local storage, for the same reason the garage
// is: there are no accounts in this game. See community.ts, which is
// blunt about what that means and what it does not.

const KEY = "gulf-road-nights-runs";

export function loadProgress(): QuestProgress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_PROGRESS };
    const j = JSON.parse(raw) as Partial<QuestProgress>;
    const out = { ...EMPTY_PROGRESS };
    for (const k of Object.keys(EMPTY_PROGRESS) as Array<keyof QuestProgress>) {
      const v = j[k];
      // A total that is not a finite number is not a total. Anything
      // else here — a string, a NaN out of an old save — would poison
      // every comparison downstream and never recover, because these
      // only ever accumulate.
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = v;
    }
    return out;
  } catch {
    return { ...EMPTY_PROGRESS };
  }
}

export function saveProgress(p: QuestProgress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private mode, quota, a browser that has said no — the runs are
       not worth failing a frame over. */
  }
}
