/// The call launcher — one control, used everywhere a call can start (the
/// /search box, /find's call half). It does the gesture work inside the tap:
/// haptic now, and the microphone prompt is the controller's first step, so the
/// system sees a user gesture rather than a timer.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../theme/colors.dart';
import '../widgets/layout.dart';
import '../widgets/svg.dart';
import 'call_controller.dart';
import 'config.dart';
import 'consent.dart';

class ShouqCallButton extends StatelessWidget {
  final double size;

  /// Runs after the call has been placed (e.g. /find moves on to /search,
  /// where every call's answer appears).
  final VoidCallback? onTapped;
  const ShouqCallButton({super.key, this.size = 32, this.onTapped});

  @override
  Widget build(BuildContext context) {
    if (!kAgentEnabled) return const SizedBox.shrink();
    final call = context.watch<CallController>();
    final ringing = call.active;
    Future<void> place() async {
      HapticFeedback.mediumImpact();
      // Asked once, before the microphone prompt — see ai/consent.dart.
      // A «مو الحين» leaves the call unplaced and the page where it was.
      if (!await ensureAiConsent(context)) return;
      call.start();
      onTapped?.call();
    }

    return Semantics(
      button: true,
      expanded: call.sheetOpen,
      label: 'كلّم شوق',
      child: HitArea(
        onTap: place,
        child: Material(
          color: ringing ? WainColors.coral600 : WainColors.sea600,
          shape: const CircleBorder(),
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: place,
            child: SizedBox(
              width: size,
              height: size,
              child: Center(
                // A call, not her face: the web's IconCall (handset + voice
                // arcs), so the button says that a tap places one.
                child: WainSvg.icon(
                  'call',
                  size: size * 0.5,
                  color: Colors.white,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
