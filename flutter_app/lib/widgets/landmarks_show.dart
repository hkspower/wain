import 'package:flutter/gestures.dart' show DragStartBehavior;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../data/catalogue.dart';
import '../data/landmarks.g.dart';
import '../data/text_kit.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import 'illustrative_tag.dart';
import 'landmark_picture.dart';
import 'layout.dart';
import 'svg.dart';

/// «معالم الكويت», under the home hero — the web's LandmarksShow.tsx.
///
/// Direction A, «القصة», the owner's pick on the 3 October canvas: the picture
/// edge to edge, a row of progress bars across its top that are also the way to
/// jump, and the name over a dark fade at its foot. It replaced a show whose
/// dots could not be tapped, whose stop button said nothing, and whose fixed
/// 330 box cut every picture differently at every width.
///
/// **The clock is the progress bar.** One controller of [interval] fills the
/// bar of the landmark on screen, drifts its picture, and moves the show on
/// when it completes — so «وقّف» stops one thing, and the bar shows exactly
/// how long is left. Under reduced motion it never runs: the first landmark
/// stays, its bar stands full to say which one it is, and the bars and a swipe
/// still work. A sideways swipe moves the show — on to the next when the finger
/// travels right, the way an Arabic row reads — and an up-or-down drag
/// is still the page's.
///
/// The pictures and their order come from landmarks.g.dart, which
/// `npm run landmarks` writes alongside the web's copy; names and areas come
/// from the catalogue. Whether the show is on the home at all is the gate's
/// question (`kShowLandmarks`).
class LandmarksShow extends StatefulWidget {
  const LandmarksShow({super.key, this.interval = const Duration(seconds: 6)});

  final Duration interval;

  @override
  State<LandmarksShow> createState() => _LandmarksShowState();
}

