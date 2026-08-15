# Sporta — website (React + Vite)

Editable **source** for the Sporta website (www.sporta.com.kw). Bilingual
Arabic/English with automatic RTL. This is the source you edit; you then
build it and upload the result to Hostinger.

## Develop locally

```bash
cd sporta-web
npm install
npm run dev        # open the printed http://localhost:5173
```

## Edit content

All text lives in **`src/i18n/translations.js`** (English + Arabic side by
side). Pages are in `src/pages/`, shared UI in `src/components/`. Brand
colors are in `tailwind.config.js` (`brand`).

## Deploy to Hostinger (FTP)

```bash
npm run build      # produces the dist/ folder
```

Then upload **the contents of `dist/`** (not the folder itself) into
`public_html` on Hostinger via FTP. The included `.htaccess` handles
client-side routing so page refreshes work.

## Structure

```
src/
├── main.jsx                 # app entry
├── App.jsx                  # routes
├── i18n/
│   ├── translations.js      # ← all AR/EN text
│   └── LanguageContext.jsx  # language + RTL switching
├── components/  Navbar, Footer
└── pages/       Home, About, Services, Contact
```
