import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Delete } from "lucide-react";

type Props = {
  value: string;
  onChange: (next: string) => void;
  onSubmit?: () => void;
  length?: number;
  shake?: boolean;
  disabled?: boolean;
};

// Mobile-first numeric keypad for admin passcodes.
// Big tap targets, inputMode numeric, autofocus, auto-submit is handled by the
// parent when value reaches `length`. `shake` triggers error animation + haptic.
export function PasscodeKeypad({
  value,
  onChange,
  onSubmit,
  length = 6,
  shake = false,
  disabled = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (shake && "vibrate" in navigator) navigator.vibrate([40, 60, 40]);
  }, [shake]);

  const push = (d: string) => {
    if (disabled || value.length >= length) return;
    onChange((value + d).slice(0, length));
  };
  const backspace = () => onChange(value.slice(0, -1));

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className={cn("flex flex-col items-center gap-8", shake && "animate-[shake_0.4s_ease-in-out]")}>
      {/* Dots */}
      <div className="flex gap-3">
        {Array.from({ length }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-4 w-4 rounded-full border-2 transition-colors",
              i < value.length ? "border-indigo-600 bg-indigo-600" : "border-muted-foreground/30"
            )}
          />
        ))}
      </div>

      {/* Hidden real input for autofocus / OTP autofill */}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.length === length) onSubmit?.();
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={length}
        className="sr-only"
        aria-label="Passcode"
      />

      {/* On-screen keypad */}
      <div className="grid grid-cols-3 gap-4">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => push(k)}
            disabled={disabled}
            className="h-20 w-20 rounded-full bg-muted text-2xl font-semibold text-foreground transition active:scale-95 active:bg-indigo-100 disabled:opacity-50"
          >
            {k}
          </button>
        ))}
        <span />
        <button
          type="button"
          onClick={() => push("0")}
          disabled={disabled}
          className="h-20 w-20 rounded-full bg-muted text-2xl font-semibold text-foreground transition active:scale-95 active:bg-indigo-100 disabled:opacity-50"
        >
          0
        </button>
        <button
          type="button"
          onClick={backspace}
          disabled={disabled}
          aria-label="Delete"
          className="flex h-20 w-20 items-center justify-center rounded-full text-muted-foreground transition active:scale-95 disabled:opacity-50"
        >
          <Delete className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
