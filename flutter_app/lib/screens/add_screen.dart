import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/layout.dart';
import '../widgets/svg.dart';

/// سجّل مكانك. The site's registration form posts to a database that is not
/// connected yet, and says so in its own notice. This screen says the same
/// rather than present a form whose button does nothing — a native app that
/// accepted a business's details and quietly dropped them would be worse than
/// one that says «not yet».
class AddScreen extends StatelessWidget {
  const AddScreen({super.key});

  static const promises = [
    'مجاناً بالكامل — ما نطلب رسوم ولا اشتراك.',
    'بدون حساب، وتكتب أربع خانات بس — الباقي اختياري ونكمّله إحنا.',
    'مكانك يطلع في البحث وعلى الخريطة مثل باقي الأماكن.',
  ];

  @override
  Widget build(BuildContext context) {
    return ListView(
      children: [
        PageColumn(
          maxWidth: 768,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: WainColors.palm500.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Text(
                  'مجاناً',
                  style: wainText(
                    WainText.xs,
                    weight: FontWeight.w600,
                    color: WainColors.palm700,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Semantics(
                header: true,
                child: Text(
                  'سجّل مكانك في وين',
                  style: wainText(
                    WainText.s4xl,
                    weight: FontWeight.w700,
                    color: WainColors.ink900,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'عندك مطعم أو كافيه أو محل في الكويت؟ ضيفه على خريطة وين ووصّله للناس اللي يسألون «وين نروح اليوم؟».',
                style: wainText(
                  WainText.base,
                  color: WainColors.ink500,
                  height: 1.7,
                ),
              ),
              const SizedBox(height: 16),
              for (final p in promises)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
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
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          p,
                          style: wainText(
                            WainText.sm,
                            color: WainColors.ink600,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 16),
              Container(
                key: const ValueKey('add-notice'),
                width: double.infinity,
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 12,
                ),
                decoration: BoxDecoration(
                  color: WainColors.sun50,
                  borderRadius: BorderRadius.circular(WainRadius.s2xl),
                  border: Border.all(color: WainColors.sun300),
                ),
                child: Text(
                  'التسجيل مو موصول بقاعدة البيانات بعد، فما نقدر نستقبل طلبك من التطبيق الحين.',
                  style: wainText(
                    WainText.sm,
                    weight: FontWeight.w600,
                    color: WainColors.sun900,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: () => launchUrl(
                  Uri.parse('https://www.wainkw.com/add/'),
                  mode: LaunchMode.externalApplication,
                ),
                child: const Text('افتح صفحة التسجيل في الموقع'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
