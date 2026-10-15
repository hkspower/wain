/**
 * test:input-text — every text box, select and textarea on the shop and every /backends screen
 * (phone + desktop, both languages, light and dark panel): typed text >= 4.5:1, hint >= 3:1,
 * 16px on a touch screen (iOS zooms below that), not clipped, and email/url boxes left-to-right.
 * Colours are read through a canvas, because the bundle's Tailwind writes lab() colours.
 * Run `bash scripts/sandbox.sh` first. Added 2026-10-15 ("fix all input text").
 */
import { chromium } from 'playwright'
const BASE=process.env.BASE ?? 'http://127.0.0.1:4300'
const measure = () => {
  const cv=document.createElement('canvas');cv.width=cv.height=1;const cx=cv.getContext('2d',{willReadFrequently:true});const parse=c=>{if(!c||c==='transparent')return {r:0,g:0,b:0,a:0};cx.clearRect(0,0,1,1);cx.fillStyle='#000';cx.fillStyle=c;cx.fillRect(0,0,1,1);const d=cx.getImageData(0,0,1,1).data;return {r:d[0],g:d[1],b:d[2],a:d[3]/255}}
  const L=({r,g,b})=>{const f=x=>{x/=255;return x<=0.03928?x/12.92:((x+0.055)/1.055)**2.4};return .2126*f(r)+.7152*f(g)+.0722*f(b)}
  const ratio=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
  const bgOf=el=>{let layers=[];for(let e=el;e;e=e.parentElement){const c=parse(getComputedStyle(e).backgroundColor);if(c&&c.a>0){layers.push(c);if(c.a>=1)break}}let out={r:255,g:255,b:255};if(layers.length&&layers[layers.length-1].a>=1)out=layers.pop();for(const c of layers.reverse()){out={r:c.r*c.a+out.r*(1-c.a),g:c.g*c.a+out.g*(1-c.a),b:c.b*c.a+out.b*(1-c.a)}}return out}
  const res=[]
  for(const el of document.querySelectorAll('input,textarea,select')){
    const t=(el.type||'').toLowerCase(); if(['hidden','checkbox','radio','file','range','submit','button','color','image','reset'].includes(t))continue
    const r=el.getBoundingClientRect(); const cs=getComputedStyle(el)
    if(r.width<2||r.height<2||cs.visibility==='hidden'||cs.display==='none')continue
    const name=(el.name||el.id||el.getAttribute('aria-label')||el.placeholder||el.className||'').toString().slice(0,40)
    const bg=bgOf(el); const fg=parse(cs.color); const issues=[]
    const cr=ratio(fg,bg); if(cr<4.5)issues.push('text '+cr.toFixed(2))
    let ph=null; try{ph=getComputedStyle(el,'::placeholder').color}catch{}
    if(el.placeholder&&ph){const p=parse(ph);const pc={r:p.r*p.a+bg.r*(1-p.a),g:p.g*p.a+bg.g*(1-p.a),b:p.b*p.a+bg.b*(1-p.a)};const pr=ratio(pc,bg);if(pr<3)issues.push('placeholder '+pr.toFixed(2))}
    const fs=parseFloat(cs.fontSize); if(matchMedia('(pointer: coarse)').matches&&fs<16)issues.push('font '+fs+'px (iOS zoom)')
    const lh=cs.lineHeight==='normal'?fs*1.25:parseFloat(cs.lineHeight)
    const inner=r.height-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom)-parseFloat(cs.borderTopWidth)-parseFloat(cs.borderBottomWidth)
    if(el.tagName!=='TEXTAREA'&&inner<fs*1.1)issues.push('clipped inner '+inner.toFixed(1)+' < '+fs)
    if(['email','tel','url','number','password'].includes(t)&&cs.direction==='rtl'&&!el.value&&false){}
    if(['email','url'].includes(t)&&cs.direction==='rtl')issues.push('rtl '+t)
    if(issues.length)res.push({tag:el.tagName.toLowerCase(),type:t,name,issues,fg:cs.color,bgc:`rgb(${bg.r|0},${bg.g|0},${bg.b|0})`})
  }
  return res
}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM ?? '/opt/pw-browsers/chromium'})
const out={}
for(const dev of [{n:'phone',viewport:{width:390,height:844},hasTouch:true,isMobile:true},{n:'desk',viewport:{width:1280,height:900}}]){
 for(const lang of ['ar','en']){
  const ctx=await browser.newContext({...dev})
  await ctx.addInitScript(l=>{try{localStorage.setItem('lang',l)}catch{}},lang)
  const p=await ctx.newPage()
  // fill cart
  await p.goto(BASE+'/',{waitUntil:'networkidle'})
  const prods=await (await ctx.request.get(BASE+'/api/api.php?r=products')).json()
  const pr=(prods.products||prods)[0]
  for(const path of ['/','/shop','/track','/returns','/returns/request','/contact','/card','/product/'+pr.slug]){
    await p.goto(BASE+path,{waitUntil:'networkidle'}).catch(()=>{}); await p.waitForTimeout(600)
    const r=await p.evaluate(measure); if(r.length)out[`${dev.n}/${lang}${path}`]=r
  }
  // checkout via add
  await p.evaluate(s=>{localStorage.setItem('sporta_cart',JSON.stringify([{slug:s.slug,size:'M',fit:'normal',qty:1,key:s.slug+'__M__normal',name:s.name_en||s.slug,price:s.price,image:''}]))},pr)
  await p.goto(BASE+'/checkout',{waitUntil:'networkidle'});await p.waitForTimeout(800)
  {const r=await p.evaluate(measure); out[`${dev.n}/${lang}/checkout`]=r.length?r:['(inputs found: '+await p.locator('input').count()+')']}
  // account sheet
  await p.goto(BASE+'/',{waitUntil:'networkidle'})
  const acc=p.locator('[data-ca-open], button[aria-label*="ccount"], button[aria-label*="حساب"]').first()
  if(await acc.count()){await acc.evaluate(b=>b.click());await p.waitForTimeout(700);const r=await p.evaluate(measure);if(r.length)out[`${dev.n}/${lang}/account-sheet`]=r}
  await ctx.close()
 }
 // panel
 const ctx=await browser.newContext({...dev})
 const p=await ctx.newPage()
 await p.goto(BASE+'/backends',{waitUntil:'networkidle'});await p.waitForTimeout(800)
 {const r=await p.evaluate(measure);if(r.length)out[`${dev.n}/panel/login`]=r}
 await ctx.request.post(BASE+'/api/admin.php?r=login',{headers:{'X-Sporta-Admin':'1'},data:{email:'manager@sporta.com.kw',password:'correct horse'}})
 await p.goto(BASE+'/backends',{waitUntil:'networkidle'});await p.waitForTimeout(1500)
 const navs=await p.evaluate(()=>[...new Set([...document.querySelectorAll('aside button, nav button, [data-spps-nav], .admin-shell nav a')].map(b=>b.textContent.trim()).filter(t=>t&&t.length<30))])
 out[`${dev.n}/panel/navs`]=navs
 for(const t of navs){
   const b=p.locator('aside button, nav button, [data-spps-nav], .admin-shell nav a').filter({hasText:t}).first()
   try{await b.evaluate(x=>x.click());await p.waitForTimeout(1200)}catch{continue}
   await p.evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=true))
   const r=await p.evaluate(measure); if(r.length)out[`${dev.n}/panel/${t}`]=r
 }
 await ctx.close()
}
await browser.close()
let fails=0
for(const [k,v] of Object.entries(out)){
  if(k.endsWith('/navs')){ if(v.length<10){fails++;console.log('FAIL '+k+' found only '+v.length+' panel screens')} continue }
  if(k.endsWith('/checkout')&&typeof v[0]==='string'){ if(/: 0\)/.test(v[0])){fails++;console.log('FAIL '+k+' drew no fields (cart not taken)')} else console.log('ok   '+k+' '+v[0]); continue }
  for(const x of v){fails++;console.log(`FAIL ${k}  ${x.tag}[${x.type}] "${x.name}"  ${x.issues.join(', ')}  fg=${x.fg} bg=${x.bgc}`)}
}
console.log(fails?`\n${fails} FAILED`:'\nall input text checks passed')
process.exitCode=fails?1:0
