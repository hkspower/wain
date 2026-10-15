/**
 * The job (lib/agent-job.ts) as the sentence an agent session is told when it
 * picks it up. Its own module, not a part of agent-job.ts, because only the two
 * agents' own pages — the call and سالم's chat — ever say it, and /search,
 * which only writes the job when «كمّل مع سالم» is pressed, was carrying this
 * text for nothing: webpack keeps every export a module has anywhere in the
 * app, in every chunk the module lands in, so the sentence table rode in
 * /search's page chunk and put it over its 176K budget (15 October, 0.1K).
 */
import type { AgentJob, JobAgent } from "./agent-job";

/** Where the job was, as the next agent hears it. */
const WHERE: Record<JobAgent, string> = {
  "shouq-call": "مكالمته مع شوق",
  "shouq-answer": "جواب شوق المكتوب في صفحة البحث",
  "salem-chat": "محادثته المكتوبة مع سالم",
  "salem-call": "مكالمته مع سالم",
  "call-center": "مركز الاتصال",
};

/**
 * The job as one contextual update for the agent picking it up: background it
 * reads, not a message it answers. Arabic, because the agent's prompt is, and
 * short, because it rides in every turn after it. `nameOf` turns a slug into
 * the place's name; a slug it does not know is left out rather than read out.
 */
export function jobContext(job: AgentJob, nameOf: (slug: string) => string | undefined): string {
  const names = job.shown.map(nameOf).filter((n): n is string => !!n).slice(0, 3);
  const picked = job.picked ? nameOf(job.picked) : undefined;
  return [
    `سياق للتسليم: الزائر جاي من ${WHERE[job.by]}.`,
    job.asked ? `طلبه: «${job.asked}».` : "",
    names.length ? `الأماكن اللي طلعت له: ${names.join("، ")}.` : "",
    picked ? `واختار منها: ${picked}.` : "",
    "كمّل معه من هني، ولا تعيد عليه سؤال جاوبه.",
  ]
    .filter(Boolean)
    .join(" ");
}
