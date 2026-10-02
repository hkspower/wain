import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../data/catalogue.dart';
import '../data/landmarks.g.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import 'layout.dart';
import 'svg.dart';

/// «معالم الكويت», under the home hero — the web's LandmarksShow.tsx.
///
/// One landmark at a time: each holds the screen for [interval], crossfades
/// into the next and drifts slowly while it is up. A tap opens its place page.
/// A show that moves on its own needs a way to stop it, so there is a button
/// that does; under reduced motion nothing moves at all and the first one
/// stays. The pictures and their order come from landmarks.g.dart, which
/// `npm run landmarks` writes alongside the web's copy; names and areas come
/// from the catalogue.
class LandmarksShow extends StatefulWidget {
  const LandmarksShow({super.key, this.interval = const Duration(seconds: 6)});

  final Duration interval;

  @override
  State<LandmarksShow> createState() => _LandmarksShowState();
}

class _LandmarksShowState extends State<LandmarksShow> {
  int _index = 0;
  bool _paused = false;
  Timer? _timer;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  bool get _still => _paused || MediaQuery.disableAnimationsOf(context);

  // One timer, running only while the show is meant to move: a paused show
  // or one under reduced motion holds no timer at all.
  void _sync() {
    if (_still) {
      _timer?.cancel();
      _timer = null;
      if (MediaQuery.disableAnimationsOf(context)) _index = 0;
    } else {
      _timer ??= Timer.periodic(widget.interval, (_) {
        if (mounted) setState(() => _index = (_index + 1) % kLandmarks.length);
      });
    }
  }

  void _toggle() {
    setState(() => _paused = !_paused);
    _sync();
  }

  @override
  Widget build(BuildContext context) {
    final still = _still;
    final wide = MediaQuery.sizeOf(context).width >= 600;
    final pic = kLandmarks[_index];
    final place = getPlace(pic.slug)!;
    return Container(
      color: WainColors.sand50,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: pageGutter(context).copyWith(top: 16, bottom: 8),
            child: Row(
              children: [
                Expanded(
                  child: Semantics(
                    header: true,
                    child: Text(
                      'معالم الكويت',
                      style: wainText(
                        WainText.lg,
                        weight: FontWeight.w700,
                        color: WainColors.ink900,
                      ),
                    ),
                  ),
                ),
                Semantics(
                  key: const ValueKey('landmarks-pause'),
                  button: true,
                  toggled: _paused,
                  label: _paused ? 'شغّل الحركة' : 'وقّف الحركة',
                  child: HitArea(
                    onTap: _toggle,
                    child: Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: Colors.white,
                        shape: BoxShape.circle,
                        border: Border.all(color: WainColors.line),
                      ),
                      alignment: Alignment.center,
                      child: WainSvg.icon(
                        _paused ? 'play' : 'pause',
                        size: 16,
                        color: WainColors.ink700,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(
            height: wide ? 460 : 330,
            child: ColoredBox(
              color: WainColors.ink900,
              child: AnimatedSwitcher(
                duration: still
                    ? Duration.zero
                    : const Duration(milliseconds: 900),
                child: _Slide(
                  key: ValueKey(pic.slug),
                  asset: pic.asset,
                  slug: pic.slug,
                  name: place.nameAr,
                  area: place.areaAr,
                  reverse: _index.isOdd,
                  still: still,
                ),
              ),
            ),
          ),
          ExcludeSemantics(
            child: SizedBox(
              height: 36,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  for (var i = 0; i < kLandmarks.length; i++)
                    AnimatedContainer(
                      duration: still
                          ? Duration.zero
                          : const Duration(milliseconds: 300),
                      margin: const EdgeInsets.symmetric(horizontal: 3),
                      width: i == _index ? 22 : 8,
                      height: 8,
                      decoration: BoxDecoration(
                        color: i == _index
                            ? WainColors.sea600
                            : WainColors.lineStrong,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Slide extends StatelessWidget {
  const _Slide({
    super.key,
    required this.asset,
    required this.slug,
    required this.name,
    required this.area,
    required this.reverse,
    required this.still,
  });

  final String asset, slug, name, area;
  final bool reverse, still;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      link: true,
      label: '$name، $area — شوف المكان',
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => context.push('/places/$slug'),
        child: Stack(
          fit: StackFit.expand,
          children: [
            ClipRect(
              child: _KenBurns(
                reverse: reverse,
                still: still,
                child: Image.asset(
                  asset,
                  fit: BoxFit.cover,
                  excludeFromSemantics: true,
                  gaplessPlayback: true,
                ),
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(
                color: WainColors.ink900.withValues(alpha: 0.75),
                padding: pageGutter(context).copyWith(top: 12, bottom: 12),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: wainText(
                              WainText.xl,
                              weight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                          Row(
                            children: [
                              WainSvg.icon(
                                'pinsolid',
                                size: 14,
                                color: WainColors.sand200,
                              ),
                              const SizedBox(width: 4),
                              Flexible(
                                child: Text(
                                  area,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: wainText(
                                    WainText.sm,
                                    color: WainColors.sand200,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    Container(
                      constraints: const BoxConstraints(minHeight: 44),
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'شوف المكان',
                            style: wainText(
                              WainText.sm,
                              weight: FontWeight.w600,
                              color: WainColors.ink900,
                            ),
                          ),
                          const SizedBox(width: 6),
                          WainSvg.icon(
                            'go',
                            size: 16,
                            color: WainColors.ink900,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The slow drift on each picture: the web's `kb-a`/`kb-b` (scale 1 → 1.12
/// with a small pan, and the reverse), 9s each way. Off under reduced motion
/// and while the show is stopped.
class _KenBurns extends StatefulWidget {
  const _KenBurns({
    required this.child,
    required this.reverse,
    required this.still,
  });

  final Widget child;
  final bool reverse, still;

  @override
  State<_KenBurns> createState() => _KenBurnsState();
}

class _KenBurnsState extends State<_KenBurns>
    with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(seconds: 9),
  );

  @override
  void initState() {
    super.initState();
    if (!widget.still) _c.repeat(reverse: true);
  }

  @override
  void didUpdateWidget(_KenBurns old) {
    super.didUpdateWidget(old);
    if (widget.still && _c.isAnimating) _c.stop();
    if (!widget.still && !_c.isAnimating) _c.repeat(reverse: true);
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _c,
      builder: (_, child) {
        final t = Curves.easeOut.transform(_c.value);
        final v = widget.reverse ? 1 - t : t;
        final scale = widget.reverse ? 1 + 0.1 * v : 1 + 0.12 * v;
        final dx = widget.reverse ? -0.015 * v : 0.02 * v;
        final dy = widget.reverse ? 0.01 * v : -0.015 * v;
        return FractionalTranslation(
          translation: Offset(dx, dy),
          child: Transform.scale(scale: scale, child: child),
        );
      },
      child: widget.child,
    );
  }
}
