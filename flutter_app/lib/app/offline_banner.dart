/// A quiet strip under the status bar while the phone has no network, saying
/// what still works. Above the router, so it is on every screen, and it takes
/// the status bar's inset with it so the page below does not pad twice.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../theme/app_theme.dart';
import '../theme/colors.dart';
import 'online.dart';

const kOfflineLine = 'ما فيه إنترنت — الأماكن والبحث شغّالة';

class OfflineFrame extends StatelessWidget {
  final Widget child;
  const OfflineFrame({super.key, required this.child});

  @override
  Widget build(BuildContext context) {
    final offline = Provider.of<Online?>(context)?.offline ?? false;
    if (!offline) return child;
    final top = MediaQuery.paddingOf(context).top;
    return Column(
      children: [
        Material(
          key: const ValueKey('offline-banner'),
          color: WainColors.sun100,
          child: Padding(
            padding: EdgeInsets.fromLTRB(16, top + 6, 16, 6),
            child: SizedBox(
              width: double.infinity,
              child: Semantics(
                liveRegion: true,
                child: Text(
                  kOfflineLine,
                  textAlign: TextAlign.center,
                  style: wainText(
                    WainText.xs,
                    weight: FontWeight.w600,
                    color: WainColors.ink900,
                  ),
                ),
              ),
            ),
          ),
        ),
        Expanded(
          child: MediaQuery.removePadding(
            context: context,
            removeTop: true,
            child: child,
          ),
        ),
      ],
    );
  }
}
