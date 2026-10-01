import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../data/catalogue.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/layout.dart';
import '../widgets/place_card.dart';
import '../widgets/svg.dart';

/// Home: the skyline hero with the «إلى وين؟» dial, the featured places, how
/// it works, and the call to explore. The skyline is drawn at its own
/// 1200:530 and never cropped; the dial is one navigation, to /find, which
/// asks how you want to search before showing anything.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: EdgeInsets.zero,
      children: const [_Hero(), _Featured(), _HowItWorks(), _Cta()],
    );
  }
}

class _Hero extends StatelessWidget {
  const _Hero();

  @override
  Widget build(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    final skyline = w * 530 / 1200;
    final dial = math.min(288.0, w - 56);
    return Container(
      color: Colors.white,
      child: Stack(
        children: [
          // The drawing sits on the section's floor at its natural ratio.
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: IgnorePointer(
              child: WainSvg(
                'assets/art/skyline.svg',
                width: w,
                height: skyline,
                fit: BoxFit.fitWidth,
                alignment: Alignment.bottomCenter,
              ),
            ),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(10, 8, 10, skyline * 0.92),
            child: Column(
              children: [
                const _Wordmark(),
                const SizedBox(height: 28),
                // No «دوّر باسم المكان» under the dial here: the app's tab
                // bar has a search tab, so it was the same offer twice. The
                // website keeps it — in a browser it is the page's one way
                // to /search — and hides it in its installed mode too.
                _Dial(size: dial),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Wordmark extends StatelessWidget {
  const _Wordmark();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Stack(
          clipBehavior: Clip.none,
          children: [
            Text(
              'وين',
              semanticsLabel: 'وين',
              style: wainText(
                WainText.s5xl,
                weight: FontWeight.w700,
                color: WainColors.ink900,
              ),
            ),
            PositionedDirectional(
              start: -28,
              top: -8,
              child: WainSvg.icon(
                'pinsolid',
                size: 36,
                color: WainColors.coral600,
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          'وين الطلعة اليوم؟',
          style: wainText(
            WainText.s2xl,
            weight: FontWeight.w700,
            color: WainColors.coral600,
          ),
        ),
      ],
    );
  }
}

class _Dial extends StatefulWidget {
  final double size;
  const _Dial({required this.size});

  @override
  State<_Dial> createState() => _DialState();
}

class _DialState extends State<_Dial> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2400),
  )..repeat();

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.size;
    return SizedBox(
      width: s + 32,
      height: s + 32,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // The pulse: a ring that swells and fades, unless motion is reduced.
          if (!MediaQuery.disableAnimationsOf(context))
            AnimatedBuilder(
              animation: _pulse,
              builder: (_, _) => Container(
                width: s * (1 + 0.12 * _pulse.value),
                height: s * (1 + 0.12 * _pulse.value),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: WainColors.sun300.withValues(
                    alpha: 0.6 * (1 - _pulse.value),
                  ),
                ),
              ),
            ),
          CustomPaint(size: Size(s + 32, s + 32), painter: _TickRing()),
          Semantics(
            button: true,
            label: 'إلى وين؟ — اكتب أو كلّم شوق',
            child: GestureDetector(
              onTap: () => context.push('/find'),
              child: Container(
                width: s,
                height: s,
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 24),
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  border: Border.all(color: Colors.white, width: 6),
                  gradient: const LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [WainColors.sun200, WainColors.sun400],
                  ),
                  boxShadow: const [
                    BoxShadow(
                      color: Color(0x8CB4780A),
                      blurRadius: 40,
                      spreadRadius: -12,
                      offset: Offset(0, 18),
                    ),
                  ],
                ),
                child: ExcludeSemantics(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'إلى وين؟',
                        style: wainText(
                          WainText.s3xl,
                          weight: FontWeight.w700,
                          color: WainColors.ink900,
                        ),
                      ),
                      // The question and one thing to do, as on the web
                      // (NearbyDial): «اضغط ودوّر حواليك» stopped being true
                      // when the dial stopped ranking places around you, and
                      // what the tap leads to is in the label above.
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 24,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          color: WainColors.ink900,
                          borderRadius: BorderRadius.circular(99),
                        ),
                        child: Text(
                          'ابدأ',
                          style: wainText(
                            WainText.sm,
                            weight: FontWeight.w600,
                            color: WainColors.sun100,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The compass tick ring around the dial: 36 ticks, every ninth a major one.
class _TickRing extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final c = size.center(Offset.zero);
    final unit = size.width / 100;
    for (var i = 0; i < 36; i++) {
      final a = i * 10 * math.pi / 180;
      final major = i % 9 == 0;
      final r1 = (major ? 44.5 : 46.5) * unit;
      final r2 = 48 * unit;
      canvas.drawLine(
        c + Offset(math.cos(a) * r1, math.sin(a) * r1),
        c + Offset(math.cos(a) * r2, math.sin(a) * r2),
        Paint()
          ..color = WainColors.sun600.withValues(alpha: 0.5)
          ..strokeWidth = (major ? 1.6 : 0.9) * unit
          ..strokeCap = StrokeCap.round,
      );
    }
  }

  @override
  bool shouldRepaint(_TickRing old) => false;
}

class _Featured extends StatelessWidget {
  const _Featured();

  @override
  Widget build(BuildContext context) {
    final featured = featuredPlaces();
    return Container(
      color: WainColors.sand50,
      padding: pageGutter(context),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: AlignmentDirectional.centerEnd,
            child: TextButton(
              onPressed: () => context.go('/explore'),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'شوف الكل',
                    style: wainText(
                      WainText.sm,
                      weight: FontWeight.w600,
                      color: WainColors.coral700,
                    ),
                  ),
                  const SizedBox(width: 6),
                  WainSvg.icon('go', size: 16, color: WainColors.coral700),
                ],
              ),
            ),
          ),
          // A rail on a phone — one card and a half, the shape that says «there
          // are more sideways» — at the cost of one card's height, not six.
          SizedBox(
            height: 190,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: featured.length,
              separatorBuilder: (_, _) => const SizedBox(width: 16),
              itemBuilder: (_, i) =>
                  SizedBox(width: 256, child: PlaceCard(place: featured[i])),
            ),
          ),
        ],
      ),
    );
  }
}

