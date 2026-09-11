/**
 * يولّد كتلة البيانات المنظّمة (JSON-LD) من محتوى الصفحة نفسه.
 *
 * لماذا يُولَّد لا يُكتب بيدك: جوجل يشترط أن تصف السكيما ما يراه الزائر
 * على الصفحة، ويعاقب على الاختلاف. وأسهل خطأ في الدنيا أن يُعدَّل نصٌّ في
 * الصفحة ويُنسى توأمه في السكيما، فيتحوّل تحسين الأرشفة إلى مخالفة.
 * فالمصدر واحد: الصفحة. والسكيما مشتقّة منها.
 *
 * **ولا `FAQPage` بعد اليوم.** كانت تُبنى من قائمة أسئلة تظهر للزائر في
 * الصفحة التعريفية. ولمّا صار الموقع صفحةً واحدة — وكيلٌ يُسأل بالكلام —
 * لم يبقَ على الصفحة سؤالٌ وجوابٌ ظاهران، وسكيما تصف ما ليس على الصفحة
 * هي المخالفة نفسها التي وُجدت هذه الأداة لتمنعها.
 *
 *   node website/tools/make-jsonld.mjs           # يكتب الكتلة في index.html
 *   node website/tools/make-jsonld.mjs --check    # يتحقّق فقط (يُستعمل في البناء)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* الموقع صفحةٌ واحدة، فالسكيما فيها */
const FILE = path.join(HERE, '..', 'index.html');

const START = '<!-- ⟦JSON-LD⟧ مولَّدة من محتوى الصفحة — لا تحرّرها بيدك -->';
const END = '<!-- ⟦/JSON-LD⟧ -->';

/** نصّ خالص من HTML: يفكّ الكيانات ويزيل الوسوم ويضغط الفراغ */
const text = (html) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#3[49];/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** قيمة وسم meta أو link */
const meta = (html, attr, key) => {
  const m = html.match(new RegExp(`<(?:meta|link)[^>]*${attr}=["']${key}["'][^>]*>`));
  if (!m) return '';
  const c = m[0].match(/(?:content|href)=["']([^"']*)["']/);
  return c ? c[1] : '';
};

function build(html) {
  /* **جذر الموقع لا عنوان الصفحة.** المؤسّسة والموقع والخدمة كيانات تخصّ
     الموقع كلّه، ومعرّفاتها تُبنى منه. وكان يُؤخذ الرابط المعياريّ كما هو،
     فلمّا صارت السكيما في `about.html` صار المعرّف
     `…/about.html/#organization` — مسارٌ ثم `/#`، عنوانٌ لا يدلّ على شيء،
     ويصير للمؤسّسة الواحدة هويّتان لو أُضيفت سكيما في صفحةٍ أخرى. الصفحة
     تبقى مرجعًا للأسئلة وحدها. */
  const canonical = meta(html, 'rel', 'canonical').replace(/\/$/, '');
  const site = canonical.replace(/\/[^/]*\.html$/, '');

  if (!canonical) throw new Error('لا يوجد رابط canonical في الصفحة');

  const phone = (html.match(/href="tel:(\+?[0-9]+)"/) || [])[1] || '';
  const whatsapp = (html.match(/https:\/\/wa\.me\/([0-9]+)/) || [])[1] || '';
  const email = (html.match(/href="mailto:([^"]+)"/) || [])[1] || '';

  const org = {
    '@type': 'Organization',
    '@id': `${site}/#organization`,
    name: 'موصول',
    alternateName: 'MAWSOOL',
    url: `${site}/`,
    logo: { '@type': 'ImageObject', url: `${site}/assets/mawsool-mark-512.png` },
    image: meta(html, 'property', 'og:image'),
    description: meta(html, 'name', 'description'),
    // وسيط بين الزبون والكابتن — لا مالك أسطول ولا موظِّف سائقين
    slogan: 'نربط الزبون بكابتن معتمد بسيارة حديثة',
    areaServed: { '@type': 'Country', name: 'الكويت' },
    contactPoint: [{
      '@type': 'ContactPoint',
      contactType: 'customer service',
      availableLanguage: ['ar', 'en'],
      ...(phone && { telephone: phone }),
      ...(email && { email }),
    }],
    ...(whatsapp && { sameAs: [`https://wa.me/${whatsapp}`] }),
  };

  const service = {
    '@type': 'Service',
    '@id': `${site}/#service`,
    name: 'توصيل الطلبات بالسيارات في الكويت',
    serviceType: 'خدمة توصيل',
    provider: { '@id': `${site}/#organization` },
    areaServed: { '@type': 'Country', name: 'الكويت' },
    availableChannel: {
      '@type': 'ServiceChannel',
      serviceUrl: `${site}/`,
      ...(phone && { servicePhone: phone }),
    },
    hoursAvailable: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      opens: '08:00',
      closes: '00:00',
    },
  };

  const website = {
    '@type': 'WebSite',
    '@id': `${site}/#website`,
    url: `${site}/`,
    name: 'موصول',
    inLanguage: 'ar-KW',
    publisher: { '@id': `${site}/#organization` },
  };

  return { '@context': 'https://schema.org', '@graph': [org, website, service] };
}

/* ------------------------------ التشغيل ------------------------------ */

const html = fs.readFileSync(FILE, 'utf8');
const graph = build(html);
const json = JSON.stringify(graph, null, 2);
const block = `${START}\n<script type="application/ld+json">\n${json}\n</script>\n${END}`;

const has = html.includes(START) && html.includes(END);
const current = has
  ? html.slice(html.indexOf(START), html.indexOf(END) + END.length)
  : null;

if (process.argv.includes('--check')) {
  if (!has) {
    console.error('✗ لا توجد كتلة بيانات منظّمة في الصفحة — شغّل: node website/tools/make-jsonld.mjs');
    process.exit(1);
  }
  if (current !== block) {
    console.error('✗ البيانات المنظّمة لا تطابق محتوى الصفحة — أعِد توليدها:');
    console.error('    node website/tools/make-jsonld.mjs');
    process.exit(1);
  }
  console.log(`✓ البيانات المنظّمة تطابق الصفحة — ${graph['@graph'].length} كيانات`);
  process.exit(0);
}

let next;
if (has) {
  next = html.slice(0, html.indexOf(START)) + block + html.slice(html.indexOf(END) + END.length);
} else {
  const anchor = '</head>';
  if (!html.includes(anchor)) throw new Error('لا يوجد </head> في الصفحة');
  next = html.replace(anchor, `\n${block}\n${anchor}`);
}

fs.writeFileSync(FILE, next);
console.log(`✓ كُتبت البيانات المنظّمة — ${graph['@graph'].map((e) => e['@type']).join(' · ')}`);
