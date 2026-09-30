import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/layout.dart';
import '../widgets/svg.dart';

/// الخصوصية — written for THIS app, not copied from the site's page. The
/// site's talks about cookies, a sandboxed map frame, browser speech
/// recognition and Local Storage, none of which are what happens here; and
/// what the app does (WebRTC to ElevenLabs, tile requests from a native map,
/// a share sheet, platform permissions) the site's page could not describe.
/// A privacy page that overstates is the same defect as one that denies.
class PrivacyScreen extends StatelessWidget {
  const PrivacyScreen({super.key});

  static const noTracking = [
    'ما عندنا حساب لك — ما فيه تسجيل دخول.',
    'ما نستخدم Google Analytics ولا أي أداة تحليلات أو تتبّع.',
    'ما فيه إعلانات ولا بكسل إعلاني ولا أدوات تتبّع من شبكات التواصل.',
    'ما نجمع معرّف جهازك ولا نبيع أو نشارك أي بيانات عنك.',
  ];

  static const sections = <(String, List<String>)>[
    (
      'موقعك',
      [
        'التطبيق ما يطلب موقعك ولا يقراه — أبداً. زر «إلى وين؟» يفتح صفحة الاختيار بس، وما يدوّر حسب مكانك. '
            'وعشان جذي ما فيه إذن موقع في التطبيق أصلاً.',
      ],
    ),
    (
      'الخريطة',
      [
        'الخرائط من OpenStreetMap — مشروع خرائط مفتوح، مو شركة إعلانات. لمّا تفتح خريطة، التطبيق يطلب '
            'مربعات الخريطة (tiles) من خوادمهم مباشرة، فيشوفون عنوان الـ IP حقك والمنطقة اللي تتفرج عليها '
            '— وهي بحكم الحال في الكويت — وتنطبق سياسة الخصوصية الخاصة فيهم. ما نرسل لهم اسمك ولا بحثك.',
      ],
    ),
    (
      'وين AI — شوق',
      [
        'شوق ما تشتغل إلا إذا اتصلت فيها أنت، بالضغط على زر الاتصال، وتقدر تنهي المكالمة في أي وقت. '
            'قبل جذي ما يصير أي اتصال بخدمتها.',
        'المايك ما يشتغل إلا بعد ما تعطي الإذن. وخلال المكالمة صوتك يتنقل مباشرة لخدمة '
            'ElevenLabs عشان تسمعك وترد عليك، وتنطبق سياسة الخصوصية الخاصة فيهم. ما نسجّل المكالمة عندنا، '
            'ولا نخزّن صوتك.',
        'المحادثة المكتوبة نفس الشي: الرسائل اللي تكتبها تروح لنفس الخدمة عشان تجاوبك.',
        'وإذا قالت لك «دوّرت لك» أو فتحت لك مكان، هذي أوامر تنفّذها داخل التطبيق على جهازك — البحث نفسه يصير عندك.',
      ],
    ),
    (
      'صوت وين — الاقتراح الصوتي',
      [
        'الاقتراح الصوتي مطفّى لين تشغّله. اختيارك (تشغيل وصوت شوق أو سالم) ينحفظ داخل جهازك بس، '
            'وما ينرسل لأي خادم ولا يُستخدم للتتبّع.',
        'الجُمل اللي ما لها مقطع جاهز ممكن تنرسل — الجملة نفسها بس، بدون اسمك ولا أي شي يعرّفك — لخادم '
            'وين وبعدها لخدمة النطق عشان ترجع صوتاً. وإذا ما كان النطق على الخادم مشغّل، يستخدم جهازك '
            'صوته العربي الداخلي وما يطلع شي.',
      ],
    ),
    (
      'رسّلها للربع',
      [
        'الرسالة تتكوّن على جهازك وتنعطى للتطبيق اللي تختاره (واتساب وغيره) من قائمة المشاركة. '
            'ما نستلم شي منها ولا نخزّنها، وما فيه طرف ثالث بينك وبين الجروب.',
      ],
    ),
    (
      'الاستضافة',
      [
        'وين ما عنده حسابات للزوار، وتقدر تتصفّح كل الأماكن وتدوّر بدون ما تعطينا ولا معلومة. '
            'الخادم الوحيد اللي يتكلم معه التطبيق من طرفنا هو خادم النطق (فوق).',
        'وهذا الخادم يكتب سطر تقني لكل طلب — الوقت، وش صار، حجم الرد — بدون نص الجملة '
            'وبدون عنوان الـ IP حقك (ينختصر لبصمة ما ترجع لأصلها). الملف له سقف ثابت ويدوّر على نفسه.',
      ],
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final body = wainText(WainText.sm, color: WainColors.ink600, height: 1.85);
    return ListView(
      children: [
        PageColumn(
          maxWidth: 768,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Semantics(
                header: true,
                child: Text(
                  'الخصوصية',
                  style: wainText(
                    WainText.s4xl,
                    weight: FontWeight.w700,
                    color: WainColors.ink900,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text.rich(
                TextSpan(
                  style: wainText(
                    WainText.lg,
                    color: WainColors.ink600,
                    height: 1.75,
                  ),
                  children: [
                    const TextSpan(text: 'باختصار: '),
                    TextSpan(
                      text: 'وين ما يتتبّعك',
                      style: wainText(
                        WainText.lg,
                        weight: FontWeight.w700,
                        color: WainColors.ink900,
                        height: 1.75,
                      ),
                    ),
                    const TextSpan(
                      text: '، وما عنده حساب لك. هذي الصفحة تشرح الوضع بالتفصيل — بما فيه الأشياء اللي تطلع من جهازك.',
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 32),
              Container(
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: WainColors.palm500.withValues(alpha: 0.05),
                  borderRadius: BorderRadius.circular(WainRadius.s3xl),
                  border: Border.all(
                    color: WainColors.palm500.withValues(alpha: 0.25),
                  ),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'ما نتتبّعك — أبداً',
                      style: wainText(
                        WainText.xl,
                        weight: FontWeight.w600,
                        color: WainColors.ink900,
                      ),
                    ),
                    const SizedBox(height: 14),
                    for (final item in noTracking)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Padding(
                              padding: const EdgeInsets.only(top: 3),
                              child: WainSvg.icon(
                                'check',
                                size: 16,
                                color: WainColors.palm600,
                              ),
                            ),
                            const SizedBox(width: 10),
                            Expanded(child: Text(item, style: body)),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              for (final (title, paras) in sections)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Panel(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Semantics(
                          header: true,
                          child: Text(
                            title,
                            style: wainText(
                              WainText.xl,
                              weight: FontWeight.w600,
                              color: WainColors.ink900,
                            ),
                          ),
                        ),
                        for (final p in paras)
                          Padding(
                            padding: const EdgeInsets.only(top: 12),
                            child: Text(p, style: body),
                          ),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: 32),
              Center(
                child: FilledButton(
                  onPressed: () => context.go('/explore'),
                  style: FilledButton.styleFrom(
                    backgroundColor: WainColors.ink900,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 24,
                      vertical: 12,
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'رجوع للأماكن',
                        style: wainText(
                          WainText.lg,
                          weight: FontWeight.w600,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(width: 8),
                      WainSvg.icon('go', size: 20, color: Colors.white),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ],
    );
  }
}
