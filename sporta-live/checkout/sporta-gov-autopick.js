/* Sporta checkout: pick the governorate from the area.
 * A customer could type Salmiya (Hawalli) with Capital selected and the order
 * went through with a governorate the courier would follow to the wrong place.
 * When the area field loses focus and its text is a known area of ANOTHER
 * governorate, this sets the governorate to match and puts the area back
 * (changing the governorate clears the area in the page's own code).
 * Unknown areas are left alone: free text stays allowed on purpose.
 * Same 97-area list the checkout suggests (6 governorates, Arabic + English).
 * External file: the live CSP forbids inline script. No dollar signs on purpose
 * (the installer runs through docker compose, which interpolates them). */
(function () {
  'use strict';
  var DATA = 'capital:Kuwait City|مدينة الكويت|Sharq|شرق|Mirqab|المرقاب|Dasman|دسمان|Qibla|قبلة|Salhiya|الصالحية|Bneid Al Gar|بنيد القار|Kaifan|كيفان|Mansouriya|المنصورية|Dasma|الدسمة|Daiya|الدعية|Shamiya|الشامية|Abdullah Al-Salem|ضاحية عبدالله السالم|Nuzha|النزهة|Faiha|الفيحاء|Khaldiya|الخالدية|Rawda|الروضة|Adailiya|العديلية|Yarmouk|اليرموك|Surra|السرة|Qadsiya|القادسية|Qurtuba|قرطبة|Shuwaikh|الشويخ|Doha|الدوحة|Granada|غرناطة|Sulaibikhat|الصليبيخات|Jaber Al-Ahmad|جابر الأحمد|Nahdha|النهضة|Qairawan|القيروان;hawalli:Hawalli|حولي|Salmiya|السالمية|Rumaithiya|الرميثية|Bayan|بيان|Mishref|مشرف|Salwa|سلوى|Jabriya|الجابرية|Shaab|الشعب|Maidan Hawalli|ميدان حولي|Nugra|النقرة|Bida\'a|البدع|Zahra|الزهراء|Hitteen|حطين|Shuhada|الشهداء|Salam|السلام|Siddeeq|الصديق|Mubarak Al-Abdullah|مبارك العبدالله;farwaniya:Farwaniya|الفروانية|Khaitan|خيطان|Abraq Khaitan|أبرق خيطان|Jleeb Al-Shuyoukh|جليب الشيوخ|Ardiya|العارضية|Rabiya|الرابية|Andalous|الأندلس|Rehab|الرحاب|Ishbiliya|إشبيلية|Firdous|الفردوس|Omariya|العمرية|Riggae|الرقعي|Dajeej|الضجيج|Abdullah Al-Mubarak|عبدالله المبارك|Sabah Al-Nasser|صباح الناصر;mubarak-al-kabeer:Mubarak Al-Kabeer|مبارك الكبير|Qurain|القرين|Adan|العدان|Qusour|القصور|Sabah Al-Salem|صباح السالم|Messila|المسيلة|Abu Ftaira|أبو فطيرة|Fnaitees|الفنيطيس|Mesayel|المسايل|Sabhan|صبحان;ahmadi:Ahmadi|الأحمدي|Fahaheel|الفحيحيل|Mangaf|المنقف|Abu Halifa|أبو حليفة|Fintas|الفنطاس|Mahboula|المهبولة|Riqqa|الرقة|Hadiya|هدية|Sabahiya|الصباحية|Egaila|العقيلة|Ali Sabah Al-Salem|علي صباح السالم|Jaber Al-Ali|جابر العلي|Sabah Al-Ahmad|صباح الأحمد|Wafra|الوفرة|Khairan|الخيران;jahra:Jahra|الجهراء|Saad Al-Abdullah|سعد العبدالله|Naeem|النعيم|Nasseem|النسيم|Qasr|القصر|Waha|الواحة|Oyoun|العيون|Taima|تيماء|Sulaibiya|الصليبية|Amghara|أمغرة|Kabd|كبد';
  function norm(s) {
    s = String(s || '').toLowerCase().trim();
    s = s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
    s = s.replace(/[ً-ْـ]/g, '');
    s = s.replace(/^ال/, '').replace(/^al[- ]?/, '');
    return s.replace(/[^a-z0-9؀-ۿ]/g, '');
  }
  var MAP = {};
  DATA.split(';').forEach(function (block) {
    var i = block.indexOf(':'); var gov = block.slice(0, i);
    block.slice(i + 1).split('|').forEach(function (name) { var k = norm(name); if (k && !MAP[k]) MAP[k] = gov; });
  });
  var setVal = function (el, v) {
    var proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  };
  function fix(area) {
    var form = area.form || document;
    var gov = form.querySelector('select[name="address-level1"]');
    var want = MAP[norm(area.value)];
    if (!gov || !want || gov.value === want) return;
    if (!gov.querySelector('option[value="' + want + '"]')) return;
    var typed = area.value;
    setVal(gov, want);
    gov.dispatchEvent(new Event('change', { bubbles: true }));
    setTimeout(function () {
      var a = form.querySelector('[name="address-level2"]') || area;
      if (a.value === typed) return;
      setVal(a, typed);
      a.dispatchEvent(new Event('input', { bubbles: true }));
      a.dispatchEvent(new Event('change', { bubbles: true }));
    }, 60);
  }
  document.addEventListener('focusout', function (e) {
    var t = e.target;
    if (t && t.name === 'address-level2') setTimeout(function () { fix(t); }, 120);
  }, true);
})();
