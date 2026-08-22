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
      card: 'بطاقة',
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
    },
    account: {
      title: 'حسابي',
      language: 'اللغة',
      arabic: 'العربية',
      english: 'English',
      orders: 'طلباتي',
      noOrders: 'لا توجد طلبات بعد.',
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
      card: 'Card',
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
    },
    account: {
      title: 'Account',
      language: 'Language',
      arabic: 'العربية',
      english: 'English',
      orders: 'My orders',
      noOrders: 'No orders yet.',
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