class _HowItWorks extends StatelessWidget {
  const _HowItWorks();

  static const _steps = [
    (
      '١',
      'compass',
      'قول وين تبي',
      'اضغط على «إلى وين؟» واختر: تكتب اسم المكان أو تكلّم شوق.',
    ),
    (
      '٢',
      'sparkle',
      'اختر الجو',
      'معالم، مطاعم، قهوة، بحر أو أسواق — كل وحدة ولها وقتها.',
    ),
    (
      '٣',
      'car',
      'يالله نروح',
      'رسّلها للربع بالوقت والموقع — ما بقى شي يتناقش فيه.',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      color: WainColors.sand100,
      padding: pageGutter(context),
      child: Column(
        children: [
          Text(
            'كيف يشتغل وين؟',
            style: wainText(
              WainText.s2xl,
              weight: FontWeight.w700,
              color: WainColors.ink900,
            ),
          ),
          const SizedBox(height: 14),
          Panel(
            padding: EdgeInsets.zero,
            child: Column(
              children: [
                for (var i = 0; i < _steps.length; i++) ...[
                  if (i > 0) const Divider(height: 1, color: WainColors.line),
                  Padding(
                    padding: const EdgeInsets.all(14),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(
                              WainRadius.s2xl,
                            ),
                            gradient: const LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [
                                WainColors.coral500,
                                WainColors.coral700,
                              ],
                            ),
                          ),
                          child: WainSvg.icon(
                            _steps[i].$2,
                            size: 24,
                            color: Colors.white,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text.rich(
                                TextSpan(
                                  children: [
                                    TextSpan(
                                      text: _steps[i].$1,
                                      style: wainText(
                                        WainText.sm,
                                        weight: FontWeight.w600,
                                        color: WainColors.sand700,
                                      ),
                                    ),
                                    TextSpan(
                                      text: ' · ${_steps[i].$3}',
                                      style: wainText(
                                        WainText.lg,
                                        weight: FontWeight.w600,
                                        color: WainColors.ink900,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                _steps[i].$4,
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
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Cta extends StatelessWidget {
  const _Cta();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: pageGutter(context).copyWith(bottom: 16),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 28),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(WainRadius.s3xl),
          gradient: const LinearGradient(
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
            colors: [WainColors.sea800, WainColors.sea600],
          ),
          boxShadow: WainShadows.xl,
        ),
        child: Column(
          children: [
            Text(
              'بعدك تسأل «وين نروح»؟',
              textAlign: TextAlign.center,
              style: wainText(
                WainText.s3xl,
                weight: FontWeight.w700,
                color: Colors.white,
              ),
            ),
            const SizedBox(height: 12),
            Text(
              'خلّ الجروب يرتاح — لقِ طلعة الليلة في أقل من دقيقة.',
              textAlign: TextAlign.center,
              style: wainText(WainText.base, color: Colors.white),
            ),
            const SizedBox(height: 24),
            Material(
              color: WainColors.sun300,
              borderRadius: BorderRadius.circular(WainRadius.s2xl),
              child: InkWell(
                borderRadius: BorderRadius.circular(WainRadius.s2xl),
                onTap: () => context.go('/explore'),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 28,
                    vertical: 12,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'استكشف الأماكن',
                        style: wainText(
                          WainText.lg,
                          weight: FontWeight.w600,
                          color: WainColors.ink900,
                        ),
                      ),
                      const SizedBox(width: 8),
                      WainSvg.icon('go', size: 20, color: WainColors.ink900),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
