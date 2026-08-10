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

    // Standing rigging — thin, and the first thing to vanish when small.
    final stays = stroke(0.32);
    canvas.drawLine(p(21.7, 2.8), p(41.3, 12.1), stays);
    canvas.drawLine(p(21.6, 2.8), p(4.4, 10.5), stays);
    canvas.drawLine(p(31.3, 5.4), p(39.3, 12.9), stays);

    canvas.drawLine(p(19.6, 15.3), p(21.8, 2.5), stroke(1.0)); // main mast
    canvas.drawLine(p(29.8, 14.9), p(31.4, 4.9), stroke(0.9)); // mizzen
    canvas.drawLine(p(12.9, 10.6), p(25.9, 3.5), stroke(0.62)); // lateen yards
    canvas.drawLine(p(25.8, 10.8), p(35.4, 5.4), stroke(0.58));

    // Pennant at the main truck
    canvas.drawPath(
      Path()..moveTo(21.8 * k, 2.4 * k)..lineTo(24.5 * k, 2.9 * k)
        ..lineTo(21.9 * k, 3.8 * k)..close(),
      fill,
    );
    // Transom aft
    canvas.drawPath(
      Path()..moveTo(2.0 * k, 10.0 * k)..lineTo(3.6 * k, 9.7 * k)
        ..lineTo(4.8 * k, 15.2 * k)..lineTo(3.1 * k, 15.5 * k)..close(),
      fill,
    );
    // Raked stem forward, with its finial
    canvas.drawPath(
      Path()..moveTo(38.6 * k, 14.6 * k)..lineTo(44.6 * k, 6.2 * k)
        ..lineTo(45.6 * k, 6.9 * k)..lineTo(40.0 * k, 15.0 * k)..close(),
      fill,
    );
    canvas.drawCircle(p(45.2, 6.1), 0.75 * k, fill);

    // Rubbing strake above the deck line
    canvas.drawPath(
      Path()..moveTo(5.0 * k, 13.1 * k)
        ..cubicTo(14 * k, 15.3 * k, 28 * k, 15.4 * k, 38.8 * k, 12.9 * k),
      stroke(0.5),
    );

    // Hull, with the hawse hole punched through it — a real hole, via evenodd,
    // so it shows the surface behind rather than a painted-on dot.
    final hull = Path()
      ..fillType = PathFillType.evenOdd
      ..moveTo(3.6 * k, 13.75 * k)
      ..cubicTo(14 * k, 16 * k, 28 * k, 16 * k, 38.8 * k, 13.6 * k)
      ..lineTo(40.5 * k, 13.4 * k)
      ..cubicTo(40 * k, 18.5 * k, 34 * k, 20.8 * k, 26 * k, 21.2 * k)
      ..cubicTo(16 * k, 21.6 * k, 8 * k, 20.2 * k, 4.6 * k, 17.4 * k)
      ..close()
      ..addOval(Rect.fromCircle(center: p(8.2, 17.3), radius: 0.9 * k));
    canvas.drawPath(hull, fill);

    // The water she stands in
    canvas.drawPath(
      Path()..moveTo(6.8 * k, 22.45 * k)
        ..cubicTo(16 * k, 23.05 * k, 30 * k, 23.05 * k, 40.6 * k, 22.25 * k),
      stroke(0.55),
    );
  }

  @override
  bool shouldRepaint(_BoumPainter old) => old.color != color;
}
