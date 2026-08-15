import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Sporta brand — burnt orange UI (#E0561C) + logo orange (#FF7B17)
/// on charcoal (#171A1E) with a warm beige canvas (#E2DBCE).
class Brand {
  static const orange = Color(0xFFE0561C);
  static const orangeBright = Color(0xFFFF7B17);
  static const orangeDark = Color(0xFFB8430F);
  static const ink = Color(0xFF171A1E);
  static const inkSoft = Color(0xFF20252C);
  static const surfaceDark = Color(0xFF1B2026);
  static const sand = Color(0xFFE2DBCE);
  static const sandLight = Color(0xFFECE6DB);
}

ThemeData _base(Brightness b) {
  final dark = b == Brightness.dark;
  final scheme = ColorScheme.fromSeed(
    seedColor: Brand.orange,
    brightness: b,
  ).copyWith(
    primary: Brand.orange,
    onPrimary: Colors.white,
    surface: dark ? Brand.surfaceDark : Colors.white,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: dark ? Brand.ink : Brand.sand,
    // Changa for headings, IBM Plex Sans Arabic for body — both cover Arabic.
    textTheme: GoogleFonts.ibmPlexSansArabicTextTheme(
      ThemeData(brightness: b).textTheme,
    ).copyWith(
      displayLarge: GoogleFonts.changa(fontWeight: FontWeight.w800),
      headlineMedium: GoogleFonts.changa(fontWeight: FontWeight.w800),
      titleLarge: GoogleFonts.changa(fontWeight: FontWeight.w700),
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: Brand.ink,
      foregroundColor: Colors.white,
      elevation: 0,
      centerTitle: true,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: Brand.orange,
        foregroundColor: Colors.white,
        minimumSize: const Size(0, 48),
        shape: const StadiumBorder(),
        textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: Brand.orange,
        minimumSize: const Size(0, 48),
        shape: const StadiumBorder(),
        side: const BorderSide(color: Brand.orange, width: 1.5),
      ),
    ),
    cardTheme: CardTheme(
      color: dark ? Brand.surfaceDark : Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      clipBehavior: Clip.antiAlias,
    ),
  );
}

final lightTheme = _base(Brightness.light);
final darkTheme = _base(Brightness.dark);
