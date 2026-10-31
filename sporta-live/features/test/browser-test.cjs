const { chromium } = require('playwright');
const path = require('path');
const http = require('http'); const fs = require('fs');
const srv = http.createServer((q, r) => { const f = q.url.startsWith('/sporta-features.js') ? path.join(__dirname, '..', 'sporta-features.js') : path.join(__dirname, 'mock-home.html'); r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); r.end(fs.readFileSync(f)); });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m); } else { fail++; console.log('FAIL', m); } };
const lum = (rgb) => { const a = rgb.match(/\d+/g).slice(0, 3).map(Number).map(v => v / 255).map(x => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; };
const cr = (f, b) => { const [x, y] = [lum(f), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = await chromium.launch();
  const url = 'http://127.0.0.1:' + srv.address().port + '/';
  for (const w of [1280, 390]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    await p.goto(url); await p.waitForTimeout(150);
    const r = await p.evaluate(() => {
      const s = document.getElementById('sporta-features'); const hero = document.querySelector('.campaign-photo-hero').closest('section');
      const btn = s && s.querySelector('.sf__btn--shop'); const bs = btn && getComputedStyle(btn);
      const card = s && s.querySelector('.sf__card'); const h3 = card && card.querySelector('h3'); const pp = card && card.querySelector('p');
      return { exists: !!s, count: document.querySelectorAll('#sporta-features').length, afterHero: s && s.previousElementSibling === hero, beforeNext: s && s.nextElementSibling && s.nextElementSibling.id === 'next',
        dir: s && s.getAttribute('dir'), title: s && s.querySelector('h2').textContent, cards: s ? s.querySelectorAll('.sf__card').length : 0,
        cols: s && getComputedStyle(s.querySelector('.sf__grid')).gridTemplateColumns.split(' ').length,
        btnBg: bs && bs.backgroundColor, btnFg: bs && bs.color, btnH: btn && btn.getBoundingClientRect().height,
        cardBg: card && getComputedStyle(card).backgroundColor, h3c: h3 && getComputedStyle(h3).color, pc: pp && getComputedStyle(pp).color,
        overflow: document.documentElement.scrollWidth > window.innerWidth, labelled: s && s.getAttribute('aria-labelledby') === 'sporta-features-title' };
    });
    ok(r.exists && r.count === 1, `@${w} one features section mounted`);
    ok(r.afterHero && r.beforeNext, `@${w} sits directly after the hero slider`);
    ok(r.dir === 'rtl' && r.title === 'مميزات سبورتا', `@${w} Arabic, RTL by default`);
    ok(r.cards === 4, `@${w} four feature cards`);
    ok(r.cols === (w >= 1024 ? 4 : 2), `@${w} grid columns = ${r.cols}`);
    ok(cr(r.btnFg, r.btnBg) >= 4.5, `@${w} shop button contrast ${cr(r.btnFg, r.btnBg).toFixed(2)} (black on orange)`);
    ok(r.btnH >= 44, `@${w} tap target ${r.btnH}px`);
    ok(cr(r.h3c, r.cardBg) >= 4.5 && cr(r.pc, r.cardBg) >= 4.5, `@${w} card text contrast ${cr(r.h3c, r.cardBg).toFixed(1)} / ${cr(r.pc, r.cardBg).toFixed(1)}`);
    ok(!r.overflow, `@${w} no horizontal scroll`);
    ok(r.labelled, `@${w} section labelled by its heading`);
    if (w === 1280) {
      await p.evaluate(() => renderHome()); await p.waitForTimeout(150);
      ok(await p.evaluate(() => document.querySelectorAll('#sporta-features').length === 1 && document.getElementById('sporta-features').previousElementSibling.querySelector('.campaign-photo-hero') !== null), 're-mounted once after React re-render');
      await p.evaluate(() => { document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr'; }); await p.waitForTimeout(150);
      const en = await p.evaluate(() => { const s = document.getElementById('sporta-features'); return { t: s.querySelector('h2').textContent, d: s.getAttribute('dir'), href: s.querySelector('.sf__btn--shop').getAttribute('href'), n: document.querySelectorAll('#sporta-features').length }; });
      ok(en.t === 'Sporta features' && en.d === 'ltr' && en.href === '/shop?lang=en' && en.n === 1, 'language switch rebuilds in English, LTR');
      await p.evaluate(() => { history.pushState({}, '', '/shop'); renderShop(); }); await p.waitForTimeout(150);
      ok(await p.evaluate(() => !document.getElementById('sporta-features')), 'not shown off the home page');
      const errs = []; p.on('pageerror', e => errs.push(e.message));
      await p.evaluate(() => { history.pushState({}, '', '/'); renderHome(); }); await p.waitForTimeout(150);
      ok(await p.evaluate(() => !!document.getElementById('sporta-features')) && errs.length === 0, 'back on home: shown again, no JS errors');
      await p.screenshot({ path: path.join(__dirname, 'desktop.png'), fullPage: true });
    } else await p.screenshot({ path: path.join(__dirname, 'phone.png'), fullPage: true });
    await p.close();
  }
  await b.close(); srv.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
