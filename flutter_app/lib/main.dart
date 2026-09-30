import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

import 'screens/home_screen.dart';
import 'theme/colors.dart';

void main() {
  runApp(const WainApp());
}

class WainApp extends StatelessWidget {
  const WainApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'وين',
      debugShowCheckedModeBanner: false,
      // Arabic throughout, right-to-left, the same as the web site — there is
      // no English UI here to fall back to.
      locale: const Locale('ar'),
      supportedLocales: const [Locale('ar')],
      localizationsDelegates: const [
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: WainColors.sea500,
          primary: WainColors.sea600,
          secondary: WainColors.sun500,
          surface: Colors.white,
        ),
        scaffoldBackgroundColor: Colors.white,
        appBarTheme: const AppBarTheme(
          backgroundColor: Colors.white,
          foregroundColor: WainColors.ink900,
          elevation: 0,
        ),
        cardTheme: CardThemeData(
          elevation: 0,
          color: WainColors.sand100,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
            side: const BorderSide(color: WainColors.sand200),
          ),
        ),
      ),
      builder: (context, child) => Directionality(
        textDirection: TextDirection.rtl,
        child: child!,
      ),
      home: const HomeScreen(),
    );
  }
}
