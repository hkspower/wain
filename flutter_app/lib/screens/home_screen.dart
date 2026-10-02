import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../data/catalogue.dart';
import '../data/home_hero.g.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/layout.dart';
import '../widgets/place_card.dart';
import '../widgets/svg.dart';

/// Home: the picture hero with its sun as the «إلى وين؟» button, the featured
/// places, how it works, and the call to explore. The sun is one navigation,
/// to /find, which asks how you want to search before showing anything.
class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    // The space above the tab bar, which the hero fills on a phone.
    return LayoutBuilder(
      builder: (context, box) => ListView(
        padding: EdgeInsets.zero,
        children: [
          _Hero(screenHeight: box.maxHeight),
          const _Featured(),
          const _HowItWorks(),
          const _Cta(),
        ],
      ),
    );
  }
}

/// The owner's picture (brand-source/home-hero.png, shipped by
/// `npm run home-hero`), as on the web (HomeHero.tsx): never cropped, its
/// wordmark and question part of the picture, its sun the button. Everything
/// on it is placed in the picture's own fractions from home_hero.g.dart, so it
/// lands on the same spot at every size.
///
/// A phone shows it at full width, centred in the whole first screen with the
/// picture's top-row sky above it and its bottom-row sea below (2 October, on
/// request — option B on the design canvas: a phone is taller than 9:16, and
/// the owner chose bands over cutting the picture's sides). A tablet (Android 16 may lay one out
/// whatever the manifest says) gets it as tall as the screen allows, centred,
/// with the picture's edge colours carried out to the sides — the web's rule
/// from `sm` up, and its numbers: 28rem to 62rem, the screen less 3rem.
class _Hero extends StatelessWidget {
  /// The height of the space the hero sits in (the screen above the tab bar).
  final double screenHeight;
  const _Hero({required this.screenHeight});

  @override
  Widget build(BuildContext context) {
    final screen = MediaQuery.sizeOf(context);
    final double pw, ph;
    if (screen.width < 640) {
      pw = screen.width;
      ph = pw * kHomeHeroHeight / kHomeHeroWidth;
    } else {
      ph = (screen.height - 48).clamp(448.0, 992.0);
      pw = ph * kHomeHeroWidth / kHomeHeroHeight;
    }
    final narrower = pw < screen.width - 0.5;
    final phone = screen.width < 640;
    final height = phone && screenHeight.isFinite
        ? math.max(ph, screenHeight)
        : ph;
    Widget picture = Image.asset(
      kHomeHeroAsset,
      width: pw,
      height: ph,
      fit: BoxFit.fill,
      excludeFromSemantics: true,
      gaplessPlayback: true,
    );
    if (narrower) {
      // Faded into the bands beside it, so a band edge a few px off (the
      // waves are not straight) never reads as a seam.
      picture = ShaderMask(
        blendMode: BlendMode.dstIn,
        shaderCallback: (r) => const LinearGradient(
          colors: [
            Color(0x00000000),
            Color(0xFF000000),
            Color(0xFF000000),
            Color(0x00000000),
          ],
          stops: [0, 0.06, 0.94, 1],
        ).createShader(r),
        child: picture,
      );
    }
    return Container(
      height: height,
      decoration: BoxDecoration(
        gradient: phone
            ? LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  kHomeHeroEdgeColors.first,
                  kHomeHeroEdgeColors.first,
                  kHomeHeroEdgeColors.last,
                  kHomeHeroEdgeColors.last,
                ],
                stops: const [0, 0.5, 0.5, 1],
              )
            : const LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: kHomeHeroEdgeColors,
                stops: kHomeHeroEdgeStops,
              ),
      ),
      alignment: phone ? Alignment.center : Alignment.topCenter,
      child: SizedBox(
        width: pw,
        height: ph,
        child: Stack(
          children: [
            // The picture says both; these say them to a screen reader.
            Semantics(
              header: true,
              label: 'وين — وين الطلعة اليوم؟',
              child: picture,
            ),
            // No «دوّر باسم المكان» on the sea here: the app's tab bar has a
            // search tab, so it would be the same offer twice. The website
            // keeps it — in a browser it is the page's one way to /search —
            // and hides it in its installed mode too.
            _Sun(pw: pw, ph: ph),
          ],
        ),
      ),
    );
  }
}

class _Sun extends StatefulWidget {
  final double pw, ph;
  const _Sun({required this.pw, required this.ph});

  @override
  State<_Sun> createState() => _SunState();
}

class _SunState extends State<_Sun> with SingleTickerProviderStateMixin {
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2600),
  )..repeat();

  @override
  void dispose() {
    _pulse.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final pw = widget.pw, ph = widget.ph;
    final d = 2 * kHomeHeroSunR * pw;
    final left = (kHomeHeroSunX - kHomeHeroSunR) * pw;
    final top = kHomeHeroSunY * ph - kHomeHeroSunR * pw;
    // The label's box, in the sun's own coordinates.
    final label = Rect.fromLTRB(
      kHomeHeroLabel.left * pw - left,
      kHomeHeroLabel.top * ph - top,
      kHomeHeroLabel.right * pw - left,
      kHomeHeroLabel.bottom * ph - top,
    );
    return Positioned(
      left: left,
      top: top,
      width: d,
      height: d,
      child: Semantics(
        key: const ValueKey('home-sun'),
        button: true,
        label: 'إلى وين؟ — اكتب أو كلّم شوق',
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: () => context.push('/find'),
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              // A ring that breathes out from the rim, so the sun reads as
              // something to press — a ring, not a fill, or it would wash yellow
              // over the Kuwait Towers in front of it. Off under reduced motion.
              if (!MediaQuery.disableAnimationsOf(context))
                Positioned.fill(
                  child: AnimatedBuilder(
                    animation: _pulse,
                    builder: (_, _) {
                      final v = (_pulse.value / 0.7).clamp(0.0, 1.0);
                      return Transform.scale(
                        scale: 0.92 + 0.2 * v,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: WainColors.sun200.withValues(
                                alpha: 0.7 * (1 - v),
                              ),
                              width: 4,
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              Positioned.fromRect(
                rect: label,
                child: ExcludeSemantics(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        'إلى وين؟',
                        maxLines: 1,
                        style: wainText(
                          math.max(20.0, 0.062 * pw),
                          weight: FontWeight.w700,
                          color: WainColors.ink900,
                        ),
                      ),
                      SizedBox(height: 0.02 * pw),
                      Container(
                        padding: EdgeInsets.symmetric(
                          horizontal: 0.048 * pw,
                          vertical: 0.012 * pw,
                        ),
                        decoration: BoxDecoration(
                          color: WainColors.ink900,
                          borderRadius: BorderRadius.circular(99),
                        ),
                        child: Text(
                          'ابدأ',
                          style: wainText(
                            math.max(11.0, 0.034 * pw),
                            weight: FontWeight.w600,
                            color: WainColors.sun100,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
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
