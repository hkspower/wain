// The live /about page (www.sporta.com.kw, dumped read-only 2026-11-03 with Playwright from the VPS): the exact
// markup of main > section.editorial-page in both languages, the two ld+json scripts of <head> (the static
// OnlineStore one from index.html and the FAQPage one the route writes), and the stylesheet rules that name those
// elements, copied from the live /assets/index-CdcKvZhs.css (rules in document order; the Tailwind variable block
// included, the colour-space @media blocks, admin and unrelated product rules left out) plus the live @font-face
// rules (fonts served from /fonts, which are public/fonts in this repo). Used by about-page-test.mjs.
// The cards' second paragraph and the FAQ answers are the live build's words, not the repo's About.jsx.
export const MARKUP = {
  ar: String.raw`<section class="editorial-page mx-auto px-4 py-16"><p class="page-eyebrow">SPORTA / شغفك بلا حدود</p><h1 class="page-heading mb-5 font-black">عن سبورتا — ملابس رياضية في الكويت</h1><p class="page-lead">موطن الرياضة الفاخرة في الكويت. معدات أداء من أبرز ماركات الرياضة عالميًا — ريو، فانكويش، ATE، جيمشارك، آي سبورت وعلامتنا الخاصة سبورتا.</p><h2 id="why" class="mb-6 mt-12 scroll-mt-28 text-2xl font-extrabold text-brand-dark">لماذا سبورتا؟</h2><div class="grid gap-4 sm:grid-cols-2"><div class="why-card rounded-2xl border border-slate-100 bg-white p-5"><span class="why-card-index" aria-hidden="true">01</span><h3 class="font-bold text-slate-900">التوصيل خلال ٢٤ ساعة · ١ د.ك</h3><p class="mt-1.5 text-sm leading-relaxed text-slate-600">تصلك تحديثات التوصيل على واتساب.</p></div><div class="why-card rounded-2xl border border-slate-100 bg-white p-5"><span class="why-card-index" aria-hidden="true">02</span><h3 class="font-bold text-slate-900">الإرجاع والاستبدال</h3><p class="mt-1.5 text-sm leading-relaxed text-slate-600">اطلب إرجاع أو استبدال المنتجات المستوفية للشروط خلال ١٤ يومًا. راجع سياسة الإرجاع للشروط والاستثناءات.</p></div><div class="why-card rounded-2xl border border-slate-100 bg-white p-5"><span class="why-card-index" aria-hidden="true">03</span><h3 class="font-bold text-slate-900">ادفع بالطريقة المعتادة في الكويت</h3><p class="mt-1.5 text-sm leading-relaxed text-slate-600">الأسعار بالدينار الكويتي. تظهر طرق الدفع المتاحة لطلبك في صفحة إتمام الشراء قبل تأكيده.</p></div><div class="why-card rounded-2xl border border-slate-100 bg-white p-5"><span class="why-card-index" aria-hidden="true">04</span><h3 class="font-bold text-slate-900">ماركات تستحق التمرين بها</h3><p class="mt-1.5 text-sm leading-relaxed text-slate-600">ريو وفانكويش وATE وجيمشارك وآي سبورت وماركتنا الخاصة سبورتا.</p></div></div><h2 class="mb-4 mt-12 text-2xl font-extrabold text-brand-dark">الأسئلة الشائعة</h2><div class="faq-list divide-y divide-slate-200"><details class="group py-4"><summary class="cursor-pointer list-none font-semibold text-slate-800 transition-colors group-open:text-brand">كم يستغرق التوصيل داخل الكويت؟</summary><p class="mt-2 leading-relaxed text-slate-600">الطلبات داخل الكويت تُوصَّل خلال ٢٤ ساعة من تأكيدها، وتصلك تحديثات التوصيل عبر واتساب.</p></details><details class="group py-4"><summary class="cursor-pointer list-none font-semibold text-slate-800 transition-colors group-open:text-brand">ما طرق الدفع المتوفرة؟</summary><p class="mt-2 leading-relaxed text-slate-600">تظهر طرق الدفع المتاحة لطلبك في صفحة إتمام الشراء قبل تأكيده. وجميع الأسعار بالدينار الكويتي.</p></details><details class="group py-4"><summary class="cursor-pointer list-none font-semibold text-slate-800 transition-colors group-open:text-brand">هل يمكن الاستبدال أو الإرجاع؟</summary><p class="mt-2 leading-relaxed text-slate-600">يمكنك طلب الإرجاع أو الاستبدال مجانًا خلال ١٤ يومًا من الاستلام. قد تحتاج بعض المنتجات إلى مراجعة فردية وفق سياسة الإرجاع وحقوق المستهلك المعمول بها. تواصل معنا عبر واتساب ‎+965 2209 1914 مع رقم طلبك.</p></details><details class="group py-4"><summary class="cursor-pointer list-none font-semibold text-slate-800 transition-colors group-open:text-brand">هل تشحنون خارج الكويت (الخليج / الشرق الأوسط)؟</summary><p class="mt-2 leading-relaxed text-slate-600">الدفع عبر الموقع متاح داخل الكويت. لطلبات دول الخليج والشرق الأوسط راسلنا على واتساب وسنرتب الشحن.</p></details><details class="group py-4"><summary class="cursor-pointer list-none font-semibold text-slate-800 transition-colors group-open:text-brand">ما الماركات المتوفرة لديكم؟</summary><p class="mt-2 leading-relaxed text-slate-600">ريو، فانكويش، ATE، جيمشارك، آي سبورت وماركتنا الخاصة سبورتا — ملابس رياضية وهوديز وإكسسوارات جيم.</p></details></div></section>`,
  en: String.raw`<section class="editorial-page mx-auto px-4 py-16"><p class="page-eyebrow">SPORTA / MADE FOR YOUR NEXT MOVE</p><h1 class="page-heading mb-5 font-black">About Sporta — sportswear in Kuwait</h1><p class="page-lead">The home of premium sport in Kuwait. Performance gear from the world’s leading sports brands — RHEO, Vanquish, ATE, Gymshark, Eyesportwear and our own SPORTA label.</p><h2 id="why" class="mb-6 mt-12 scroll-mt-28 text-2xl font-extrabold text-brand-dark">Why Sporta?</h2><div class="grid gap-4 sm:grid-cols-2"><div class="why-card rounded-2xl border border-slate-100 bg-white p-5"><span class="why-card-index" aria-hidden="true">01</span><h3 class="font-bold text-slate-900">Delivery within 24 hours · 1 KWD</h3><p class="mt-1.5 text-sm leading-relaxed text-slate-600">Delivery updates come to you on WhatsApp.</p></div><div class="why-card rounded-2xl border border-slate-100 bg-white p-5"><span class="why-card-index" aria-hidden="true">02</span><h3 class="font-bold text-slate-900">Returns and exchanges</h3><p class="mt-1.5 text-sm leading-relaxed text-slate-600">Request a return or exchange for eligible items within 14 days. See our Returns policy for conditions and exclusions.</p></div><div class="why-card rounded-2xl border border-slate-100 bg-white p-5"><span class="why-card-index" aria-hidden="true">03</span><h3 class="font-bold text-slate-900">Pay the way Kuwait pays</h3><p class="mt-1.5 text-sm leading-relaxed text-slate-600">Prices are in Kuwaiti Dinar. Checkout shows the payment methods available for your order before you confirm it.</p></div><div class="why-card rounded-2xl border border-slate-100 bg-white p-5"><span class="why-card-index" aria-hidden="true">04</span><h3 class="font-bold text-slate-900">Brands worth training in</h3><p class="mt-1.5 text-sm leading-relaxed text-slate-600">RHEO, Vanquish, ATE, Gymshark, Eyesportwear and our own SPORTA label.</p></div></div><h2 class="mb-4 mt-12 text-2xl font-extrabold text-brand-dark">Frequently asked questions</h2><div class="faq-list divide-y divide-slate-200"><details class="group py-4"><summary class="cursor-pointer list-none font-semibold text-slate-800 transition-colors group-open:text-brand">How fast do you deliver in Kuwait?</summary><p class="mt-2 leading-relaxed text-slate-600">Orders inside Kuwait are delivered within 24 hours of confirmation. Delivery updates are sent on WhatsApp.</p></details><details class="group py-4"><summary class="cursor-pointer list-none font-semibold text-slate-800 transition-colors group-open:text-brand">What payment methods do you accept?</summary><p class="mt-2 leading-relaxed text-slate-600">The payment methods currently available for your order are shown at checkout before you place it. All prices are in Kuwaiti Dinar (KWD).</p></details><details class="group py-4"><summary class="cursor-pointer list-none font-semibold text-slate-800 transition-colors group-open:text-brand">Can I exchange or return an item?</summary><p class="mt-2 leading-relaxed text-slate-600">You can request a free return or exchange within 14 days of delivery. Some items may need individual review under the Returns policy and applicable consumer rights. Contact us on WhatsApp +965 2209 1914 with your order number.</p></details><details class="group py-4"><summary class="cursor-pointer list-none font-semibold text-slate-800 transition-colors group-open:text-brand">Do you ship outside Kuwait (GCC / Middle East)?</summary><p class="mt-2 leading-relaxed text-slate-600">Online checkout covers Kuwait. For GCC and Middle East orders, message us on WhatsApp and we will arrange it.</p></details><details class="group py-4"><summary class="cursor-pointer list-none font-semibold text-slate-800 transition-colors group-open:text-brand">Which brands do you carry?</summary><p class="mt-2 leading-relaxed text-slate-600">RHEO, Vanquish, ATE, Gymshark, Eyesportwear and our own SPORTA label — activewear, hoodies and gym accessories.</p></details></div></section>`,
}
export const LD_STATIC = String.raw`
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "OnlineStore",
          "@id": "https://www.sporta.com.kw/#store",
          "name": "Sporta",
          "alternateName": "سبورتا",
          "url": "https://www.sporta.com.kw/",
          "logo": "https://www.sporta.com.kw/logo.png",
          "image": "https://www.sporta.com.kw/og-image.png",
          "email": "cs@sporta.com.kw",
          "telephone": "+965-22091914",
          "description": "Sporta is a Kuwait sportswear store offering activewear, gym clothing, hoodies, caps, and sports accessories. Delivery and returns follow the published terms. Available payment methods appear at checkout. The store supports Arabic and English.",
          "currenciesAccepted": "KWD",
          "priceRange": "KWD 3.500 - KWD 24.000",
          "areaServed": { "@type": "Country", "name": "Kuwait" },
          "address": { "@type": "PostalAddress", "addressCountry": "KW", "addressLocality": "Kuwait City" },
          "contactPoint": {
            "@type": "ContactPoint",
            "contactType": "customer service",
            "telephone": "+965-22091914",
            "email": "cs@sporta.com.kw",
            "availableLanguage": ["Arabic", "English"],
            "areaServed": "KW"
          },
          "brand": [
            { "@type": "Brand", "name": "SPORTA" },
            { "@type": "Brand", "name": "AHED" },
            { "@type": "Brand", "name": "RHEO" },
            { "@type": "Brand", "name": "Vanquish" },
            { "@type": "Brand", "name": "Gymshark" },
       { "@type": "Brand", "name": "Eyesportwear" },
            { "@type": "Brand", "name": "NBA" }
          ],
          "knowsLanguage": ["ar", "en"],
          "sameAs": [
            "https://www.instagram.com/sporta.kw",
            "https://www.tiktok.com/@sporta.kw"
          ]
        },
        {
          "@type": "WebSite",
          "@id": "https://www.sporta.com.kw/#website",
          "url": "https://www.sporta.com.kw/",
          "name": "Sporta",
          "inLanguage": ["en", "ar"],
          "publisher": { "@id": "https://www.sporta.com.kw/#store" },
          "potentialAction": {
            "@type": "SearchAction",
            "target": "https://www.sporta.com.kw/shop?q={search_term_string}",
            "query-input": "required name=search_term_string"
          }
        }
      ]
    }
    `
