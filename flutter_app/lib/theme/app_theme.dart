/// The Material theme, built from the generated tokens so the native app reads
/// as the same brand as the site: white canvas, sand surfaces, ink text, sea
/// for action, coral for accent. Weight carries hierarchy (one family).
library;

import 'package:flutter/material.dart';

import 'colors.dart';

const String kFontFamily = 'IBMPlexSansArabic';

/// Line height per Tailwind step, from `--text-*--line-height` in theme.css:
/// looser as the type gets smaller, because that is where Arabic's dots and
/// descenders have the least room.
double leadingFor(double size) {
  if (size <= 11) return WainText.leading['s2xs']!;
  if (size <= 12) return WainText.leading['xs']!;
  if (size <= 14) return WainText.leading['sm']!;
  if (size <= 16) return WainText.leading['base']!;
  if (size <= 18) return WainText.leading['lg']!;
  if (size <= 20) return WainText.leading['xl']!;
  if (size <= 22) return WainText.leading['s2xl']!;
  if (size <= 26) return WainText.leading['s3xl']!;
  if (size <= 30) return WainText.leading['s4xl']!;
  return WainText.leading['s5xl']!;
}

/// A text style at a theme size. Sizes are the site's own (11, 12, 14, 16, 18,
/// 20, 22, 26, 30, 38, 46) — nothing below 11, where Arabic's dots go first.
TextStyle wainText(
  double size, {
  FontWeight weight = FontWeight.w400,
  Color color = WainColors.ink700,
  double? height,
}) => TextStyle(
  fontFamily: kFontFamily,
  fontSize: size,
  fontWeight: weight,
  color: color,
  height: height ?? leadingFor(size),
);

ThemeData buildWainTheme() {
  final scheme = ColorScheme.fromSeed(
    seedColor: WainColors.sea500,
    primary: WainColors.sea600,
    onPrimary: Colors.white,
    secondary: WainColors.sun500,
    tertiary: WainColors.coral600,
    surface: Colors.white,
    onSurface: WainColors.ink800,
    error: WainColors.coral600,
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: kFontFamily,
    scaffoldBackgroundColor: WainColors.sand50,
    dividerColor: WainColors.line,
    splashFactory: InkRipple.splashFactory,
    appBarTheme: const AppBarTheme(
      backgroundColor: WainColors.sand50,
      foregroundColor: WainColors.ink900,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: true,
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: Colors.white,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(WainRadius.s3xl),
        side: const BorderSide(color: WainColors.line),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(WainRadius.xl),
        borderSide: const BorderSide(color: WainColors.lineControl),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(WainRadius.xl),
        borderSide: const BorderSide(color: WainColors.lineControl),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(WainRadius.xl),
        borderSide: const BorderSide(color: WainColors.sea600, width: 2),
      ),
      hintStyle: wainText(WainText.base, color: WainColors.ink400),
    ),
    textTheme: TextTheme(
      bodyLarge: wainText(WainText.base),
      bodyMedium: wainText(WainText.sm),
      bodySmall: wainText(WainText.xs, color: WainColors.ink500),
      titleLarge: wainText(
        WainText.s2xl,
        weight: FontWeight.w700,
        color: WainColors.ink900,
      ),
      titleMedium: wainText(
        WainText.lg,
        weight: FontWeight.w600,
        color: WainColors.ink900,
      ),
      labelLarge: wainText(WainText.sm, weight: FontWeight.w600),
    ),
  );
}
