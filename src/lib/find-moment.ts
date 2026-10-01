import { isSummerMonth, kuwaitHour, kuwaitMonth } from "@/lib/kuwait-time";

/**
 * What /find says depends on when you open it.
 *
 * The page was the same sentence at seven in the morning in August and at
 * midnight in January — «قهوة، بحر، طلعة عيال» — so a visitor at noon in
 * July was offered the beach at the hour this site's own hangout rules call
 * unbearable (`bakesInTheSun`). The examples now follow the part of the day
 * and the season, in Kuwait's time rather than the phone's, and the opening
 * word follows the hour.
 *
 * Catalogue-free on purpose: no place is named, so nothing here needs the 52
 * records, and the moment is the only input.
 *
 * The static HTML keeps the evening line (`FIND_DEFAULT`): that is what a
 * page built at no hour at all can honestly say, and it is replaced once the
 * page knows the time — never in the HTML, which is built once and served
 * at every hour.
 */
export type DayPart = "morning" | "noon" | "evening" | "night";

/** 05–11 morning, 12–15 the heat of the day, 16–20 evening, 21–04 night. */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 16) return "noon";
  if (hour >= 16 && hour < 21) return "evening";
  return "night";
}

const OPENER: Record<DayPart, string> = {
  morning: "صباح الخير!",
  noon: "هلا!",
  evening: "مساء الخير!",
  night: "هلا بالسهرانين!",
};

/**
 * Three things to ask for. In summer nothing outdoors is offered by day: the
 * morning walk becomes somewhere cool, noon becomes a mall, and the sea waits
 * until after sunset — the same rule the hangout planner applies.
 */
const EXAMPLES: Record<DayPart, { summer: string; rest: string }> = {
  morning: { rest: "فطور، قهوة، مشي على البحر", summer: "فطور، قهوة، مكان مكيّف" },
  noon: { rest: "غدا، قهوة، طلعة عيال", summer: "غدا، مول مكيّف، طلعة عيال" },
  evening: { rest: "قهوة، بحر، طلعة عيال", summer: "قهوة، بحر عقب المغرب، طلعة عيال" },
  night: { rest: "عشا، قهوة، سهرة", summer: "عشا، قهوة، سهرة" },
};

export type FindMoment = { part: DayPart; summer: boolean; opener: string; examples: string };

export function findMoment(hour: number, month: number): FindMoment {
  const part = dayPart(hour);
  const summer = isSummerMonth(month);
  return { part, summer, opener: OPENER[part], examples: EXAMPLES[part][summer ? "summer" : "rest"] };
}

export function findMomentNow(now: Date = new Date()): FindMoment {
  return findMoment(kuwaitHour(now), kuwaitMonth(now));
}

/** «<opener> أنا <name>. قول لي وش تبي — <examples> — وأدلّك.» */
export function findGreeting(name: string, m: FindMoment): string {
  return `${m.opener} أنا ${name}. قول لي وش تبي — ${m.examples} — وأدلّك.`;
}

/**
 * What the static HTML says, at no hour: «هلا!» and the evening's examples —
 * word for word the greeting the call sheet uses (`WAIN_AI_COPY.greeting`),
 * which the find suite holds it to.
 */
export const FIND_DEFAULT: FindMoment = { part: "evening", summer: false, opener: "هلا!", examples: EXAMPLES.evening.rest };
