/// The call launcher: /find's call half, on the phone it draws (hers), and —
/// through [placeCall], the same tap — سالم's header on his chat (his, since
/// 14 October on his own agent). It does the gesture work inside the tap:
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

  /// The resting colour. /find's phone draws it green, as a phone's own call
  /// button is; a call in progress is coral everywhere.
  final Color color;
  const ShouqCallButton({
    super.key,
    this.size = 32,
    this.onTapped,
    this.color = WainColors.sea600,
  });

  @override
  Widget build(BuildContext context) {
    // Always shown: without an agent the call is the free one
    // (local_session.dart), not no call at all.
    final call = context.watch<CallController>();
    final ringing = call.active;
    Future<void> place() => placeCall(context, onTapped: onTapped);

    return Semantics(
      button: true,
      expanded: call.sheetOpen,
      label: 'كلّم شوق',
      child: HitArea(
        onTap: place,
        child: Material(
          color: ringing ? WainColors.coral600 : color,
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

/// The tap that places a call, whichever persona it is with: her button's, and
/// سالم's header's, so the two cannot drift apart.
Future<void> placeCall(
  BuildContext context, {
  CallPersona persona = CallPersona.shouq,
  VoidCallback? onTapped,
}) async {
  final call = context.read<CallController>();
  HapticFeedback.mediumImpact();
  // Asked once, before the microphone prompt — see ai/consent.dart — and only
  // when that persona's agent is recording the call. A free call keeps nothing
  // anywhere, so there is nothing to agree to. A «مو الحين» leaves the call
  // unplaced and the page where it was.
  if (!call.isFree(persona) && !await ensureAiConsent(context)) return;
  call.start(persona: persona);
  onTapped?.call();
}
