/// Colour ramps copied from `src/app/theme.css`'s `@theme` block — the same
/// hex values the web site's Tailwind tokens resolve to, so the native app
/// reads as the same brand rather than a re-guess of it. Kept by hand: it is
/// eight small ramps that change on purpose, rarely, and a codegen step for
/// a palette this size would be more ceremony than the drift risk is worth.
library;

import 'package:flutter/material.dart';

class WainColors {
  WainColors._();

  static const sea50 = Color(0xFFEFF8FD);
  static const sea100 = Color(0xFFDAEEFA);
  static const sea200 = Color(0xFFBCE0F5);
  static const sea300 = Color(0xFF8DCCEE);
  static const sea400 = Color(0xFF57B0E3);
  static const sea500 = Color(0xFF3194D1);
  static const sea600 = Color(0xFF2277B4);
  static const sea700 = Color(0xFF1E6092);
  static const sea800 = Color(0xFF1D5179);
  static const sea900 = Color(0xFF1C4565);
  static const sea950 = Color(0xFF132C42);

  static const sun50 = Color(0xFFFFFAEB);
  static const sun100 = Color(0xFFFEF0C7);
  static const sun400 = Color(0xFFFBB724);
  static const sun500 = Color(0xFFF5960B);
  static const sun600 = Color(0xFFD97006);
  static const sun700 = Color(0xFFB44E09);

  static const coral400 = Color(0xFFF97970);
  static const coral500 = Color(0xFFEF4D43);
  static const coral600 = Color(0xFFDC2F25);
  static const coral700 = Color(0xFFB9241B);

  static const palm400 = Color(0xFF4BA368);
  static const palm500 = Color(0xFF2F8A4E);
  static const palm600 = Color(0xFF1F6F3D);

  static const sand50 = Color(0xFFFFFFFF);
  static const sand100 = Color(0xFFF6F5F3);
  static const sand200 = Color(0xFFE6E4E0);
  static const sand600 = Color(0xFFAD8544);
  static const sand700 = Color(0xFF8B6836);

  static const ink400 = Color(0xFF6B6357);
  static const ink500 = Color(0xFF585044);
  static const ink600 = Color(0xFF4E483F);
  static const ink700 = Color(0xFF35302A);
  static const ink800 = Color(0xFF221F1B);
  static const ink900 = Color(0xFF14120F);

  /// One gradient-pair per category, matching `categoryGradient()` in
  /// `place-kit.ts` (the first and last stop of each Tailwind gradient).
  static const Map<String, List<Color>> categoryGradients = {
    'landmarks': [sea500, sea800],
    'restaurants': [coral500, coral700],
    'fastfood': [sun600, sun700],
    'coffee': [sand600, sand700],
    'outdoors': [palm500, sea700],
    'shopping': [sun600, coral700],
    'culture': [sea600, ink800],
    'family': [palm500, palm600],
  };
}