class _LandmarksShowState extends State<LandmarksShow>
    with SingleTickerProviderStateMixin {
  late final AnimationController _clock =
      AnimationController(vsync: this, duration: widget.interval)
        ..addStatusListener((s) {
          if (s == AnimationStatus.completed) _go(_index + 1);
        });

  /// Each landmark's drift reads the clock while it is on screen and keeps its
  /// last frame while it fades out, so the clock can start again for the next
  /// one without the last one jumping back under the crossfade.
  final List<ProxyAnimation> _drift = [
    for (var i = 0; i < kLandmarks.length; i++)
      ProxyAnimation(kAlwaysDismissedAnimation),
  ];

  int _index = 0;
  bool _paused = false;
  double _dragDx = 0;

  bool get _calm => MediaQuery.disableAnimationsOf(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _run();
  }

  @override
  void didUpdateWidget(LandmarksShow old) {
    super.didUpdateWidget(old);
    _clock.duration = widget.interval;
  }

  @override
  void dispose() {
    _clock.dispose();
    super.dispose();
  }

  // The clock runs only while the show is meant to move: paused, or under
  // reduced motion, nothing ticks at all. Paused, it keeps its place, so
  // «كمّل» finishes the same six seconds.
  void _run() {
    if (_paused || _calm) {
      _clock.stop();
    } else if (!_clock.isAnimating) {
      _clock.forward();
    }
    _drift[_index].parent = _clock;
  }

  void _go(int i) {
    final n = kLandmarks.length;
    final next = ((i % n) + n) % n;
    if (next == _index || !mounted) return;
    _drift[_index].parent = AlwaysStoppedAnimation(_drift[_index].value);
    _clock.value = 0;
    setState(() => _index = next);
    _run();
  }

  void _toggle() {
    HapticFeedback.selectionClick();
    setState(() => _paused = !_paused);
    _run();
  }

  void _dragEnd(DragEndDetails d) {
    final dx = _dragDx;
    final v = d.primaryVelocity ?? 0;
    _dragDx = 0;
    if (dx.abs() < 40 && v.abs() < 400) return;
    final right = dx.abs() >= 40 ? dx > 0 : v > 0;
    _go(right ? _index + 1 : _index - 1);
  }

  @override
  Widget build(BuildContext context) {
    final calm = _calm;
    final width = MediaQuery.sizeOf(context).width;
    final gutter = pageGutter(context);
    final pic = kLandmarks[_index];
    final place = getPlace(pic.slug)!;
    return ColoredBox(
      color: WainColors.sand50,
      child: Padding(
        padding: EdgeInsets.only(bottom: width >= 600 ? 12 : 8),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: gutter.copyWith(top: 16, bottom: 8),
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
                  _PausePill(paused: _paused, onTap: _toggle),
                ],
              ),
            ),
            // Edge to edge, and a shape per screen rather than a fixed height:
            // a fixed 330 cut every picture differently at every width.
            AspectRatio(
              key: const ValueKey('landmarks-box'),
              aspectRatio: width < 600 ? 6 / 5 : 2 / 1,
              child: GestureDetector(
                // From where the finger landed, so 40 is the whole swipe, as
                // on the web; `start` would leave the 18 of slop uncounted.
                dragStartBehavior: DragStartBehavior.down,
                onHorizontalDragStart: (_) => _dragDx = 0,
                onHorizontalDragUpdate: (d) => _dragDx += d.primaryDelta ?? 0,
                onHorizontalDragEnd: _dragEnd,
                onHorizontalDragCancel: () => _dragDx = 0,
                child: ClipRect(
                  child: ColoredBox(
                    color: WainColors.ink900,
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        AnimatedSwitcher(
                          duration: calm
                              ? Duration.zero
                              : const Duration(milliseconds: 700),
                          // Only the slide on screen can be tapped or read: the
                          // one fading out is not where the finger thinks it
                          // is. Every entry is wrapped the same way, keyed, so
                          // the one leaving keeps its element.
                          layoutBuilder: (current, previous) => Stack(
                            fit: StackFit.expand,
                            children: [
                              for (final w in [...previous, ?current])
                                IgnorePointer(
                                  key: w.key,
                                  ignoring: w != current,
                                  child: ExcludeSemantics(
                                    excluding: w != current,
                                    child: w,
                                  ),
                                ),
                            ],
                          ),
                          child: _Slide(
                            key: ValueKey('landmark-slide-${pic.slug}'),
                            picture: pic,
                            name: place.nameAr,
                            area: place.areaAr,
                            drift: calm ? null : _drift[_index],
                            odd: _index.isOdd,
                          ),
                        ),
                        // A shade under the bars, so white reads on a white sky.
                        Positioned(
                          left: 0,
                          right: 0,
                          top: 0,
                          height: 80,
                          child: IgnorePointer(
                            child: DecoratedBox(
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  begin: Alignment.topCenter,
                                  end: Alignment.bottomCenter,
                                  colors: [
                                    WainColors.ink900.withValues(alpha: 0.55),
                                    WainColors.ink900.withValues(alpha: 0),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ),
                        PositionedDirectional(
                          start: gutter.left,
                          top: _barsHeight + 4,
                          child: const IllustrativeTag(),
                        ),
                        Positioned(
                          left: gutter.left,
                          right: gutter.right,
                          top: 0,
                          height: _barsHeight,
                          child: _bars(calm),
                        ),
                      ],
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

  Widget _bars(bool calm) {
    final n = kLandmarks.length;
    return Row(
      children: [
        for (var i = 0; i < n; i++)
          Expanded(
            child: _Bar(
              key: ValueKey('landmark-bar-${kLandmarks[i].slug}'),
              label:
                  '${toArabicDigits(i + 1)} من ${toArabicDigits(n)}، '
                  '${getPlace(kLandmarks[i].slug)!.nameAr}',
              current: i == _index,
              // Full once it has been, and — under reduced motion, where
              // nothing fills — full for the one on screen, to say which.
              fill: i < _index || (i == _index && calm)
                  ? kAlwaysCompleteAnimation
                  : i == _index
                  ? _clock
                  : kAlwaysDismissedAnimation,
              onTap: () => _go(i),
            ),
          ),
      ],
    );
  }
}

/// The bars' row: tall enough for a finger, the bars themselves 3 high.
const double _barsHeight = 48;

/// «وقّف» / «كمّل»: a show that moves on its own needs a way to stop it, and
/// the button says in a word what it will do.
class _PausePill extends StatelessWidget {
  const _PausePill({required this.paused, required this.onTap});

  final bool paused;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      key: const ValueKey('landmarks-pause'),
      container: true,
      button: true,
      label: paused ? 'كمّل العرض' : 'وقّف العرض',
      onTap: onTap,
      excludeSemantics: true,
      // A fill on the decoration: a shadow on a transparent box shows through.
      child: DecoratedBox(
        decoration: const ShapeDecoration(
          color: Colors.white,
          shape: StadiumBorder(side: BorderSide(color: WainColors.lineControl)),
          shadows: WainShadows.sm,
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            customBorder: const StadiumBorder(),
            onTap: onTap,
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 48),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    WainSvg.icon(
                      paused ? 'play' : 'pause',
                      size: 16,
                      color: WainColors.ink700,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      paused ? 'كمّل' : 'وقّف',
                      style: wainText(
                        WainText.sm,
                        weight: FontWeight.w600,
                        color: WainColors.ink700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// One landmark's bar: full once it has been, empty until it comes, and
/// filling from the start edge — the right, the way the row reads — while it
/// is on screen. The whole height of the row is the tap target.
class _Bar extends StatelessWidget {
  const _Bar({
    super.key,
    required this.label,
    required this.current,
    required this.fill,
    required this.onTap,
  });

  final String label;
  final bool current;
  final Animation<double> fill;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      button: true,
      selected: current,
      label: label,
      onTap: onTap,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        excludeFromSemantics: true,
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 2),
          child: Center(
            // The track takes the whole width; a FractionallySizedBox under
            // loose constraints would shrink it to the fill.
            child: SizedBox(
              key: const ValueKey('landmark-bar-track'),
              height: 3,
              width: double.infinity,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(2),
                child: ColoredBox(
                  color: Colors.white.withValues(alpha: 0.4),
                  child: AnimatedBuilder(
                    animation: fill,
                    builder: (_, _) => FractionallySizedBox(
                      alignment: AlignmentDirectional.centerStart,
                      widthFactor: fill.value,
                      child: const ColoredBox(
                        key: ValueKey('landmark-bar-fill'),
                        color: Colors.white,
                      ),
                    ),
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

/// One landmark: its picture, drifting while it is on screen, and its name over
/// a fade at the foot. A tap anywhere opens its place.
class _Slide extends StatelessWidget {
  const _Slide({
    super.key,
    required this.picture,
    required this.name,
    required this.area,
    required this.drift,
    required this.odd,
  });

  final LandmarkPicture picture;
  final String name, area;

  /// Null under reduced motion: the picture stands still.
  final Animation<double>? drift;
  final bool odd;

  @override
  Widget build(BuildContext context) {
    void open() => context.push('/places/${picture.slug}');
    final image = LandmarkImage(picture, showFlag: false);
    // A preview's «رسم مؤقت» a third of the way down, clear of the bars and
    // the tag at the top and the caption at the foot — the web's place — and
    // outside the drift, which would carry it half out of the box.
    const flagAt = AlignmentDirectional(1, -1 / 3);
    return Semantics(
      container: true,
      link: true,
      label: '$name، $area — شوف المكان',
      onTap: open,
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        excludeFromSemantics: true,
        onTap: open,
        child: Stack(
          fit: StackFit.expand,
          children: [
            if (drift == null)
              image
            else
              _Drift(animation: drift!, odd: odd, child: image),
            if (picture.standIn)
              const Align(
                alignment: flagAt,
                child: StandInFlag(at: flagAt),
              ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: _Caption(name: name, area: area),
            ),
          ],
        ),
      ),
    );
  }
}

/// The name and area at the foot, on a fade built for the worst picture: white
/// text needs the dark at 82% or more under 14px and 70% under the 20px name,
/// so 90% at the foot easing to 80% at 45% of the way up covers both lines on
/// a white sky; above them the picture shows through (the web's arithmetic).
class _Caption extends StatelessWidget {
  const _Caption({required this.name, required this.area});

  final String name, area;

  @override
  Widget build(BuildContext context) {
    final gutter = pageGutter(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.bottomCenter,
          end: Alignment.topCenter,
          colors: [
            WainColors.ink900.withValues(alpha: 0.9),
            WainColors.ink900.withValues(alpha: 0.8),
            WainColors.ink900.withValues(alpha: 0),
          ],
          stops: const [0, 0.45, 1],
        ),
      ),
      child: Padding(
        padding: EdgeInsets.fromLTRB(gutter.left, 64, gutter.right, 14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
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
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      WainSvg.icon('pinsolid', size: 14, color: Colors.white),
                      const SizedBox(width: 4),
                      Flexible(
                        child: Text(
                          area,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: wainText(WainText.sm, color: Colors.white),
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
                  WainSvg.icon('go', size: 16, color: WainColors.ink900),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The slow drift on the picture on screen: the web's `kb-a` (scale 1 → 1.12
/// with a small pan) on the first, third and fifth, `kb-b` (1.1 → 1, the pan
/// undone) on the others, eased out over seven sixths of the clock — so, as on
/// the web, it is still moving when the next one fades in.
class _Drift extends StatelessWidget {
  const _Drift({
    required this.animation,
    required this.odd,
    required this.child,
  });

  final Animation<double> animation;
  final bool odd;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: animation,
      builder: (_, child) {
        final t = Curves.easeOut.transform(animation.value * 6 / 7);
        final scale = odd ? 1.1 - 0.1 * t : 1 + 0.12 * t;
        final dx = odd ? -0.015 * (1 - t) : 0.02 * t;
        final dy = odd ? 0.01 * (1 - t) : -0.015 * t;
        return FractionalTranslation(
          translation: Offset(dx, dy),
          child: Transform.scale(scale: scale, child: child),
        );
      },
      child: child,
    );
  }
}
