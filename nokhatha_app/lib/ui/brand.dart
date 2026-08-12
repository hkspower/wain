/// The Almuhallab identity, carried into Flutter unchanged.
///
/// The colours are the same tokens the web build solves numerically against
/// WCAG targets — they are not re-picked here. Brown is ink and the one bar
/// surface; everything below it is white. There is no dark theme, on any
/// device, by decision.
library;

import 'package:flutter/material.dart';

class Brand {
  static const tint = Color(0xFF7A4418);
  static const tintStrong = Color(0xFF6F3F1C); // the masthead bar
  static const sandVivid = Color(0xFFE3A556);
  static const text = Color(0xFF1B2430);
  static const muted = Color(0xFF586981);
  static const bg = Color(0xFFFFFFFF);
  static const panel2 = Color(0xFFF1F4F8);
  static const border = Color(0xFFD0D7E1);
  static const good = Color(0xFF02783D);
  static const danger = Color(0xFFCE1925);

  /// The spacing scale. One scale across the whole product — the web build
  /// carried 27 distinct values before this was imposed.
  static const s4 = 4.0, s8 = 8.0, s12 = 12.0, s16 = 16.0;
  static const s20 = 20.0, s24 = 24.0, s32 = 32.0;

  static ThemeData theme() {
    final base = ThemeData.light(useMaterial3: true);
    return base.copyWith(
      scaffoldBackgroundColor: bg,
      colorScheme: base.colorScheme.copyWith(
        primary: tintStrong,
        secondary: sandVivid,
        surface: bg,
        error: danger,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: tintStrong,
        foregroundColor: Colors.white,
        elevation: 0,
        centerTitle: true,
      ),
      cardTheme: CardThemeData(
        color: bg,
        elevation: 0,
        shape: RoundedRectangleBorder(
          side: const BorderSide(color: border),
          borderRadius: BorderRadius.circular(14),
        ),
      ),
      textTheme: base.textTheme.apply(bodyColor: text, displayColor: text),
    );
  }
}

/// The boum, drawn natively. Same geometry as the wide `#i-boum` symbol on a
/// 48×24 grid, so the app and the site carry one mark rather than two.
///
/// The yards are raked, never square across a mast — square ones read as a
/// cross, which this mark must never do.
class BoumMark extends StatelessWidget {
  const BoumMark({super.key, this.height = 44, this.color = Colors.white});

  final double height;
  final Color color;

  @override
  Widget build(BuildContext context) => SizedBox(
        height: height,
        width: height * 2, // the mark is 2:1; a square would squash her
        child: CustomPaint(painter: _BoumPainter(color)),
      );
}

class _BoumPainter extends CustomPainter {
  _BoumPainter(this.color);
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final k = size.width / 48.0; // the drawing's own grid
    Offset p(double x, double y) => Offset(x * k, y * k);

    final fill = Paint()..color = color..style = PaintingStyle.fill;
    Paint stroke(double w) => Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = w * k
      ..strokeCap = StrokeCap.round;

    // Drawn from almuhallab/logo.svg on the same 48x24 grid — the boum under
    // sail: a double-ended hull with a tall raked stem, the tall mainmast
    // FORWARD and the short mizzen aft, and two filled lateen sails. The sail
    // is what says "Arab" and "under way"; the previous bare-poled drawing
    // read as a laid-up hull. Two stroke steps only: masts 1.0, the rest 0.6.

    // The water she sails in — drawn first, so the hull cuts it.
    canvas.drawPath(
      Path()..moveTo(5.5 * k, 18.95 * k)
        ..cubicTo(15 * k, 19.5 * k, 32 * k, 19.5 * k, 43.4 * k, 18.85 * k),
      stroke(0.6),
    );

    // Hull: sternpost, sheer, and the stem — one continuous silhouette.
    canvas.drawPath(
      Path()
        ..moveTo(4.6 * k, 12.6 * k)
        ..cubicTo(6.3 * k, 13.9 * k, 8 * k, 14.8 * k, 9.8 * k, 15.15 * k)
        ..cubicTo(15 * k, 16.4 * k, 23 * k, 16.5 * k, 30.4 * k, 15.55 * k)
        ..cubicTo(34.6 * k, 15 * k, 37.7 * k, 14.2 * k, 40.3 * k, 13.2 * k)
        ..lineTo(43.35 * k, 6.85 * k)
        ..lineTo(44.35 * k, 7.3 * k)
        ..lineTo(41.4 * k, 14.4 * k)
        ..cubicTo(38.4 * k, 18.2 * k, 33 * k, 20 * k, 25.8 * k, 20.35 * k)
        ..cubicTo(18.4 * k, 20.75 * k, 11 * k, 19.4 * k, 7.7 * k, 16.7 * k)
        ..close(),
      fill,
    );

    // Rubbing strake, under the sheer
    canvas.drawPath(
      Path()..moveTo(9.6 * k, 16.05 * k)
        ..cubicTo(15 * k, 17.3 * k, 23 * k, 17.4 * k, 30.3 * k, 16.45 * k)
        ..cubicTo(34.5 * k, 15.9 * k, 37.5 * k, 15.1 * k, 39.6 * k, 14.2 * k),
      stroke(0.6),
    );

    // Masts — butt-capped, ending at their sail's luff so no peg pokes out.
    final mast = stroke(1.0)..strokeCap = StrokeCap.butt;
    canvas.drawLine(p(13, 16), p(14.1, 9.23), mast);      // mizzen, aft
    canvas.drawLine(p(26.8, 16.4), p(28.63, 7.79), mast); // mainmast, forward

    // Lateen yards: peak high aft, tack low forward.
    canvas.drawLine(p(7.6, 5.2), p(18.4, 11.9), stroke(0.6));
    canvas.drawLine(p(20.5, 2.2), p(35.6, 12.6), stroke(0.6));

    // The sails themselves
    canvas.drawPath(
      Path()..moveTo(7.6 * k, 5.2 * k)..lineTo(18.4 * k, 11.9 * k)
        ..lineTo(9.2 * k, 13.4 * k)..close(),
      fill,
    );
    canvas.drawPath(
      Path()..moveTo(20.5 * k, 2.2 * k)..lineTo(35.6 * k, 12.6 * k)
        ..lineTo(23.6 * k, 14.4 * k)..close(),
      fill,
    );
  }

  @override
  bool shouldRepaint(_BoumPainter old) => old.color != color;
}
