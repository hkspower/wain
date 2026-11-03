import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const CSS = readFileSync('/w/cand.css', 'utf8');
const B = 'https://www.sporta.com.kw';
const L = (...a) => console.log(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PROPS = ['display','position','width','height','marginTop','marginRight','marginBottom','marginLeft','paddingTop','paddingRight','paddingBottom','paddingLeft','fontSize','lineHeight','color','backgroundColor','borderRadius','opacity','visibility','flexDirection','justifyContent','gridTemplateColumns','objectFit','whiteSpace','overflowWrap','zIndex','boxShadow','gap','top','bottom'];
const WP = PROPS.indexOf('width'), HP = PROPS.indexOf('height');
const R = v => Math.round(v * 10) / 10;
const SNAP = (props) => {
  const INT = '.catalog-product-page .catalog-product-description, .catalog-product-page .product-purchase-row, .catalog-product-page .campaign-brand-plate, .catalog-product-page nav a, .catalog-product-page .catalog-product-options button.text-accent';
  const ints = Array.from(document.querySelectorAll(INT));
  const sx = window.scrollX, sy = window.scrollY;
  return Array.from(document.querySelectorAll('*')).map(el => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const cls = (el.getAttribute('class') || '').split(' ').filter(Boolean).slice(0, 2).join('.');
    let k = 0;
    if (el.closest(INT)) k = 1; else if (ints.some(x => el.contains(x))) k = 2;
    const vis = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    const ia = el.matches('a[href],button,input,select,textarea,summary,[role=button]') ? 1 : 0;
    const ox = cs.overflowX;
    const clip = (ox === 'hidden' || ox === 'clip' || ox === 'auto' || ox === 'scroll') && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 ? 1 : 0;
    return [el.tagName.toLowerCase() + (cls ? '.' + cls : ''), r.left + sx, r.top + sy, r.width, r.height, k, props.map(p => cs[p]), ia, vis ? 1 : 0, clip, ia ? (el.textContent || '').trim().slice(0, 14) : ''];
  });
};
const MET = () => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, sh: document.documentElement.scrollHeight, vw: window.innerWidth, dir: document.documentElement.dir });
const OVL = () => {
  const ia = [];
  Array.from(document.querySelectorAll('*')).forEach((el, i) => {
    if (el.matches('a[href],button,input,select,textarea,summary,[role=button]')) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none') ia.push([i, el, r]);
    }
  });
  const keys = [];
  for (let a = 0; a < ia.length; a++) for (let b = a + 1; b < ia.length; b++) {
    const P = ia[a][2], Q = ia[b][2];
    const w = Math.min(P.right, Q.right) - Math.max(P.left, Q.left);
    const h = Math.min(P.bottom, Q.bottom) - Math.max(P.top, Q.top);
    if (w > 2 && h > 2 && !ia[a][1].contains(ia[b][1]) && !ia[b][1].contains(ia[a][1])) keys.push(ia[a][0] + '-' + ia[b][0] + ':' + Math.round(w) + ':' + Math.round(h));
  }
  return keys;
};
const TXT = () => {
  const d = document.querySelector('.catalog-product-page .catalog-product-description');
  if (!d) return null;
  const orig = d.textContent;
  const m = t => { d.textContent = t; return [d.scrollWidth, d.clientWidth, document.documentElement.scrollWidth, Math.round(d.getBoundingClientRect().height)]; };
  const tok = m('x'.repeat(70)), nl = m(['line one','line two','line three'].join(String.fromCharCode(10))), one = m('line one');
  d.textContent = orig;
  return { tok, nl, one };
};
const COL = () => {
  const row = document.querySelector('.catalog-product-page .product-purchase-row');
  if (!row) return null;
  const rs = getComputedStyle(document.documentElement);
  const bgOf = e => { let x = e; while (x) { const b = getComputedStyle(x).backgroundColor; if (b && b !== 'rgba(0, 0, 0, 0)' && b !== 'transparent') return b; x = x.parentElement; } return 'none'; };
  const cs = getComputedStyle(row);
  return { canvas: rs.getPropertyValue('--canvas').trim(), line: rs.getPropertyValue('--line').trim(), theme: document.documentElement.getAttribute('data-theme'), body: getComputedStyle(document.body).backgroundColor, rowbg: cs.backgroundColor, rowsh: cs.boxShadow.slice(0, 48), under: bgOf(row.parentElement) };
};
const STK = () => {
  const row = document.querySelector('.catalog-product-page .product-purchase-row');
  if (!row) return null;
  const rn = (v) => Math.round(v);
  const r = row.getBoundingClientRect();
  const par = row.parentElement, pr = par.getBoundingClientRect();
  const ft = document.querySelector('footer, .app-footer'); const fr = ft ? ft.getBoundingClientRect() : null;
  const sig = e => e.tagName.toLowerCase() + '.' + (e.getAttribute('class') || '').split(' ').slice(0, 2).join('.');
  const fixed = Array.from(document.querySelectorAll('*')).filter(e => { const c = getComputedStyle(e); if (c.position !== 'fixed') return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && c.visibility !== 'hidden' && c.display !== 'none' && !row.contains(e) && !e.contains(row); }).map(e => {
    const b = e.getBoundingClientRect();
    const ix = Math.min(b.right, r.right) - Math.max(b.left, r.left), iy = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
    let top = null;
    if (ix > 0 && iy > 0) { const el = document.elementFromPoint(Math.max(b.left, r.left) + ix / 2, Math.max(b.top, r.top) + iy / 2); top = el ? (row.contains(el) ? 'ROW' : sig(el)) : null; }
    return [sig(e).slice(0, 36), rn(b.left), rn(b.top), rn(b.width), rn(b.height), ix > 0 && iy > 0 ? 'OVERLAP' : '', top];
  });
  const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { sy: rn(window.scrollY), max: rn(document.documentElement.scrollHeight - window.innerHeight), vh: window.innerHeight, row: [rn(r.top), rn(r.bottom), rn(r.left), rn(r.width), rn(r.height)], par: [sig(par).slice(0, 30), rn(pr.top), rn(pr.bottom)], ftTop: fr ? rn(fr.top) : null, rowOnTop: at ? row.contains(at) : null, fixed: fixed.filter(f => f[5]).concat([['fixedTotal', fixed.length]]) };
};
const cmp = (A, A2, C, OA, OC, MC) => {
  const o = { noise: 0, shift: 0, dymin: 0, dymax: 0, I: new Map(), An: new Map(), Lk: new Map(), tap: [], clip: [], off: [], ovl: [], iaI: [] };
  const add = (m, s, e) => { const g = m.get(s) || { n: 0, ex: [] }; g.n++; if (g.ex.length < 3) g.ex.push(e); m.set(s, g); };
  const vw = MC.vw;
  const offs = v => v[8] && (v[1] + v[3] > vw + 1 || v[1] < -1);
  for (let i = 0; i < A.length; i++) {
    const a = A[i], a2 = A2[i], c = C[i];
    if (Math.abs(a[1] - a2[1]) > 0.6 || Math.abs(a[2] - a2[2]) > 0.6 || Math.abs(a[3] - a2[3]) > 0.6 || Math.abs(a[4] - a2[4]) > 0.6 || a[6].join('|') !== a2[6].join('|')) { o.noise++; continue; }
    const d = [R(c[1] - a[1]), R(c[2] - a[2]), R(c[3] - a[3]), R(c[4] - a[4])];
    const pc = [];
    a[6].forEach((v, j) => { if (j !== WP && j !== HP && v !== c[6][j]) pc.push([PROPS[j], String(v).slice(0, 24), String(c[6][j]).slice(0, 24)]); });
    if (a[7] && a[8] && a[3] >= 44 && a[4] >= 44 && (c[3] < 44 || c[4] < 44)) o.tap.push([a[0].slice(0, 30), R(a[3]), R(a[4]), R(c[3]), R(c[4])]);
    if (!a[9] && c[9]) o.clip.push(a[0].slice(0, 40));
    if (offs(c) && !offs(a)) o.off.push([a[0].slice(0, 40), R(c[1]), R(c[3])]);
    const boxCh = d.some(v => Math.abs(v) > 0.6);
    if (c[5] === 1 && c[7] && c[8]) o.iaI.push([a[10], R(a[3]), R(a[4]), '>', R(c[3]), R(c[4]), 'dx', d[0], 'dy', d[1]]);
    if (!boxCh && !pc.length) continue;
    const k = c[5], sig = a[0].slice(0, 44);
    if (k === 0 && Math.abs(d[0]) < 0.6 && Math.abs(d[2]) < 0.6 && Math.abs(d[3]) < 0.6 && !pc.length) { o.shift++; o.dymin = Math.min(o.dymin, d[1]); o.dymax = Math.max(o.dymax, d[1]); continue; }
    add(k === 1 ? o.I : k === 2 ? o.An : o.Lk, sig, [i, d, pc.slice(0, 3)]);
  }
  const sa = new Map(OA.map(k => { const p = k.split(':'); return [p[0], [+p[1], +p[2]]]; }));
  OC.forEach(k => { const p = k.split(':'); const b = sa.get(p[0]); if (!b || Math.abs(b[0] - +p[1]) > 4 || Math.abs(b[1] - +p[2]) > 4) { const ij = p[0].split('-'); o.ovl.push([C[+ij[0]][0].slice(0, 28), C[+ij[1]][0].slice(0, 28), b ? 'was' + b.join('x') : 'new', p[1] + 'x' + p[2]]); } });
  return o;
};
const fmt = (m, mx, ne) => Array.from(m.entries()).slice(0, mx).map(([s, g]) => s + ' x' + g.n + (ne ? ' ' + JSON.stringify(g.ex.slice(0, ne)) : '')).join(' | ');
const VH = { 320: 640, 390: 844, 768: 1024, 1280: 800 };
const open = async (br, J) => {
  const ctx = await br.newContext({ viewport: { width: J.vw, height: VH[J.vw] }, locale: J.lang === 'ar' ? 'ar-KW' : 'en-US', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const reqs = [], blocked = [];
  await page.route('**/*', route => { const m = route.request().method(); if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return route.continue(); blocked.push(m + ' ' + route.request().url().slice(0, 70)); return route.abort(); });
  page.on('request', rq => { const t = rq.resourceType(); if (t === 'xhr' || t === 'fetch') reqs.push(rq.method() + ' ' + rq.url().replace(B, '').slice(0, 70)); });
  await page.goto(B + J.p + (J.lang === 'en' ? (J.p.includes('?') ? '&' : '?') + 'lang=en' : ''), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector(J.p.startsWith('/product/') ? '.catalog-product-page .catalog-product-description' : 'main', { timeout: 20000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < h; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 70)); } window.scrollTo(0, 0); });
  await sleep(500);
  return { ctx, page, reqs, blocked };
};
const run = async (br, J) => {
  const { ctx, page, reqs, blocked } = await open(br, J);
  try {
    const has = await page.evaluate(() => !!document.querySelector('.catalog-product-page'));
    if (J.pre) await J.pre(page);
    const A = await page.evaluate(SNAP, PROPS), OA = await page.evaluate(OVL), MA = await page.evaluate(MET);
    await sleep(400);
    const A2 = await page.evaluate(SNAP, PROPS);
    const h = await page.addStyleTag({ content: CSS });
    await h.evaluate(e => e.setAttribute('data-cand', '1'));
    await sleep(500);
    const C = await page.evaluate(SNAP, PROPS), OC = await page.evaluate(OVL), MC = await page.evaluate(MET);
    if (A.length !== C.length) { L('J', J.key, 'DOM COUNT DIFF', A.length, C.length); await ctx.close(); return; }
    const o = cmp(A, A2, C, OA, OC, MC);
    const cnt = m => Array.from(m.values()).reduce((s, g) => s + g.n, 0);
    L('J', J.key, 'page=' + (has ? 1 : 0), 'els=' + A.length, 'noise=' + o.noise, 'shift=' + o.shift + '[' + o.dymin + ',' + o.dymax + ']', 'I=' + o.I.size + '/' + cnt(o.I), 'An=' + o.An.size + '/' + cnt(o.An), 'LEAK=' + o.Lk.size + '/' + cnt(o.Lk), 'tap=' + o.tap.length, 'ovl=' + o.ovl.length, 'clip=' + o.clip.length, 'off=' + o.off.length, 'sw=' + MA.sw + '>' + MC.sw + '/' + MC.vw, 'bw=' + MA.bw + '>' + MC.bw, 'h=' + MA.sh + '>' + MC.sh, 'dir=' + MC.dir, 'blk=' + blocked.length);
    if (J.mode !== 'brief' && o.I.size) L('I', J.key, fmt(o.I, 9, J.mode === 'full' ? 2 : 1));
    if (J.mode === 'full' && o.An.size) L('An', J.key, fmt(o.An, 8, 1));
    if (o.Lk.size) L('LEAKDETAIL', J.key, fmt(o.Lk, 10, 3));
    if (o.tap.length) L('TAPLOST', J.key, o.tap.slice(0, 6));
    if (o.ovl.length) L('NEWOVL', J.key, o.ovl.slice(0, 5));
    if (o.clip.length) L('NEWCLIP', J.key, o.clip.slice(0, 5));
    if (o.off.length) L('NEWOFF', J.key, o.off.slice(0, 5));
    if (J.mode !== 'brief') L('IA', J.key, o.iaI.slice(0, 10));
    if (J.txt) {
      await h.evaluate(e => { e.disabled = true; }); await sleep(200);
      const tb = await page.evaluate(TXT);
      await h.evaluate(e => { e.disabled = false; }); await sleep(200);
      const ta = await page.evaluate(TXT);
      L('TXT', J.key, 'before', tb, 'after', ta);
    }
    if (J.sticky) {
      for (const f of [0, 0.4, 1]) {
        await page.evaluate(fr => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - window.innerHeight) * fr)), f);
        await sleep(250);
        L('STK', J.key, 'f=' + f, await page.evaluate(STK));
      }
      await page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
      const c1 = await page.evaluate(COL);
      await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); }); await sleep(250);
      const c2 = await page.evaluate(COL);
      await page.evaluate(() => { document.documentElement.removeAttribute('data-theme'); }); await sleep(200);
      L('COL', J.key, 'light', c1, 'dark', c2);
      if (J.modal) {
        try {
          const btn = page.locator('.catalog-product-page .catalog-product-options button.text-accent').first();
          const t = await btn.innerText({ timeout: 3000 });
          await btn.click({ timeout: 6000 }); await sleep(700);
          const md = await page.evaluate(() => { const row = document.querySelector('.catalog-product-page .product-purchase-row'); const r = row.getBoundingClientRect(); const dlg = document.querySelector('[role=dialog], dialog, [aria-modal=true]'); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); const dr = dlg ? dlg.getBoundingClientRect() : null; return { dlg: !!dlg, dr: dr ? [Math.round(dr.left), Math.round(dr.top), Math.round(dr.width), Math.round(dr.height)] : null, rowCoversModal: at ? row.contains(at) : null, atSig: at ? at.tagName + '.' + (at.getAttribute('class') || '').slice(0, 30) : null, rowTop: Math.round(r.top) }; });
          L('MODAL', J.key, 'btn=' + t, md);
        } catch (e) { L('MODAL', J.key, 'ERR', String(e).slice(0, 200)); }
      }
    }
    if (J.xhr) {
      const ld = await page.evaluate(() => Array.from(document.querySelectorAll('script[type*=ld]')).map(s => s.textContent.includes('Product')));
      L('XHR', J.key, reqs.filter((v, i, a) => a.indexOf(v) === i).slice(0, 14), 'blocked', blocked, 'ldProduct', ld);
    }
    if (blocked.length) L('BLOCKED', J.key, blocked.slice(0, 3));
  } catch (e) { L('J', J.key, 'ERR', String(e).slice(0, 300)); }
  await ctx.close();
};
const jobs = [];
const add = (key, p, lang, vw, o) => jobs.push(Object.assign({ key: key, p: p, lang: lang, vw: vw, mode: 'brief' }, o || {}));
const C1 = '/product/cloudsoft-jacket-army-green';
const modalPre = async (page) => { const b = page.locator('.catalog-product-page .catalog-product-options button.text-accent').first(); await b.click({ timeout: 6000 }); await sleep(700); };
[['ar', 390], ['en', 390], ['ar', 768], ['en', 768], ['ar', 1280], ['en', 1280], ['ar', 320], ['en', 320]].forEach(x => add('cloud-' + x[0] + x[1], C1, x[0], x[1], { mode: 'full', txt: 1, sticky: x[1] >= 768, modal: x[0] === 'en' && x[1] === 1280 }));
add('cloud-en390-sizeguide', C1, 'en', 390, { mode: 'full', pre: modalPre });
add('sculptleg-ar390', '/product/sculpt-leggings-navy', 'ar', 390, { mode: 'mid' });
add('sculptleg-en390', '/product/sculpt-leggings-navy', 'en', 390, { mode: 'mid' });
['tekno-shorts-black', 'denver-nuggets-cap-navy'].forEach(s => [['ar', 390], ['en', 390], ['ar', 768], ['en', 768], ['ar', 1280], ['en', 1280]].forEach(x => add(s.slice(0, 6) + '-' + x[0] + x[1], '/product/' + s, x[0], x[1], { mode: 'mid', xhr: s.startsWith('denver') && x[0] === 'ar' && x[1] === 390, sticky: false })));
['cagliari-calcio-backpack', 'cheetahs-rugby-t-shirt', 'gymshark-phone-strap', 'cloudsoft-leggings-grey'].forEach(s => ['ar', 'en'].forEach(l => add(s.slice(0, 8) + '-' + l + '390', '/product/' + s, l, 390, { mode: 'mid' })));
['vanquish-stringer-vest-white', 'cagliari-calcio-sweatshirt-navy'].forEach(s => ['ar', 'en'].forEach(l => add(s.slice(0, 8) + '-' + l + '320', '/product/' + s, l, 320, { mode: 'mid' })));
['define-jacket-onyx-black', 'naples-leggings-black', 'naples-sports-bra-pink', 'sculpt-jacket-black', 'sculpt-top-black', 'cloudsoft-top-grey', 'flash-shorts-green', 'street-pants-navy', 'energy-t-shirt-red-white', 'sgomma-t-shirt-navy', 'vanquish-t-shirt-white', 'vanquish-tank-navy', 'vanquish-stringer-vest-white', 'cagliari-calcio-sweatshirt-navy', 'cagliari-calcio-backpack-navy'].forEach(s => add('fam-' + s.slice(0, 22), '/product/' + s, 'en', 390, {}));
[['ar', 390], ['en', 390], ['ar', 1280]].forEach(x => { add('home-' + x[0] + x[1], '/', x[0], x[1], {}); add('shop-' + x[0] + x[1], '/shop', x[0], x[1], {}); });
const br = await chromium.launch({ args: ['--no-sandbox'] });
L('JOBS', jobs.length);
for (const J of jobs) await run(br, J);
await br.close();
L('DONE_MARK');
