import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../data/places.g.dart';
import '../data/text_kit.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/layout.dart';
import '../widgets/svg.dart';

/// عن وين. Copy is the site's; the third card differs on purpose. The site's
/// says «نرتّب الأماكن حسب قربها من موقعك» — true once, and not true of this
/// app, which never reads your position — so it names what the app does do.
class AboutScreen extends StatelessWidget {
  const AboutScreen({super.key});

  static const _cards = [
    (
      'pinsolid',
      WainColors.coral50,
      WainColors.coral600,
      'من أهل الديرة',
      'مختارة من ناس عايشين هني فعلاً.',
    ),
    (
      'sparkle',
      WainColors.sun50,
      WainColors.sun700,
      'كيف مو كم',
      'كل مكان يستاهل مكانه بالقائمة.',
    ),
    (
      'send',
      WainColors.sea50,
      WainColors.sea700,
      'رسّلها للربع',
      'المكان بالوقت والموقع، جاهز للجروب.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final body = wainText(WainText.lg, color: WainColors.ink600, height: 1.75);
    final strong = wainText(
      WainText.lg,
      weight: FontWeight.w700,
      color: WainColors.ink900,
      height: 1.75,
    );
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
                  'وين؟ شنو هذا',
                  style: wainText(
                    WainText.s4xl,
                    weight: FontWeight.w700,
                    color: WainColors.ink900,
                  ),
                ),
              ),
              const SizedBox(height: 24),
              Text.rich(
                TextSpan(
                  style: body,
                  children: [
                    TextSpan(text: 'وين', style: strong),
                    const TextSpan(
                      text: ' كلمة نقولها كل يوم — في جروب العايلة، في جروب الربع، كل خميس من زمان: ',
                    ),
                    TextSpan(
                      text: 'وين الطلعة اليوم؟',
                      style: strong.copyWith(color: WainColors.coral700),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              Text(
                'وين يجاوب على هذا السؤال. دليل مختار لأحلى ما في الكويت — المعالم، الأسواق اللي ريحتها هيل '
                'وزعفران، البحر، المتاحف، المولات، والأماكن اللي ما يعرفها إلا أهل الديرة.',
                style: body,
              ),
              const SizedBox(height: 20),
              Text(
                'كل مكان عندنا فيه أبرز ما يميّزه، وأحسن وقت تروح فيه، وكم بيكلّفك — عشان آخر شي يتناقشون '
                'فيه بالجروب يكون منو بيسوق.',
                style: body,
              ),
              const SizedBox(height: 32),
              for (final (icon, bg, fg, title, text) in _cards)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Panel(
                    padding: const EdgeInsets.all(20),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 40,
                          height: 40,
                          decoration: BoxDecoration(
                            color: bg,
                            borderRadius: BorderRadius.circular(
                              WainRadius.s2xl,
                            ),
                          ),
                          child: Center(
                            child: WainSvg.icon(icon, size: 20, color: fg),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                title,
                                style: wainText(
                                  WainText.lg,
                                  weight: FontWeight.w600,
                                  color: WainColors.ink900,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                text,
                                style: wainText(
                                  WainText.sm,
                                  color: WainColors.ink500,
                                  height: 1.6,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              const SizedBox(height: 20),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(24),
                decoration: BoxDecoration(
                  color: WainColors.sea700,
                  borderRadius: BorderRadius.circular(WainRadius.s3xl),
                  boxShadow: WainShadows.md,
                ),
                child: Column(
                  children: [
                    Text(
                      '${countAr(kPlaces.length, kPlacesCount)} جاهز لك',
                      textAlign: TextAlign.center,
                      style: wainText(
                        WainText.s2xl,
                        weight: FontWeight.w700,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'من أبراج الكويت لين مقاهي المباركية.',
                      style: wainText(WainText.sm, color: WainColors.sea100),
                    ),
                  ],
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
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(WainRadius.s2xl),
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'يالله نبدأ',
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
              const SizedBox(height: 32),
              const Divider(color: WainColors.line),
              Wrap(
                alignment: WrapAlignment.center,
                spacing: 24,
                children: [
                  TextButton(
                    onPressed: () => context.push('/add'),
                    child: const Text('سجّل مكانك — مجاناً'),
                  ),
                  TextButton(
                    onPressed: () => context.push('/privacy'),
                    child: const Text('الخصوصية'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
