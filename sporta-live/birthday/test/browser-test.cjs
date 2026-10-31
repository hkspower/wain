const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs=[]; p.on('pageerror', e=>errs.push(e.message));
  await p.goto('file://' + __dirname + '/mock-page.html');
  const ok=(c,m)=>console.log((c?'PASS ':'FAIL ')+m);
  await p.evaluate(()=>showSignup()); await p.waitForTimeout(100);
  ok(await p.locator('form .sporta-bday').count()===1,'signup picker mounted');
  ok(await p.locator('#customer-birthday-month option').count()===13,'12 months + placeholder');
  ok((await p.locator('#customer-birthday-month option').nth(1).textContent())==='يناير','Arabic month names');
  // partial blocks submit
  await p.selectOption('#customer-birthday-month','2');
  await p.click('form button'); await p.waitForTimeout(50);
  ok(!(await p.evaluate(()=>window.reactSubmitted)),'partial date blocks React submit');
  ok(await p.locator('.sporta-bday__err').isVisible(),'partial shows error');
  // Feb in leap year = 29 days, non-leap 28
  await p.selectOption('#customer-birthday-year','2000');
  ok(await p.locator('#customer-birthday-day option').count()===30,'Feb 2000 has 29 days');
  await p.selectOption('#customer-birthday-year','2001');
  ok(await p.locator('#customer-birthday-day option').count()===29,'Feb 2001 has 28 days');
  await p.selectOption('#customer-birthday-day','14');
  await p.click('form button'); await p.waitForTimeout(50);
  ok(await p.evaluate(()=>window.reactSubmitted)===1,'complete date lets React submit');
  ok(await p.evaluate(()=>sessionStorage.getItem('sporta_bday_pending'))==='2001-02-14','pending stored');
  // re-render keeps one picker
  await p.evaluate(()=>{const f=document.getElementById('f'); f.querySelector('.sporta-bday').remove();}); await p.waitForTimeout(100);
  ok(await p.locator('form .sporta-bday').count()===1,'re-added after removal');
  // registration done → dashboard
  await p.evaluate(()=>{window.signedIn=true; showDash();}); await p.waitForTimeout(300);
  ok(await p.locator('.sporta-bday-panel').count()===1,'account panel mounted');
  const calls=await p.evaluate(()=>calls);
  ok(calls.some(c=>c[0]==='POST'&&c[2].includes('2001-02-14')&&c[3]==='1'),'pending POSTed with X-Sporta-Customer');
  ok(await p.evaluate(()=>sessionStorage.getItem('sporta_bday_pending'))===null,'pending cleared');
  ok(await p.inputValue('#customer-profile-birthday-year')==='2001' && await p.inputValue('#customer-profile-birthday-day')==='14','dashboard shows saved date');
  ok((await p.locator('.sporta-bday-panel .sporta-bday__hint').textContent()).includes('10%'),'gift hint shows 10%');
  // change & save
  await p.selectOption('#customer-profile-birthday-month','7'); await p.click('.sporta-bday-panel button'); await p.waitForTimeout(100);
  ok(await p.evaluate(()=>saved)==='2001-07-14','save sends new date');
  ok((await p.locator('.sporta-bday__status').textContent())==='تم الحفظ.','saved message');
  // language switch
  await p.evaluate(()=>{document.documentElement.lang='en'; document.body.appendChild(document.createElement('i'));}); await p.waitForTimeout(200);
  ok((await p.locator('.sporta-bday-panel h2').textContent())==='Your birthday','rebuilt in English');
  ok(await p.inputValue('#customer-profile-birthday-month')==='7','value kept after language switch');
  // clear
  await p.selectOption('#customer-profile-birthday-day',''); await p.selectOption('#customer-profile-birthday-month',''); await p.selectOption('#customer-profile-birthday-year','');
  await p.click('.sporta-bday-panel button'); await p.waitForTimeout(100);
  ok(await p.evaluate(()=>saved)===null,'clearing sends empty');
  ok(errs.length===0,'no page errors '+errs.join('|'));
  await b.close();
})();
