# Handoff

This was the onboarding note written when the project moved from Lovable into
this repo. Everything it asked for has been built, and the stack it described —
a hosted Postgres backend, an anon key in the browser, a device-passcode
quick-unlock — is no longer what the shop runs on. Rather than leave
instructions that would send someone the wrong way, here is where the current
answers live:

| To do this | Read |
|---|---|
| Understand the standing rules | `CLAUDE.md` (repo root) |
| Put the site live | `GO-LIVE.md` |
| Understand the backend | `NATIVE-BACKEND.md` |
| Fill in every secret the money path needs | `CHECKOUT-SECRETS.md` |
| Work on KNET | `KNET.md` |
| Know what lives where on the server | `SERVER-LAYOUT.md` |
| Understand the warehouse email | `FULFILMENT.md` |
| Check the security posture | `SECURITY.md` |

Short version of the current state: React + Vite front end, one backend (MySQL
+ PHP at `/api`) on the same Hostinger plan, two payment gateways from CBK
(`/knet` for debit cards, `/pay` for T-Pay), admin at `/backends`, published
over FTPS with `npm run publish`. SSH is off permanently — never propose it.