export const LD_ROUTE = {
  ar: String.raw`{"@context":"https://schema.org","@graph":[{"@type":"AboutPage","name":"من نحن — سبورتا","url":"https://www.sporta.com.kw/about","about":{"@id":"https://www.sporta.com.kw/#store"},"inLanguage":"ar"},{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"كم يستغرق التوصيل داخل الكويت؟","acceptedAnswer":{"@type":"Answer","text":"الطلبات داخل الكويت تُوصَّل خلال ٢٤ ساعة من تأكيدها، وتصلك تحديثات التوصيل عبر واتساب."}},{"@type":"Question","name":"ما طرق الدفع المتوفرة؟","acceptedAnswer":{"@type":"Answer","text":"تظهر طرق الدفع المتاحة لطلبك في صفحة إتمام الشراء قبل تأكيده. وجميع الأسعار بالدينار الكويتي."}},{"@type":"Question","name":"هل يمكن الاستبدال أو الإرجاع؟","acceptedAnswer":{"@type":"Answer","text":"يمكنك طلب الإرجاع أو الاستبدال مجانًا خلال ١٤ يومًا من الاستلام. قد تحتاج بعض المنتجات إلى مراجعة فردية وفق سياسة الإرجاع وحقوق المستهلك المعمول بها. تواصل معنا عبر واتساب ‎+965 2209 1914 مع رقم طلبك."}},{"@type":"Question","name":"هل تشحنون خارج الكويت (الخليج / الشرق الأوسط)؟","acceptedAnswer":{"@type":"Answer","text":"الدفع عبر الموقع متاح داخل الكويت. لطلبات دول الخليج والشرق الأوسط راسلنا على واتساب وسنرتب الشحن."}},{"@type":"Question","name":"ما الماركات المتوفرة لديكم؟","acceptedAnswer":{"@type":"Answer","text":"ريو، فانكويش، ATE، جيمشارك، آي سبورت وماركتنا الخاصة سبورتا — ملابس رياضية وهوديز وإكسسوارات جيم."}}]},{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"الرئيسية","item":"https://www.sporta.com.kw/"},{"@type":"ListItem","position":2,"name":"من نحن","item":"https://www.sporta.com.kw/about"}]}]}`,
  en: String.raw`{"@context":"https://schema.org","@graph":[{"@type":"AboutPage","name":"About Sporta","url":"https://www.sporta.com.kw/about","about":{"@id":"https://www.sporta.com.kw/#store"},"inLanguage":"en"},{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How fast do you deliver in Kuwait?","acceptedAnswer":{"@type":"Answer","text":"Orders inside Kuwait are delivered within 24 hours of confirmation. Delivery updates are sent on WhatsApp."}},{"@type":"Question","name":"What payment methods do you accept?","acceptedAnswer":{"@type":"Answer","text":"The payment methods currently available for your order are shown at checkout before you place it. All prices are in Kuwaiti Dinar (KWD)."}},{"@type":"Question","name":"Can I exchange or return an item?","acceptedAnswer":{"@type":"Answer","text":"You can request a free return or exchange within 14 days of delivery. Some items may need individual review under the Returns policy and applicable consumer rights. Contact us on WhatsApp +965 2209 1914 with your order number."}},{"@type":"Question","name":"Do you ship outside Kuwait (GCC / Middle East)?","acceptedAnswer":{"@type":"Answer","text":"Online checkout covers Kuwait. For GCC and Middle East orders, message us on WhatsApp and we will arrange it."}},{"@type":"Question","name":"Which brands do you carry?","acceptedAnswer":{"@type":"Answer","text":"RHEO, Vanquish, ATE, Gymshark, Eyesportwear and our own SPORTA label — activewear, hoodies and gym accessories."}}]},{"@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.sporta.com.kw/"},{"@type":"ListItem","position":2,"name":"About","item":"https://www.sporta.com.kw/about"}]}]}`,
}
export const FONT_FACES = String.raw`@font-face{font-family:"Sporta Alexandria Local";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/alexandria-var-latin.woff2") format("woff2-variations");unicode-range:U+0-FF, U+131, U+152-153, U+2BB-2BC, U+2C6, U+2DA, U+2DC, U+300-301, U+303-304, U+308, U+309, U+323, U+329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF}
@font-face{font-family:"Sporta Alexandria Local";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/alexandria-var-arabic.woff2") format("woff2-variations");unicode-range:U+600-6FF, U+750-77F, U+870-88E, U+890-891, U+897-8E1, U+8E3-8FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC}
@font-face{font-family:"Sporta Plex Arabic Local";font-style:normal;font-weight:400;font-display:swap;src:url("/fonts/plex-400-arabic.woff2") format("woff2");unicode-range:U+600-6FF, U+750-77F, U+870-88E, U+890-891, U+897-8E1, U+8E3-8FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC}
@font-face{font-family:"Sporta Plex Arabic Local";font-style:normal;font-weight:400;font-display:swap;src:url("/fonts/plex-400-latin.woff2") format("woff2");unicode-range:U+0-FF, U+131, U+152-153, U+2BB-2BC, U+2C6, U+2DA, U+2DC, U+300-301, U+303-304, U+308, U+329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF}
@font-face{font-family:"Sporta Plex Arabic Local";font-style:normal;font-weight:600;font-display:swap;src:url("/fonts/plex-600-arabic.woff2") format("woff2");unicode-range:U+600-6FF, U+750-77F, U+870-88E, U+890-891, U+897-8E1, U+8E3-8FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC}
@font-face{font-family:"Sporta Plex Arabic Local";font-style:normal;font-weight:600;font-display:swap;src:url("/fonts/plex-600-latin.woff2") format("woff2");unicode-range:U+0-FF, U+131, U+152-153, U+2BB-2BC, U+2C6, U+2DA, U+2DC, U+300-301, U+303-304, U+308, U+329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF}
@font-face{font-family:"Sporta Plex Arabic Local";font-style:normal;font-weight:700;font-display:swap;src:url("/fonts/plex-700-arabic.woff2") format("woff2");unicode-range:U+600-6FF, U+750-77F, U+870-88E, U+890-891, U+897-8E1, U+8E3-8FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC}
@font-face{font-family:"Sporta Plex Arabic Local";font-style:normal;font-weight:700;font-display:swap;src:url("/fonts/plex-700-latin.woff2") format("woff2");unicode-range:U+0-FF, U+131, U+152-153, U+2BB-2BC, U+2C6, U+2DA, U+2DC, U+300-301, U+303-304, U+308, U+329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF}
@font-face{font-family:"Alexandria Fallback";src:local("Arial"),local("Helvetica"),local("Roboto"),local("Liberation Sans"),local("DejaVu Sans");ascent-override:96.8%;descent-override:25.1%;line-gap-override:0%}
@font-face{font-family:"Plex Arabic Fallback";src:local("Arial"),local("Helvetica"),local("Roboto"),local("Liberation Sans"),local("DejaVu Sans");ascent-override:108.5%;descent-override:41.5%;line-gap-override:0%}`
export const LIVE = String.raw`html { font-size: clamp(16px, 15.5px + 0.104vw, 17px); }
body { margin: 0px; }
:root, :host { --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; --color-red-600: #e40014; --color-orange-50: #fff7ed; --color-orange-100: #ffedd5; --color-orange-200: #ffd7a8; --color-orange-300: #ffb96d; --color-orange-400: #ff8b1a; --color-orange-500: #fe6e00; --color-orange-600: #f05100; --color-orange-700: #c53c00; --color-orange-800: #9f2d00; --color-orange-900: #7e2a0c; --color-orange-950: #441306; --color-amber-50: #fffbeb; --color-amber-100: #fef3c6; --color-amber-200: #fee685; --color-amber-300: #ffd236; --color-amber-500: #f99c00; --color-amber-600: #dd7400; --color-amber-700: #b75000; --color-amber-800: #953d00; --color-amber-900: #7b3306; --color-amber-950: #461901; --color-emerald-50: #ecfdf5; --color-emerald-100: #d0fae5; --color-emerald-200: #a4f4cf; --color-emerald-300: #5ee9b5; --color-emerald-400: #00d294; --color-emerald-500: #00bb7f; --color-emerald-600: #009767; --color-emerald-700: #007956; --color-emerald-800: #005f46;--color-emerald-900: #004e3b; --color-emerald-950: #002c22; --color-sky-50: #f0f9ff; --color-sky-100: #dff2fe; --color-sky-700: #0069a4; --color-sky-800: #005986; --color-blue-100: #dbeafe; --color-blue-700: #1447e6; --color-indigo-50: #eef2ff; --color-indigo-100: #e0e7ff; --color-indigo-200: #c7d2ff; --color-indigo-300: #a4b3ff; --color-indigo-400: #7d87ff; --color-indigo-500: #625fff; --color-indigo-600: #4f39f6; --color-indigo-700: #432dd7; --color-indigo-800: #372aac; --color-indigo-900: #312c85; --color-violet-100: #ede9fe; --color-violet-700: #7008e7; --color-rose-50: #fff1f2; --color-rose-100: #ffe4e6; --color-rose-200: #ffccd3; --color-rose-300: #ffa2ae; --color-rose-400: #ff667f; --color-rose-500: #ff2357; --color-rose-600: #e70044; --color-rose-700: #c20039; --color-rose-800: #a30037; --color-rose-900: #8b0836; --color-rose-950: #4d0218; --color-slate-50: #f8fafc; --color-slate-100: #f1f5f9; --color-slate-200: #e2e8f0; --color-slate-300: #cad5e2; --color-slate-400: #90a1b9; --color-slate-500: #62748e; --color-slate-600: #45556c; --color-slate-700: #314158; --color-slate-800: #1d293d; --color-slate-900: #0f172b; --color-slate-950: #020618; --color-black: #000; --color-white: #fff; --spacing: .25rem; --container-xs: 20rem; --container-sm: 24rem; --container-md: 28rem; --container-lg: 32rem; --container-xl: 36rem; --container-2xl: 42rem; --container-3xl: 48rem; --container-4xl: 56rem; --container-5xl: 64rem; --container-6xl: 72rem; --container-7xl: 80rem; --text-xs: .75rem; --text-xs--line-height: calc(1 / .75); --text-sm: .875rem; --text-sm--line-height: calc(1.25 / .875); --text-base: 1rem; --text-base--line-height: calc(1.5 / 1); --text-lg: 1.125rem; --text-lg--line-height: calc(1.75 / 1.125); --text-xl: 1.25rem; --text-xl--line-height: calc(1.75 / 1.25); --text-2xl: 1.5rem; --text-2xl--line-height: calc(2 / 1.5); --text-3xl: 1.875rem; --text-3xl--line-height: calc(2.25 / 1.875); --text-4xl: 2.25rem; --text-4xl--line-height: calc(2.5 / 2.25); --text-5xl: 3rem; --text-5xl--line-height: 1; --text-7xl: 4.5rem; --text-7xl--line-height: 1; --font-weight-normal: 400; --font-weight-medium: 500; --font-weight-semibold: 600; --font-weight-bold: 700; --font-weight-extrabold: 800; --font-weight-black: 900; --tracking-tight: -.025em; --tracking-wide: .025em; --tracking-wider: .05em; --tracking-widest: .1em; --leading-tight: 1.25; --leading-snug: 1.375; --leading-relaxed: 1.625; --radius-md: .375rem; --radius-lg: .5rem; --radius-xl: .75rem; --radius-2xl: 1rem; --radius-3xl: 1.5rem; --ease-in: cubic-bezier(.4, 0, 1, 1); --ease-out: cubic-bezier(0, 0, .2, 1); --ease-in-out: cubic-bezier(.4, 0, .2, 1); --animate-spin: spin 1s linear infinite; --animate-pulse: pulse 2s cubic-bezier(.4, 0, .6, 1) infinite; --blur-sm: 8px; --default-transition-duration: .15s; --default-transition-timing-function: cubic-bezier(.4, 0, .2, 1); --default-mono-font-family: var(--font-mono); }
*, ::after, ::before { box-sizing: border-box; border: 0px solid; margin: 0px; padding: 0px; }
html, :host { text-size-adjust: 100%; tab-size: 4; font-feature-settings: normal; font-variation-settings: normal; -webkit-tap-highlight-color: transparent; font-family: "Sporta Plex Arabic Local", "Plex Arabic Fallback", ibm-plex-arabic, system-ui, sans-serif; line-height: 1.5; }
h1, h2, h3, h4, h5, h6 { font-size: inherit; font-weight: inherit; }
summary { display: list-item; }
.mx-auto { margin-inline: auto; }
.mt-1\.5 { margin-top: calc(var(--spacing) * 1.5); }
.mt-2 { margin-top: calc(var(--spacing) * 2); }
.mt-12 { margin-top: calc(var(--spacing) * 12); }
.mb-4 { margin-bottom: calc(var(--spacing) * 4); }
.mb-5 { margin-bottom: calc(var(--spacing) * 5); }
.mb-6 { margin-bottom: calc(var(--spacing) * 6); }
.grid { display: grid; }
.cursor-pointer { cursor: pointer; }
.scroll-mt-28 { scroll-margin-top: calc(var(--spacing) * 28); }
.list-none { list-style-type: none; }
.gap-4 { gap: calc(var(--spacing) * 4); }
:where(.divide-y > :not(:last-child)) { --tw-divide-y-reverse: 0; border-bottom-style: var(--tw-border-style); border-top-style: var(--tw-border-style); border-top-width: calc(1px * var(--tw-divide-y-reverse)); border-bottom-width: calc(1px * calc(1 - var(--tw-divide-y-reverse))); }
:where(.divide-slate-200 > :not(:last-child)) { border-color: var(--color-slate-200); }
.rounded-2xl { border-radius: var(--radius-2xl); }
.border { border-style: var(--tw-border-style); border-width: 1px; }
.border-slate-100 { border-color: var(--color-slate-100); }
.bg-white { background-color: var(--color-white); }
.p-5 { padding: calc(var(--spacing) * 5); }
.px-4 { padding-inline: calc(var(--spacing) * 4); }
.py-4 { padding-block: calc(var(--spacing) * 4); }
.py-16 { padding-block: calc(var(--spacing) * 16); }
.text-2xl { font-size: var(--text-2xl); line-height: var(--tw-leading,var(--text-2xl--line-height)); }
.text-sm { font-size: var(--text-sm); line-height: var(--tw-leading,var(--text-sm--line-height)); }
.leading-relaxed { --tw-leading: var(--leading-relaxed); line-height: var(--leading-relaxed); }
.font-black { --tw-font-weight: var(--font-weight-black); font-weight: var(--font-weight-black); }
.font-bold { --tw-font-weight: var(--font-weight-bold); font-weight: var(--font-weight-bold); }
.font-extrabold { --tw-font-weight: var(--font-weight-extrabold); font-weight: var(--font-weight-extrabold); }
.font-semibold { --tw-font-weight: var(--font-weight-semibold); font-weight: var(--font-weight-semibold); }
.text-brand-dark { color: var(--brand-deep); }
.text-slate-600 { color: var(--color-slate-600); }
.text-slate-800 { color: var(--color-slate-800); }
.text-slate-900 { color: var(--color-slate-900); }
.transition-colors { transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-from, --tw-gradient-via, --tw-gradient-to; transition-timing-function: var(--tw-ease,var(--default-transition-timing-function)); transition-duration: var(--tw-duration,var(--default-transition-duration)); }
@media (min-width: 40rem) .sm\:grid-cols-2 { grid-template-columns: repeat(2, minmax(0px, 1fr)); }
:root { --brand: #c76a42; --brand-bright: #d28a69; --brand-deep: #99452b; --ink: #171a1e; --text-primary: #171a1e; --canvas: #fff; --canvas-muted: #f6f7f8; --surface: #fff; --surface-raised: #fff; --line-soft: #171a1e13; --line: #171a1e21; --line-strong: #7b8793; --text-muted: #596571; --primary: 18.9 53.8% 61.8%; --primary-foreground: 210 13% 10%; --accent: 14.2 56.1% 38.4%; --accent-foreground: 0 0% 100%; --accent-text-light: 14.2 56.1% 38.4%; --accent-text-dark: 18.9 53.8% 61.8%; --accent-text: var(--accent-text-light); --on-brand: 210 13% 10%; --type-micro: .6875rem; --type-caption: .75rem; --type-body: .9375rem; --type-lead: 1rem; }
[dir="rtl"] { --type-micro: .75rem; }
.storefront-root main#main > section.mx-auto:not(.invoice) { box-sizing: border-box; padding-inline-start: var(--shop-gutter-start,max(clamp(1rem, 3vw, 2.5rem), var(--sa-left,0px))); padding-inline-end: var(--shop-gutter-end,max(clamp(1rem, 3vw, 2.5rem), var(--sa-right,0px))); }
.storefront-root :where(.page-heading, .catalog-heading h1, .catalog-product-summary, .editorial-page, .legal-page, .tracking-panel) { text-align: start; }
.storefront-root .editorial-page { width: 100%; max-width: 68rem; }
.storefront-root .page-eyebrow { color: var(--brand-deep); margin-block-end: 0.75rem; font-size: 0.75rem; font-weight: 700; }
.storefront-root .page-heading { color: inherit; font-size: clamp(1.875rem, 4.5vw, 3.5rem); line-height: 1.25; }
.storefront-root .page-lead { max-width: 48rem; font-size: var(--type-lead); color: var(--text-muted); line-height: 1.9; }
.storefront-root .why-card { border-color: var(--line); border-radius: var(--shop-radius); padding: 1.5rem; }
.storefront-root .why-card-index { color: var(--brand-deep); margin-block-end: 1rem; font-size: 0.75rem; font-weight: 800; display: inline-block; }
.storefront-root .faq-list { border-top: 1px solid var(--line); }
.storefront-root .faq-list summary { justify-content: space-between; align-items: center; gap: 1rem; padding-block: 0.5rem; display: flex; }
.storefront-root .faq-list summary::after { content: "+"; color: var(--brand); font-size: 1.5rem; }
html { scroll-behavior: smooth; text-size-adjust: 100%; font-size: clamp(16px, 15.5px + 0.104vw, 17px); }
body { color: var(--ink); background-color: var(--canvas); -webkit-font-smoothing: antialiased; text-rendering: optimizelegibility; font-family: var(--sporta-font-body-en,"Sporta Plex Arabic Local"), "Plex Arabic Fallback", "ibm-plex-arabic", system-ui, sans-serif; font-optical-sizing: auto; line-height: 1.6; }
[dir="rtl"] body { font-family: var(--sporta-font-body-ar,"Sporta Plex Arabic Local"), "Plex Arabic Fallback", "ibm-plex-arabic", system-ui, sans-serif; }
:root:not([data-theme="dark"]) body { background-color: var(--canvas); }
h1, h2, h3, .font-display { font-family: var(--sporta-font-display-en,"Sporta Alexandria Local"), "Alexandria Fallback", "alexandria", "Sporta Plex Arabic Local", "Plex Arabic Fallback", "ibm-plex-arabic", system-ui, sans-serif; letter-spacing: -0.018em; font-feature-settings: "kern", "liga"; text-wrap: balance; line-height: 1.14; }
p, li, dd, figcaption { text-wrap: pretty; }
[dir="rtl"] h1, [dir="rtl"] h2, [dir="rtl"] h3, [dir="rtl"] .font-display { font-family: var(--sporta-font-display-ar,"Sporta Alexandria Local"), "Alexandria Fallback", "Sporta Plex Arabic Local", "Plex Arabic Fallback", "alexandria", "ibm-plex-arabic", system-ui, sans-serif; letter-spacing: 0px; line-height: 1.3; }
[dir="rtl"] body { line-height: 1.75; }
:root { --sporta-accent-soft: #fff6f0; --sporta-accent-soft-strong: #f9e8de; --sporta-accent-border: #bd7c5b; --sporta-accent: var(--brand,#c76a42); --sporta-accent-deep: var(--brand-deep,#99452b); --sporta-accent-hover: #8f391b; }
html:root:root { --brand: #e0561c !important; --brand-bright: #ff7b17 !important; --brand-deep: #b8430f !important; --primary: 17.8 77.8% 49.4% !important; --accent: 18.5 84.9% 39% !important; --accent-text-light: 18.5 84.9% 39% !important; --accent-text-dark: 25.9 100% 54.5% !important; }
.flex{display:flex}.flex-col{flex-direction:column}.flex-1{flex:1}.min-h-screen{min-height:100vh}`
export const page = (lang, extraHead = '') => `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>About</title><script type="application/ld+json">${LD_STATIC}</script><script type="application/ld+json" data-route="true">${LD_ROUTE[lang]}</script><style>${FONT_FACES}</style><style>${LIVE}</style>${extraHead}</head><body><div id="root"><div class="storefront-root flex min-h-screen flex-col"><main id="main" class="flex-1" tabindex="-1">${MARKUP[lang]}</main></div></div></body></html>`
