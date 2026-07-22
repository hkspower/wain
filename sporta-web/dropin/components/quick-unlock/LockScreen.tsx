import { useEffect, useState } from "react";
import { PasscodeKeypad } from "./PasscodeKeypad";
import { verifyDevicePasscode } from "@/lib/quickUnlock";
import { Lock } from "lucide-react";

type Props = {
  onUnlock: () => void;
  onUsePassword: () => void;
};

// Full-screen numeric lock, shown when a Supabase session exists and a
// passcode is enrolled on this device. Calls verify_device_passcode.
export function LockScreen({ onUnlock, onUsePassword }: Props) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [msg, setMsg] = useState("");
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);

  // Lockout countdown
  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const secs = Math.max(0, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 1000));
      setRemaining(secs);
      if (secs === 0) {
        setLockedUntil(null);
        setMsg("");
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  // Auto-submit on the last digit
  useEffect(() => {
    if (code.length === 6 && !busy && !lockedUntil) void submit(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function submit(passcode: string) {
    setBusy(true);
    setMsg("");
    try {
      const res = await verifyDevicePasscode(passcode);
      if (res?.ok) {
        onUnlock();
        return;
      }
      triggerShake();
      setCode("");
      if (res?.reason === "locked") {
        setLockedUntil(res.locked_until ?? null);
        setMsg("Too many attempts. Locked temporarily.");
      } else if (typeof res?.attempts_left === "number") {
        setMsg(`Incorrect passcode — ${res.attempts_left} attempt${res.attempts_left === 1 ? "" : "s"} left.`);
      } else {
        setMsg("Incorrect passcode.");
      }
    } catch {
      triggerShake();
      setCode("");
      setMsg("Could not verify. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  function triggerShake() {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  }

  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 bg-background px-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-white">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold text-foreground">Enter passcode</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sporta Admin</p>
      </div>

      <PasscodeKeypad
        value={code}
        onChange={setCode}
        onSubmit={() => code.length === 6 && submit(code)}
        shake={shake}
        disabled={busy || !!lockedUntil}
      />

      <div className="h-6 text-center text-sm">
        {lockedUntil ? (
          <span className="font-semibold text-destructive">
            Try again in {mm}:{ss}
          </span>
        ) : (
          <span className="text-destructive">{msg}</span>
        )}
      </div>

      <button
        onClick={onUsePassword}
        className="text-sm font-semibold text-indigo-600 underline underline-offset-4"
      >
        Use password instead
      </button>
    </div>
  );
}
