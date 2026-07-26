import LegalPage from '../components/LegalPage'

// The list of collected data is taken from what the checkout form and the cart
// actually store, not from a template. If a field is added to checkout, it
// belongs in section 1 here — a privacy policy that under-declares is worse
// than none, because it is a specific false statement rather than a silence.
const UPDATED = '2026-07-26'

const INTRO = {
  en: 'This explains what Sporta collects when you shop with us, why, and what we never collect.',
  ar: 'توضّح هذه الصفحة ما تجمعه سبورتا عند الشراء منّا، ولماذا، وما لا نجمعه إطلاقاً.',
}

const SECTIONS = [
  {
    h: { en: '1. What we collect', ar: '١. ما الذي نجمعه' },
    p: [{
      en: 'To deliver an order we ask only for what a driver needs to reach you:',
      ar: 'لتوصيل الطلب نطلب فقط ما يحتاجه المندوب للوصول إليك:',
    }],
    list: [
      { en: 'Your name and mobile number', ar: 'الاسم ورقم الهاتف' },
      { en: 'Your delivery address — governorate, area, block, street and building', ar: 'عنوان التوصيل — المحافظة والمنطقة وقطعة وشارع وبناية' },
      { en: 'What you ordered, the amount paid, and the payment reference the bank returns', ar: 'محتوى الطلب والمبلغ المدفوع والرقم المرجعي الذي يعيده البنك' },
    ],
  },
  {
    h: { en: '2. What we never collect', ar: '٢. ما لا نجمعه إطلاقاً' },
    p: [{
      en: 'We never see or store your card number, KNET PIN, CVV or expiry date. Those are entered on the Commercial Bank of Kuwait’s own payment page. What comes back to us is a payment reference and whether the payment succeeded — nothing that could be used to charge your card again.',
      ar: 'لا نطّلع على رقم بطاقتك أو الرقم السري لكي نت أو رمز CVV أو تاريخ الانتهاء، ولا نخزّنها. فهذه تُدخل في صفحة الدفع لدى البنك التجاري الكويتي، وكل ما يصلنا هو رقم مرجعي ونتيجة العملية — ولا شيء يمكن استخدامه لخصم مبلغ آخر من بطاقتك.',
    }, {
      en: 'We do not run advertising trackers or third-party analytics on this site, and we do not sell or rent your data to anyone.',
      ar: 'لا نستخدم أدوات تتبّع إعلانية ولا تحليلات من أطراف خارجية على هذا الموقع، ولا نبيع بياناتك أو نؤجّرها لأي جهة.',
    }],
  },
  {
    h: { en: '3. Why we hold it', ar: '٣. لماذا نحتفظ بها' },
    p: [{
      en: 'Your details are used to fulfil and deliver your order, to handle a return or exchange, and to answer you if you contact us about it. We keep order records as long as we need them for accounting and for the returns period.',
      ar: 'تُستخدم بياناتك لتجهيز طلبك وتوصيله، ولمعالجة الإرجاع أو الاستبدال، وللرد عليك عند تواصلك بشأنه. ونحتفظ بسجلات الطلبات بالمدة اللازمة للأغراض المحاسبية ولفترة الإرجاع.',
    }],
  },
  {
    h: { en: '4. Who else sees it', ar: '٤. من يطّلع عليها أيضاً' },
    p: [{
      en: 'Only those who have to: the delivery driver bringing your order, and our payment provider, which receives the amount and a reference so the transaction can be processed. We may also disclose information where the law requires it.',
      ar: 'فقط من يلزم اطّلاعه: مندوب التوصيل الذي يوصل طلبك، ومزوّد خدمة الدفع الذي يستلم المبلغ والرقم المرجعي لإتمام العملية. وقد نُفصح عن معلومات عندما يوجب القانون ذلك.',
    }],
  },
  {
    h: { en: '5. What stays in your own browser', ar: '٥. ما يبقى داخل متصفحك أنت' },
    p: [{
      en: 'Your shopping bag, your wishlist, your language and your light or dark theme are saved in your browser, not on our servers. If you tick “remember my address” at checkout, that address is also stored in your browser only — clearing your browser data removes it, and it is never uploaded until you place an order.',
      ar: 'تُحفظ حقيبة التسوق وقائمة الرغبات واللغة ووضع العرض الفاتح أو الداكن داخل متصفحك لا على خوادمنا. وإذا اخترت «تذكّر عنواني» عند الدفع، فإن العنوان يُحفظ في متصفحك فقط — ويُحذف بمسح بيانات المتصفح، ولا يُرسل إلينا إلا عند تقديم طلب.',
    }],
  },
  {
    h: { en: '6. Your choices', ar: '٦. خياراتك' },
    p: [{
      en: 'You can ask us what we hold about you, ask for it to be corrected, or ask us to delete it where we are not required to keep it. Message us on WhatsApp at +965 2209 1914 or email cs@sporta.com.kw and we will respond.',
      ar: 'يمكنك أن تسألنا عمّا نحتفظ به عنك، أو تطلب تصحيحه، أو حذفه إن لم يكن الاحتفاظ به مُلزماً لنا. راسلنا على واتساب ‎+965 2209 1914 أو بالبريد cs@sporta.com.kw وسنرد عليك.',
    }],
  },
  {
    h: { en: '7. Security', ar: '٧. الأمان' },
    p: [{
      en: 'The whole site is served over HTTPS, so what you send is encrypted in transit. Order data is held in an access-controlled database, and payment credentials are held by the bank rather than by us.',
      ar: 'يُقدَّم الموقع بالكامل عبر HTTPS، فتكون بياناتك مشفّرة أثناء الإرسال. وتُحفظ بيانات الطلبات في قاعدة بيانات محكومة الصلاحيات، أما بيانات الدفع فهي لدى البنك لا لدينا.',
    }, {
      en: 'No system is perfect. If we ever become aware of a breach affecting your data, we will tell you.',
      ar: 'ولا يوجد نظام كامل. وإذا علمنا بأي اختراق يمسّ بياناتك فسنُبلغك بذلك.',
    }],
  },
]

export default function Privacy() {
  return (
    <LegalPage
      path="/privacy"
      titleKey={{ en: 'Privacy policy', ar: 'سياسة الخصوصية' }}
      updated={UPDATED}
      intro={INTRO}
      sections={SECTIONS}
    />
  )
}
