"use client";

import { IconSpeaker, IconSpeakerOff } from "@/components/icons";
import type { SpeechPart } from "@/lib/voice-lines";
import {
  PERSONAS,
  setEnabled,
  setPersona,
  speak,
  stop,
  useVoice,
  type PersonaId,
} from "@/lib/voice";

const PERSONA_ORDER: PersonaId[] = ["shouq", "salem"];

/**
 * The صوت وين switch: turn spoken suggestions on or off and pick who talks —
 * شوق or سالم. The preference sticks (locally, on this device only).
 */
export default function VoiceControls() {
  const { enabled, persona } = useVoice();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setEnabled(!enabled)}
        aria-pressed={enabled}
        className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition ${
          enabled
            ? "bg-coral-600 text-white shadow-sm hover:bg-coral-700"
            : "border border-sand-300 bg-white text-ink-600 hover:border-coral-300 hover:text-coral-700"
        }`}
      >
        {enabled ? <IconSpeaker className="size-4" /> : <IconSpeakerOff className="size-4" />}
        الاقتراح الصوتي
      </button>

      {enabled && (
        <div className="flex items-center gap-1 rounded-full border border-sand-200 bg-white p-1" role="group" aria-label="اختر الصوت">
          {PERSONA_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setPersona(id)}
              aria-pressed={persona === id}
              title={PERSONAS[id].descAr}
              className={`min-h-9 rounded-full px-4 text-sm font-semibold transition ${
                persona === id
                  ? "bg-ink-900 text-white"
                  : "text-ink-600 hover:text-coral-700"
              }`}
            >
              {PERSONAS[id].nameAr}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Explicit "say it" button — plays an utterance on click regardless of the
 * auto-suggest toggle, since the click itself is the request.
 */
export function SpeakButton({ parts, label }: { parts: SpeechPart[]; label: string }) {
  const { speaking, persona } = useVoice();

  return (
    <button
      type="button"
      onClick={() => (speaking ? stop() : speak(parts))}
      aria-pressed={speaking}
      className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
        speaking
          ? "bg-coral-600 text-white hover:bg-coral-700"
          : "bg-ink-900 text-white hover:bg-ink-800"
      }`}
    >
      {speaking ? <IconSpeakerOff className="size-4" /> : <IconSpeaker className="size-4" />}
      {speaking ? "وقّف الصوت" : `${label} بصوت ${PERSONAS[persona].nameAr}`}
    </button>
  );
}
