# Admin passcode quick-unlock — drop-in for the Sporta Admin (Vite + React + TS + shadcn)

These files are written to match your real stack (TypeScript, shadcn/ui,
react-router v7, `@supabase/supabase-js`). Copy them into your project's
`src/` and wire in the three integration points below.

## 1. Copy files into your project

| From `dropin/` | To (in your `src/`) |
|---|---|
| `lib/deviceId.ts` | `src/lib/deviceId.ts` |
| `lib/quickUnlock.ts` | `src/lib/quickUnlock.ts` |
| `hooks/useIdleLock.ts` | `src/hooks/useIdleLock.ts` |
| `components/quick-unlock/*` | `src/components/quick-unlock/` |

**Check the Supabase import path.** These files import
`@/integrations/supabase/client` (the Lovable default). If your client lives
elsewhere, update the import in `lib/quickUnlock.ts` and
`components/quick-unlock/QuickUnlockGate.tsx`.

## 2. Run the SQL migration (server-authoritative enrollment)

Run `supabase/has_device_passcode.sql` (in this repo, one level up) in the
Supabase SQL editor. Verify the device-id column name (`device_id`) and the
`grant ... to authenticated` role match your schema.

## 3. Wire the three integration points

**a) Gate your authenticated admin area** — wrap wherever you render admin
routes once logged in:

```tsx
import { QuickUnlockGate } from "@/components/quick-unlock/QuickUnlockGate";

<QuickUnlockGate>
  <AdminRoutes />   {/* your existing authed admin */}
</QuickUnlockGate>
```

**b) Add the enrollment card to admin Settings:**

```tsx
import { SetupQuickUnlock } from "@/components/quick-unlock/SetupQuickUnlock";

// inside your Settings page, only rendered for a logged-in admin:
<SetupQuickUnlock defaultLabel="This device" />
```

**c) Add the shake keyframe** (used for wrong-passcode feedback). Add to your
global CSS (e.g. `src/index.css`):

```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-8px); }
  40%, 80% { transform: translateX(8px); }
}
```

## Behaviour

- **Device ID**: 256-bit token in `localStorage.sporta_device_id`, reused.
- **Lock**: shows on app open and after 15 min idle when a session exists and
  a passcode is enrolled. `verify_device_passcode` → unlock / attempts-left /
  lockout countdown. "Use password instead" signs out.
- **Mobile UX**: big tap targets, numeric input mode, autofocus, auto-submit
  on the 6th digit, shake + haptic on error, indigo accent.

## Notes for your native wrappers

Works as-is in Capacitor/Electron (it's plain web + localStorage). For extra
security you could later swap the local device token for
`@capacitor/preferences` or Keychain, but it isn't required for this feature.
