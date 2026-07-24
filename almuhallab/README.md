# Almuhallab

Two pages, no build step:

- **`index.html`** — Almuhallab Code, the in-browser code editor (below)
- **`nokhatha.html`** — **النوخذة (Al-Nokhatha)**, the unified MCP system portal

## النوخذة — Al-Nokhatha (Unified MCP System)

Arabic-first (RTL) portal that presents all MCP integrations — GitHub, Figma,
n8n, Lovable, QuickBooks, plus the Almuhallab editor — as **one unit**, with:

- **Customer registration & login** (hash-routed pages)
- **Monthly subscription plans** in KWD — بحّار (Free) / قبطان (Pro, 9 د.ك) /
  نوخذة (Fleet, 19 د.ك) — each plan unlocks more MCP units
- A customer **dashboard** showing their plan, renewal date, and which MCP
  units are unlocked vs. locked

### ⚠️ Prototype status — what's real and what isn't

This is a fully working **front-end prototype**. Accounts, sessions, and
subscriptions are stored in the visitor's own browser (`localStorage`) so you
can demo the entire flow — but there is **no real payment and no shared user
database**. To take real customer subscriptions you need a backend:

1. **Payment gateway** (Kuwait-friendly): [MyFatoorah](https://myfatoorah.com),
   [Tap Payments](https://tap.company), or Stripe — use their *recurring/
   subscription* APIs and webhooks to activate/deactivate plans.
2. **Auth + database**: e.g. Supabase (email auth + Postgres) or Firebase.
   Replace the `localStorage` calls in `nokhatha.html` with API calls; passwords
   must be hashed server-side (bcrypt/argon2) — the demo's `obscure()` is not
   security.
3. **MCP gateway**: a small server that holds the real MCP server credentials
   and proxies tool calls, checking the customer's active plan before allowing
   access to each MCP unit.

The plan/unit gating logic (`MCPS`, `PLANS`, `minPlan`) in `nokhatha.html` is
the single source of truth to port to that backend.

## Almuhallab Code (the editor)

A fast, **offline, in-browser code editor** — write HTML, CSS, and JavaScript
and see a live preview instantly. Single self-contained file, no build step, no
dependencies.

## Run it

Just open `index.html` in any browser:

```bash
open almuhallab/index.html      # macOS
xdg-open almuhallab/index.html  # Linux
```

Or serve the folder:

```bash
npx serve almuhallab
```

## Features

- **Three editors** — `index.html`, `style.css`, `script.js` with line numbers
- **Live preview** — updates as you type (toggle **Auto-run**, or press **▶ Run** / **Ctrl/Cmd+S**)
- **Runs safely** in a sandboxed `<iframe>`; runtime errors are shown in the preview
- **Auto-saves** your code to the browser's local storage
- **Copy** the combined HTML or **Download** it as a standalone `.html` file
- **Tab** inserts two spaces; **Reset** restores the starter example
- Responsive — panes stack on narrow screens
