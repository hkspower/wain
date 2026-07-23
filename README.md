# Sporta

Source for **www.sporta.com.kw** — a bilingual (Arabic/English) sports
e-commerce site with CBK Hosted KNET & T-Pay payments and a passcode-protected
admin.

The app lives in **[`sporta-web/`](./sporta-web/)**.

```bash
cd sporta-web
npm install
npm run dev      # local preview
npm run build    # production build -> dist/
```

- **Deploy & handoff:** see `sporta-web/HANDOFF.md`
- **Payments (CBK T-Pay, PHP):** `sporta-web/dropin/php-cbk/`
- **Database schema (server-side pricing + RLS):** `sporta-web/supabase/schema.sql`
- **Security notes:** `sporta-web/SECURITY.md`
- **Performance notes:** `sporta-web/PERFORMANCE.md`
- **Project rules for Claude:** `CLAUDE.md`
