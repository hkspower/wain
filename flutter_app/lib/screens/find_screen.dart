import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../ai/call_button.dart';
import '../ai/config.dart';
import '../data/find_moment.dart';
import '../share/hangout.dart' show msToNextKuwaitHour;
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/svg.dart';

/// /find — two halves: شوق's call on top, drawn as a phone with one big call
/// button (the web's, 2 October), and a typed conversation below. Both lead to the same place (/search is where a call's answer
/// appears), and the page says so once, in its own words.
///
/// What both halves say follows the moment (data/find_moment.dart), and is
/// redrawn on each Kuwait hour so a screen left open does not go stale.
class FindScreen extends StatefulWidget {
  /// Tests fix the clock; the app reads it.
  final DateTime Function() now;
  const FindScreen({super.key, this.now = DateTime.now});

  @override
  State<FindScreen> createState() => _FindScreenState();
}

class _FindScreenState extends State<FindScreen> {
  late FindMoment _moment = findMomentNow(widget.now());
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _arm();
  }

  void _arm() {
    _timer?.cancel();
    _timer = Timer(
      Duration(milliseconds: msToNextKuwaitHour(widget.now()) + 1000),
      () {
        if (!mounted) return;
        setState(() => _moment = findMomentNow(widget.now()));
        _arm();
      },
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Light icons no more: the call half is sun-50 since the phone came in.
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: kChromeOnLight,
      child: Stack(
        children: [
          // It scrolls, as the web does. Two halves fixed to the screen
          // shrank the phone to 0.72 at 390 and to 0.46 at 320, where its
          // call button came out 42 wide — a phone too small to be the point.
          LayoutBuilder(
            builder: (context, box) => SingleChildScrollView(
              child: Column(
                children: [
                  _CallHalf(
                    key: const ValueKey('find-call'),
                    greeting: findGreeting(CallCopy.name, _moment),
                  ),
                  Stack(
                    clipBehavior: Clip.none,
                    children: [
                      SizedBox(
                        height: (box.maxHeight * 0.5).clamp(380, 520),
                        child: _Half(
                          key: const ValueKey('find-type'),
                          label: 'اكتب',
                          image: 'assets/img/salem.jpg',
                          pill: kSalemRole,
                          background: WainColors.sea950,
                          tint: WainColors.sea950,
                          accent: WainColors.sea300,
                          pillFg: WainColors.sea900,
                          body: findGreeting(kSalemName, _moment),
                          hint: CallCopy.typeHint,
                          action: FilledButton(
                            onPressed: () => context.push('/salem'),
                            style: FilledButton.styleFrom(
                              backgroundColor: WainColors.sea600,
                              // 56, not 48: on a short screen this block is
                              // scaled down to fit (the FittedBox below), and
                              // 48 came out 41.8 tall at 320 — under Android's
                              // finger-size guideline.
                              minimumSize: const Size(0, 56),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 28,
                              ),
                            ),
                            child: Text(
                              'ابدأ الكتابة',
                              style: wainText(
                                WainText.base,
                                weight: FontWeight.w600,
                                color: Colors.white,
                              ),
                            ),
                          ),
                        ),
                      ),
                      // The seam: «أو», decorative, on the seam itself —
                      // painted after the call half, so over it.
                      Positioned(
                        top: -22,
                        left: 0,
                        right: 0,
                        child: Center(
                          child: ExcludeSemantics(
                            child: Container(
                              width: 44,
                              height: 44,
                              alignment: Alignment.center,
                              decoration: const BoxDecoration(
                                color: Colors.white,
                                shape: BoxShape.circle,
                                boxShadow: WainShadows.sm,
                              ),
                              child: Text(
                                'أو',
                                style: wainText(
                                  WainText.sm,
                                  weight: FontWeight.w700,
                                  color: WainColors.ink900,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          PositionedDirectional(
            top: MediaQuery.paddingOf(context).top + 8,
            start: 8,
            child: IconButton(
              tooltip: 'رجوع',
              onPressed: () =>
                  context.canPop() ? context.pop() : context.go('/'),
              icon: WainSvg.icon('back', size: 24, color: Colors.white),
              style: IconButton.styleFrom(backgroundColor: Colors.black38),
            ),
          ),
        ],
      ),
    );
  }
}

/// شوق's half: her role, «كلّم شوق», a handset with her photo, name and one big
/// green call button with «اتصال» under it, and the greeting for this hour.
/// The web's FindChoice.tsx, the same order and words.
class _CallHalf extends StatelessWidget {
  final String greeting;
  const _CallHalf({super.key, required this.greeting});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: 'اتصال',
      child: ColoredBox(
        color: WainColors.sun50,
        child: SafeArea(
          bottom: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 28),
            child: Center(
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: SizedBox(
                  width: 312,
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: WainColors.sun100,
                          borderRadius: BorderRadius.circular(99),
                        ),
                        child: Text(
                          CallCopy.role,
                          style: wainText(
                            WainText.sm,
                            weight: FontWeight.w600,
                            color: WainColors.sun800,
                          ),
                        ),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        'كلّم ${CallCopy.name}',
                        style: wainText(
                          WainText.s3xl,
                          weight: FontWeight.w700,
                          color: WainColors.ink900,
                        ),
                      ),
                      const SizedBox(height: 14),
                      const _Phone(),
                      const SizedBox(height: 14),
                      Text(
                        greeting,
                        key: const ValueKey('find-greeting'),
                        textAlign: TextAlign.center,
                        style: wainText(
                          WainText.base,
                          color: WainColors.ink700,
                          height: 1.6,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A phone is about 1:2; 236 wide keeps the greeting and the seam on screen.
class _Phone extends StatelessWidget {
  const _Phone();

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('find-phone'),
      width: 236,
      height: 446,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: WainColors.ink900,
        borderRadius: BorderRadius.circular(44),
        boxShadow: [
          BoxShadow(
            color: WainColors.ink900.withValues(alpha: 0.22),
            blurRadius: 40,
            offset: const Offset(0, 18),
          ),
        ],
      ),
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(34),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 14, 16, 22),
          child: Column(
            children: [
              ExcludeSemantics(
                child: Container(
                  width: 72,
                  height: 20,
                  decoration: BoxDecoration(
                    color: WainColors.ink900,
                    borderRadius: BorderRadius.circular(99),
                  ),
                ),
              ),
              const SizedBox(height: 22),
              ExcludeSemantics(
                child: ClipOval(
                  child: Image.asset(
                    'assets/img/shouq-face.jpg',
                    width: 104,
                    height: 104,
                    fit: BoxFit.cover,
                  ),
                ),
              ),
              const SizedBox(height: 10),
              Text(
                CallCopy.name,
                style: wainText(
                  WainText.s2xl,
                  weight: FontWeight.w700,
                  color: WainColors.ink900,
                ),
              ),
              Text(
                CallCopy.phoneLine,
                style: wainText(WainText.sm, color: WainColors.ink600),
              ),
              const Spacer(),
              ShouqCallButton(
                size: 92,
                color: WainColors.palm600,
                onTapped: () => context.go('/search'),
              ),
              const SizedBox(height: 8),
              ExcludeSemantics(
                child: Text(
                  'اتصال',
                  style: wainText(
                    WainText.xl,
                    weight: FontWeight.w700,
                    color: WainColors.palm700,
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

class _Half extends StatelessWidget {
  final String label;
  final String image;
  final String pill;
  final Color background;
  final Color tint;
  final Color accent;
  final Color pillFg;
  final String body;
  final String hint;
  final Widget action;
  const _Half({
    super.key,
    required this.label,
    required this.image,
    required this.pill,
    required this.background,
    required this.tint,
    required this.accent,
    required this.pillFg,
    required this.body,
    required this.hint,
    required this.action,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: label,
      child: Container(
        width: double.infinity,
        color: background,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Image.asset(
              image,
              fit: BoxFit.cover,
              alignment: const Alignment(-0.3, -0.6),
            ),
            DecoratedBox(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  // Lighter on request, as on the web: 10→40→65% (was
                  // 40→78→92), so the faces read as photographs. The text
                  // has its own shade below and a shadow on its letters.
                  colors: [
                    tint.withValues(alpha: 0.10),
                    tint.withValues(alpha: 0.40),
                    tint.withValues(alpha: 0.65),
                  ],
                ),
              ),
            ),
            // Under the words only: an ellipse that fades out well inside
            // the photo. The web measured 1.4:1 for the headline without it.
            Center(
              child: FractionallySizedBox(
                widthFactor: 1,
                heightFactor: 0.9,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: RadialGradient(
                      radius: 0.75,
                      colors: [
                        tint.withValues(alpha: 0.62),
                        tint.withValues(alpha: 0.35),
                        tint.withValues(alpha: 0),
                      ],
                      stops: const [0, 0.6, 1],
                    ),
                  ),
                ),
              ),
            ),
            SafeArea(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 24),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 360),
                    // On a short screen the block scales down as a whole
                    // rather than overflowing: each half is only half a phone.
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: SizedBox(
                        width: 312,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 14,
                                vertical: 6,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.9),
                                borderRadius: BorderRadius.circular(99),
                              ),
                              child: Text(
                                pill,
                                style: wainText(
                                  WainText.sm,
                                  weight: FontWeight.w600,
                                  color: pillFg,
                                ),
                              ),
                            ),
                            const SizedBox(height: 14),
                            Text(
                              label,
                              style: wainText(
                                WainText.s4xl,
                                weight: FontWeight.w700,
                                color: accent,
                              ).copyWith(shadows: _onPhoto),
                            ),
                            const SizedBox(height: 10),
                            Text(
                              body,
                              textAlign: TextAlign.center,
                              key: const ValueKey('find-greeting'),
                              style: wainText(
                                WainText.base,
                                color: Colors.white,
                                height: 1.7,
                              ).copyWith(shadows: _onPhoto),
                            ),
                            const SizedBox(height: 14),
                            action,
                            const SizedBox(height: 8),
                            Text(
                              hint,
                              style: wainText(
                                WainText.sm,
                                weight: FontWeight.w600,
                                color: Colors.white,
                              ).copyWith(shadows: _onPhoto),
                            ),
                          ],
                        ),
                      ),
                    ),
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

/// The web's `text-on-photo`: a tight dark edge and a wide soft one, on the
/// letters rather than as a layer over the picture.
const _onPhoto = [
  Shadow(color: Color(0x8C0D121C), offset: Offset(0, 1), blurRadius: 2),
  Shadow(color: Color(0x590D121C), blurRadius: 14),
];
