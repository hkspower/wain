import 'package:flutter/widgets.dart';

/// Minimal bilingual strings (AR/EN). Arabic is the primary market language.
class L {
  final String lang;
  const L(this.lang);

  static L of(BuildContext c) =>
      L(Localizations.localeOf(c).languageCode == 'ar' ? 'ar' : 'en');

  bool get isAr => lang == 'ar';
  String _(String en, String ar) => isAr ? ar : en;

  String get appName => _('Sporta', 'سبورتا');
  String get home => _('Home', 'الرئيسية');
  String get shop => _('Shop', 'المتجر');
  String get bag => _('Bag', 'الحقيبة');
  String get add => _('Add', 'أضف');
  String get buyNow => _('Buy now', 'اشترِ الآن');
  String get total => _('Total', 'الإجمالي');
  String get checkout => _('Checkout', 'إتمام الشراء');
  String get emptyBag => _('Your bag is empty.', 'حقيبتك فارغة.');
  String get backToShop => _('Back to shop', 'العودة للمتجر');
  String get size => _('Size', 'المقاس');
  String get pickSize => _('Please choose a size', 'الرجاء اختيار المقاس');
  String get heroKicker => _('Pro performance', 'أداءُ المحترفين');
  String get heroLine1 => _('Lift.', 'ارفع.');
  String get heroLine2 => _('Ignite.', 'اشتعل.');
  String get heroSub => _('Built for those who accept nothing less than the best.',
      'مصمَّمة لمن لا يقبل بأقل من الأفضل.');
  String get shopCollection => _('Shop the collection', 'تسوّق المجموعة');
  String get essentials => _('Shop the essentials', 'تسوق الأساسيات');
  String get delivery => _('Same-day delivery in Kuwait', 'توصيل في نفس اليوم داخل الكويت');
  String get securePay => _('Secure checkout — KNET, Visa, Mastercard', 'دفع آمن — كي نت، فيزا، ماستركارد');
  String get returns => _('Free 14-day returns', 'إرجاع مجاني خلال ١٤ يوم');
  String get orderPlaced => _('Order created', 'تم إنشاء الطلب');
  String get payNow => _('Pay with KNET', 'ادفع عبر كي نت');
  String get paid => _('Paid', 'مدفوع');
  String get pending => _('Pending payment', 'بانتظار الدفع');
  String get failed => _('Payment failed', 'فشل الدفع');
  String get checkStatus => _('Check payment status', 'تحقق من حالة الدفع');
  String get errorGeneric => _('Something went wrong. Please try again.', 'حدث خطأ. حاول مرة أخرى.');
  String get all => _('All', 'الكل');
  String kwd(num v) => isAr ? '${v.toStringAsFixed(3)} د.ك' : '${v.toStringAsFixed(3)} KWD';
}
