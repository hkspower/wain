/**
 * Language and copy. ARABIC IS THE DEFAULT — this is a Kuwaiti shop, and the
 * web storefront defaults the same way; an English-first app would be a
 * different shop for most of the people opening it.
 *
 * Layout direction is handled WITHOUT I18nManager.forceRTL. That call needs a
 * full app reload to take effect, so a language switch inside a running app
 * either does nothing or drops the customer back at the splash screen with
 * their basket gone. Instead every screen lays out from `dir`, which is plain
 * React state and flips instantly: rows read `flexDirection: row-reverse`,
 * text carries `writingDirection`, and `start`/`end` helpers replace left and
 * right. React Native supports row-reverse and writingDirection on every
 * platform this app targets.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { TextStyle, ViewStyle } from 'react-native';

export type Lang = 'ar' | 'en';

const COPY = {
  ar: {
    brand: 'سبورتا',
    tagline: 'ملابس رياضية للكويت',
    tabs: { home: 'الرئيسية', shop: 'المتجر', cart: 'السلة', account: 'حسابي' },
    home: {
      heroKicker: 'وصل حديثاً',
      heroTitle: 'تدرّب بثقة',
      heroText: 'ملابس وأحذية رياضية مختارة، تُوصل في الكويت خلال يوم إلى ثلاثة أيام.',
      shopNow: 'تسوّق الآن',
      categories: 'تسوّق حسب الفئة',
      featured: 'الأكثر مبيعاً',
      brands: 'الماركات',
    },
    shop: {
      title: 'المتجر',
      all: 'الكل',
      empty: 'لا توجد منتجات مطابقة.',
      results: (n: string, _one: boolean) => `${n} منتج`,
      sort: 'ترتيب',
      sortNew: 'الأحدث',
      sortLow: 'السعر: من الأقل',
      sortHigh: 'السعر: من الأعلى',
    },
    product: {
      size: 'المقاس',
      sizeGuide: 'دليل المقاسات',
      pickSize: 'اختر المقاس أولاً',
      add: 'أضف إلى السلة',
      added: 'أُضيف إلى السلة',
      soldOut: 'نفدت الكمية',
      badgeNew: 'جديد',
      badgeLow: 'الكمية محدودة',
      lastOne: 'قطعة واحدة متبقية',
      lowStock: (n: string) => `بقي ${n} قطع فقط`,
      was: 'بدلاً من',
      save: (p: string) => `وفّر ${p}٪`,
      details: 'التفاصيل',
      delivery: 'التوصيل خلال ١-٣ أيام داخل الكويت',
      returns: 'إرجاع مجاني خلال ٧ أيام',
    },
    cart: {
      title: 'السلة',
      empty: 'سلتك فارغة',
      emptyText: 'أضف قطعة وستظهر هنا.',
      browse: 'تصفّح المتجر',
      subtotal: 'المجموع',
      delivery: 'التوصيل',
      free: 'مجاني',
      total: 'الإجمالي',
      checkout: 'إتمام الطلب',
      remove: 'إزالة',
      capped: 'هذا كل المتوفر بالمخزون',
      freeOver: (a: string) => `توصيل مجاني للطلبات فوق ${a}`,
    },
    checkout: {
      title: 'إتمام الطلب',
      name: 'الاسم',
      phone: 'رقم الهاتف',
      email: 'البريد الإلكتروني',
      governorate: 'المحافظة',
      area: 'المنطقة',
      block: 'القطعة',
      street: 'الشارع',
      house: 'المنزل / الشقة',
      notes: 'ملاحظات للسائق (اختياري)',
      payment: 'طريقة الدفع',
      knet: 'كي نت',
      // بطاقات فيزا وماستركارد عبر خدمة تي-باي من البنك التجاري الكويتي.
      tpay: 'بطاقة (تي-باي)',
      cod: 'الدفع عند الاستلام',
      place: 'تأكيد الطلب',
      pay: 'ادفع الآن',
      working: 'جاري التحويل…',
      required: 'هذا الحقل مطلوب',
      badPhone: 'أدخل رقم كويتي من ٨ أرقام',
    },
    order: {
      title: 'تم الطلب',
      thanks: 'شكراً لك',
      ref: 'رقم الطلب',
      willCall: 'سنتواصل معك لتأكيد التوصيل.',
      home: 'العودة للرئيسية',
      // بعد العودة من صفحة البنك. الدفع لم يُلغَ — البنك قد يتأخر في الرد.
      paid: 'تم استلام الدفعة',
      pending: 'لم يصلنا تأكيد الدفع بعد',
      pendingText: 'إذا كنت قد أتممت الدفع فسيصلك التأكيد خلال دقائق. طلبك محفوظ برقمه أعلاه.',
      retry: 'إعادة محاولة الدفع',
    },
    exchange: {
      title: 'استبدال أو إرجاع',
      lede: 'أدخل رقم طلبك ورقم هاتفك، وسنعرض لك القطع التي اشتريتها لتختار منها. الاستلام من عندك.',
      ref: 'رقم الطلب',
      phone: 'رقم الهاتف',
      hint: 'نفس الرقم الذي طلبت به. تجد رقم الطلب في رسالة التأكيد أو على الفاتورة.',
      find: 'عرض قطع الطلب',
      finding: 'جارٍ البحث…',
      pick: 'اختر القطع',
      kindExchange: 'استبدال',
      kindExchangeSub: 'مقاس آخر',
      kindReturn: 'إرجاع',
      kindReturnSub: 'استرجاع المبلغ',
      sameSize: 'نفس المقاس',
      wantSize: 'المقاس المطلوب',
      reason: 'السبب',
      reasonHint: 'المقاس غير مناسب / القطعة تالفة / الجودة غير متوقعة',
      send: 'إرسال الطلب',
      sending: 'جارٍ الإرسال…',
      daysLeft: 'باقي {n} يوم على انتهاء مدة الإرجاع.',
      closed: 'انتهت مدة الأربعة عشر يومًا لهذا الطلب.',
      already: 'لديك طلب سابق على هذه الفاتورة: {refs}.',
      spent: 'مطلوبة بالفعل في طلب سابق.',
      noExchange: 'الملابس النسائية غير قابلة للاستبدال — يمكنك إرجاعها.',
      pickOne: 'اختر قطعة واحدة على الأقل.',
      done: 'وصلنا طلبك',
      doneRef: 'رقم الطلب — احتفظ به، وسيسألك عنه المندوب.',
      doneNote: 'سنتواصل معك لتحديد موعد الاستلام. القطع يجب أن تكون غير ملبوسة وغير مغسولة مع البطاقات الأصلية.',
      another: 'طلب آخر',
      // كل رفض يمكن أن يرده الخادم، بالعربية. رمز الخطأ لا يُعرض للعميل أبداً.
      errors: {
        invalid_phone: 'رقم الهاتف غير صحيح. أدخله بالأرقام فقط، مثل ٥٥٥١٢٣٤٥.',
        return_not_found: 'لم نجد طلبًا بهذا الرقم لهذا الهاتف. تأكد من الرقمين.',
        return_not_paid: 'هذا الطلب غير مدفوع، فلا يوجد ما يُرجَع منه.',
        return_cancelled: 'هذا الطلب ملغى.',
        return_window_closed: 'انتهت مدة الأربعة عشر يومًا لهذا الطلب. تواصل معنا وسننظر في الأمر.',
        return_no_items: 'اختر قطعة واحدة على الأقل.',
        return_qty: 'العدد المطلوب أكبر من المتاح.',
        return_size: 'المقاس المطلوب غير متاح.',
        return_no_exchange: 'الملابس النسائية غير قابلة للاستبدال. يمكنك طلب الإرجاع بدلًا من ذلك.',
        too_many_attempts: 'محاولات كثيرة خلال وقت قصير. انتظر دقيقة ثم أعد المحاولة.',
        failed: 'تعذّر إتمام الطلب الآن. حاول مرة أخرى بعد قليل.',
      },
    },
    account: {
      title: 'حسابي',
      language: 'اللغة',
      arabic: 'العربية',
      english: 'English',
      orders: 'طلباتي',
      noOrders: 'لا توجد طلبات بعد.',
      wallet: 'بطاقة الولاء',
      walletAdd: 'أضِف إلى Apple Wallet',
      walletWhat: 'اعرض البطاقة عند الدفع لتجميع النقاط.',
      contact: 'تواصل معنا',
      whatsapp: 'واتساب',
      about: 'عن سبورتا',
      aboutText:
        'سبورتا متجر كويتي للملابس الرياضية. نختار قطعاً تتحمل التمرين والحرارة، ونوصلها بسرعة.',
      offline: 'يعرض التطبيق الكتالوج المحفوظ — تعذّر الوصول للمتجر.',
    },
  },
  en: {
    brand: 'SPORTA',
    tagline: 'Sportswear for Kuwait',
    tabs: { home: 'Home', shop: 'Shop', cart: 'Cart', account: 'Account' },
    home: {
      heroKicker: 'New arrivals',
      heroTitle: 'Train with confidence',
      heroText: 'Chosen sportswear and shoes, delivered across Kuwait in one to three days.',
      shopNow: 'Shop now',
      categories: 'Shop by category',
      featured: 'Best sellers',
      brands: 'Brands',
    },
    shop: {
      title: 'Shop',
      all: 'All',
      empty: 'Nothing matches that.',
      results: (n: string, one: boolean) => `${n} product${one ? '' : 's'}`,
      sort: 'Sort',
      sortNew: 'Newest',
      sortLow: 'Price: low to high',
      sortHigh: 'Price: high to low',
    },
    product: {
      size: 'Size',
      sizeGuide: 'Size guide',
      pickSize: 'Choose a size first',
      add: 'Add to cart',
      added: 'Added to cart',
      soldOut: 'Sold out',
      badgeNew: 'New',
      badgeLow: 'Almost gone',
      lastOne: 'Last one left',
      lowStock: (n: string) => `Only ${n} left`,
      was: 'Was',
      save: (p: string) => `Save ${p}%`,
      details: 'Details',
      delivery: 'Delivery in 1–3 days across Kuwait',
      returns: 'Free returns within 7 days',
    },
    cart: {
      title: 'Cart',
      empty: 'Your cart is empty',
      emptyText: 'Add something and it will show up here.',
      browse: 'Browse the shop',
      subtotal: 'Subtotal',
      delivery: 'Delivery',
      free: 'Free',
      total: 'Total',
      checkout: 'Checkout',
      remove: 'Remove',
      capped: "That's all we have in stock",
      freeOver: (a: string) => `Free delivery over ${a}`,
    },
    checkout: {
      title: 'Checkout',
      name: 'Name',
      phone: 'Phone',
      email: 'Email',
      governorate: 'Governorate',
      area: 'Area',
      block: 'Block',
      street: 'Street',
      house: 'House / flat',
      notes: 'Notes for the driver (optional)',
      payment: 'Payment',
      knet: 'KNET',
      /** Visa and Mastercard, through the Commercial Bank of Kuwait's T-Pay. */
      tpay: 'Card (T-Pay)',
      cod: 'Cash on delivery',
      place: 'Place order',
      pay: 'Pay now',
      working: 'Redirecting…',
      required: 'This field is required',
      badPhone: 'Enter an 8-digit Kuwaiti number',
    },
    order: {
      title: 'Order placed',
      thanks: 'Thank you',
      ref: 'Order number',
      willCall: "We'll call you to confirm delivery.",
      home: 'Back to home',
      paid: 'Payment received',
      pending: 'No payment confirmation yet',
      pendingText:
        'If you completed the payment, confirmation usually arrives within a few minutes. Your order is saved under the number above.',
      retry: 'Try the payment again',
    },
    exchange: {
      title: 'Exchange or return',
      lede: "Enter your order number and phone, and we'll show you what you bought. We collect from you.",
      ref: 'Order number',
      phone: 'Phone number',
      hint: 'The same number you ordered with. The order number is on your confirmation and your invoice.',
      find: 'Show my items',
      finding: 'Looking…',
      pick: 'Choose the items',
      kindExchange: 'Exchange',
      kindExchangeSub: 'a different size',
      kindReturn: 'Return',
      kindReturnSub: 'money back',
      sameSize: 'Same size',
      wantSize: 'Size wanted',
      reason: 'Reason',
      reasonHint: "Wrong size / damaged / not the quality expected",
      send: 'Send the request',
      sending: 'Sending…',
      daysLeft: '{n} days left to return this order.',
      closed: 'The fourteen days for this order have passed.',
      already: 'You already have a request on this order: {refs}.',
      spent: 'Already asked for on an earlier request.',
      noExchange: "Women's clothing cannot be exchanged — you can return it.",
      pickOne: 'Choose at least one item.',
      done: "We've got your request",
      doneRef: 'Keep this number — the driver will ask for it.',
      doneNote: "We'll be in touch to arrange collection. Items must be unworn, unwashed, with the original tags.",
      another: 'Another request',
      errors: {
        invalid_phone: 'That phone number is not right. Digits only, like 55512345.',
        return_not_found: 'We could not find an order with that number for that phone. Check both.',
        return_not_paid: 'That order is unpaid, so there is nothing to return from it.',
        return_cancelled: 'That order was cancelled.',
        return_window_closed: 'The fourteen days for this order have passed. Get in touch and we will look at it.',
        return_no_items: 'Choose at least one item.',
        return_qty: 'That is more than is available.',
        return_size: 'That size is not available.',
        return_no_exchange: "Women's clothing cannot be exchanged. You can ask to return it instead.",
        too_many_attempts: 'Too many tries in a short time. Wait a minute and try again.',
        failed: 'We could not complete that just now. Try again shortly.',
      },
    },
    account: {
      title: 'Account',
      language: 'Language',
      arabic: 'العربية',
      english: 'English',
      orders: 'My orders',
      noOrders: 'No orders yet.',
      wallet: 'Loyalty card',
      walletAdd: 'Add to Apple Wallet',
      walletWhat: 'Show it at checkout to collect points.',
      contact: 'Contact us',
      whatsapp: 'WhatsApp',
      about: 'About Sporta',
      aboutText:
        'Sporta is a Kuwaiti sportswear shop. We pick pieces that survive the gym and the heat, and we deliver them quickly.',
      offline: 'Showing the bundled catalogue — the shop could not be reached.',
    },
  },
} as const;

export type Copy = (typeof COPY)['en'];

type Ctx = {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  t: Copy;
  setLang: (l: Lang) => void;
  /** `row` in English, `row-reverse` in Arabic. */
  row: ViewStyle;
  /** Text alignment and direction for the current language. */
  text: TextStyle;
};

const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ar');
  const setLang = useCallback((l: Lang) => setLangState(l), []);

  const value = useMemo<Ctx>(() => {
    const rtl = lang === 'ar';
    return {
      lang,
      dir: rtl ? 'rtl' : 'ltr',
      // The cast is the price of a frozen `as const` copy table: the two
      // language objects have identical shapes, which TypeScript checks at the
      // point COPY is written, but their literal types differ.
      t: COPY[lang] as unknown as Copy,
      setLang,
      row: { flexDirection: rtl ? 'row-reverse' : 'row' },
      text: { writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' },
    };
  }, [lang, setLang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLang(): Ctx {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLang must be used inside <LanguageProvider>');
  return ctx;
}
