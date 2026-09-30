import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/layout.dart';

/// The site's 404 — «وين رايح؟» — for an unknown route or place.
class NotFoundScreen extends StatelessWidget {
  const NotFoundScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: PageColumn(
          child: Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'وين رايح؟',
                  style: wainText(
                    WainText.s5xl,
                    weight: FontWeight.w700,
                    color: WainColors.ink900,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  'هالصفحة مو موجودة.',
                  style: wainText(WainText.base, color: WainColors.ink500),
                ),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: () => context.go('/'),
                  style: FilledButton.styleFrom(
                    backgroundColor: WainColors.ink900,
                  ),
                  child: const Text('الرئيسية'),
                ),
                TextButton(
                  onPressed: () => context.go('/explore'),
                  child: const Text('استكشف الأماكن'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
