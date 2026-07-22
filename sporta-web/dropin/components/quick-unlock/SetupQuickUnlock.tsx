import { useState } from "react";
import { PasscodeKeypad } from "./PasscodeKeypad";
import { setDevicePasscode } from "@/lib/quickUnlock";
import { markEnrolled, isEnrolledLocally } from "@/lib/deviceId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  defaultLabel?: string;
  onEnrolled?: () => void;
};

// Enrollment card for the admin Settings page. Render it only for a
// logged-in admin. Prompts for a 6-digit code twice, then calls
// set_device_passcode with the device id + label.
export function SetupQuickUnlock({ defaultLabel = "", onEnrolled }: Props) {
  const [step, setStep] = useState<"idle" | "first" | "confirm" | "done">(
    isEnrolledLocally() ? "done" : "idle"
  );
  const [first, setFirst] = useState("");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState(defaultLabel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setFirst("");
    setCode("");
    setError("");
    setStep("idle");
  };

  async function finish(confirmCode: string) {
    setBusy(true);
    setError("");
    try {
      await setDevicePasscode(confirmCode, label || "This device");
      markEnrolled();
      onEnrolled?.();
      setStep("done");
    } catch (e) {
      setError((e as Error)?.message || "Could not save passcode.");
      setFirst("");
      setCode("");
      setStep("first");
    } finally {
      setBusy(false);
    }
  }

  const onComplete = (v: string) => {
    if (step === "first") {
      setFirst(v);
      setCode("");
      setStep("confirm");
    } else if (step === "confirm") {
      if (v !== first) {
        setError("Codes did not match. Try again.");
        setFirst("");
        setCode("");
        setStep("first");
        return;
      }
      void finish(v);
    }
  };

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Quick unlock</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Set a 6-digit passcode to unlock the admin on this device without typing your password each time.
        </p>

        {step === "done" && (
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
              ✓ Enabled on this device
            </span>
            <Button variant="link" className="h-auto p-0 text-indigo-600" onClick={reset}>
              Change code
            </Button>
          </div>
        )}

        {step === "idle" && (
          <div className="space-y-3">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Device label — e.g. Sara's iPhone"
            />
            <Button className="bg-indigo-600 hover:bg-indigo-700" onClick={() => setStep("first")}>
              Set up quick unlock
            </Button>
          </div>
        )}

        {(step === "first" || step === "confirm") && (
          <div className="flex flex-col items-center gap-6 pt-2">
            <p className="text-sm font-medium">
              {step === "first" ? "Enter a new 6-digit code" : "Re-enter to confirm"}
            </p>
            <PasscodeKeypad
              key={step}
              value={code}
              onChange={(v) => {
                setCode(v);
                if (v.length === 6) onComplete(v);
              }}
              disabled={busy}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button variant="ghost" size="sm" onClick={reset}>
              Cancel
            </Button>
          </div>
        )}

        {error && step === "idle" && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
