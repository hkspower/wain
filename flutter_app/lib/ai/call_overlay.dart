/// The call sheet — full screen, like a phone's own call screen. It lives
/// above the router, not inside a page, because `open_place` is a route change
/// and a call the page owned would be killed by its own tool.
///
/// Honesty is the design: «يرن…» while dialling, «متصل» only once the session
/// really opened, her mouth and orb animate only while she is speaking, the
/// stopwatch sits OUTSIDE the announced region (a screen reader re-read it
/// every second), and because the sheet covers the page she just drove, it
/// says in words what she did there.
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../theme/app_theme.dart';
import '../theme/colors.dart';
import 'call_controller.dart';
import 'config.dart';

String _clock(Duration d) {
  String two(int n) => n.toString().padLeft(2, '0');
  const digits = '٠١٢٣٤٥٦٧٨٩';
  final s = '${two(d.inMinutes)}:${two(d.inSeconds % 60)}';
  return s
      .split('')
      .map((c) => int.tryParse(c) == null ? c : digits[int.parse(c)])
      .join();
}

class CallOverlay extends StatelessWidget {
  const CallOverlay({super.key});

  @override
  Widget build(BuildContext context) {
    final call = context.watch<CallController>();
    if (!call.sheetOpen) return const SizedBox.shrink();
    return Positioned.fill(child: _Sheet(call: call));
  }
}

class _Sheet extends StatelessWidget {
  final CallController call;
  const _Sheet({required this.call});

  String get _phaseWord => switch (call.phase) {
    CallPhase.ringing => CallCopy.ringing,
    CallPhase.live => CallCopy.onCall,
    CallPhase.answering => CallCopy.answering,
    CallPhase.ended => CallCopy.ended,
    CallPhase.failed => call.error ?? CallCopy.callFailed,
    CallPhase.idle => '',
  };

  Color get _tone => switch (call.phase) {
    CallPhase.live || CallPhase.answering => WainColors.palm400,
    CallPhase.failed => WainColors.coral400,
    _ => WainColors.sun300,
  };

  @override
  Widget build(BuildContext context) {
    final speaking = call.phase == CallPhase.answering;
    final live = call.phase == CallPhase.live || speaking;
    final over =
        call.phase == CallPhase.ended || call.phase == CallPhase.failed;
    final top = MediaQuery.paddingOf(context).top;
    final bottom = MediaQuery.paddingOf(context).bottom;

    return Material(
      key: const ValueKey('call-sheet'),
      color: WainColors.ink900,
      child: Padding(
        padding: EdgeInsets.fromLTRB(20, top + 16, 20, bottom + 16),
        child: Column(
          children: [
            Text(
              CallCopy.centre,
              style: wainText(WainText.sm, color: WainColors.sand300),
            ),
            const SizedBox(height: 4),
            // The ONE announced region: the phase word. The clock is a sibling.
            Semantics(
              liveRegion: true,
              child: Text(
                _phaseWord,
                key: const ValueKey('call-phase'),
                textAlign: TextAlign.center,
                style: wainText(
                  WainText.base,
                  weight: FontWeight.w600,
                  color: _tone,
                ),
              ),
            ),
            if (live || call.phase == CallPhase.ended)
              Text(
                _clock(call.elapsed),
                key: const ValueKey('call-clock'),
                style: wainText(WainText.sm, color: WainColors.sand300),
              ),
            const Spacer(),
            _Face(speaking: speaking, ringing: call.phase == CallPhase.ringing),
            const SizedBox(height: 20),
            Text(
              CallCopy.name,
              style: wainText(
                WainText.s3xl,
                weight: FontWeight.w700,
                color: Colors.white,
              ),
            ),
            Text(
              CallCopy.role,
              style: wainText(WainText.sm, color: WainColors.sand300),
            ),
            const SizedBox(height: 16),
            if (call.phase == CallPhase.ringing)
              Text(
                CallCopy.greeting,
                textAlign: TextAlign.center,
                style: wainText(
                  WainText.base,
                  color: WainColors.sand100,
                  height: 1.7,
                ),
              )
            else if (live) ...[
              Text(
                CallCopy.listening,
                style: wainText(
                  WainText.lg,
                  weight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                CallCopy.listeningExamples,
                style: wainText(WainText.sm, color: WainColors.sand300),
              ),
            ],
            // What she did to the page that is now behind this sheet.
            if (call.lastAction != null) ...[
              const SizedBox(height: 14),
              Semantics(
                liveRegion: true,
                child: Container(
                  key: const ValueKey('call-last-action'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(99),
                  ),
                  child: Text(
                    call.lastAction!,
                    style: wainText(
                      WainText.sm,
                      weight: FontWeight.w600,
                      color: WainColors.sun200,
                    ),
                  ),
                ),
              ),
            ],
            const Spacer(),
            if (call.phase == CallPhase.ringing || live) ...[
              if (live)
                TextButton(
                  key: const ValueKey('call-switch-voice'),
                  onPressed: call.switchVoice,
                  child: Text(
                    call.salemVoice
                        ? CallCopy.switchToShouq
                        : CallCopy.switchToSalem,
                    style: wainText(
                      WainText.sm,
                      weight: FontWeight.w600,
                      color: WainColors.sand100,
                    ),
                  ),
                ),
              const SizedBox(height: 8),
              _RoundButton(
                key: const ValueKey('call-hangup'),
                color: WainColors.coral600,
                icon: Icons.call_end,
                label: CallCopy.hangUp,
                onTap: call.hangUp,
              ),
            ],
            if (over) ...[
              FilledButton(
                key: const ValueKey('call-again'),
                onPressed: () => call.start(),
                style: FilledButton.styleFrom(
                  backgroundColor: WainColors.sea600,
                  minimumSize: const Size(220, 48),
                ),
                child: Text(
                  CallCopy.callAgain,
                  style: wainText(
                    WainText.base,
                    weight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
              ),
              const SizedBox(height: 8),
              TextButton(
                key: const ValueKey('call-close'),
                onPressed: call.closeSheet,
                child: Text(
                  CallCopy.close,
                  style: wainText(WainText.base, color: WainColors.sand100),
                ),
              ),
            ],
            if (call.phase == CallPhase.ringing)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Text(
                  CallCopy.micNote,
                  style: wainText(WainText.xs, color: WainColors.sand300),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _RoundButton extends StatelessWidget {
  final Color color;
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _RoundButton({
    super.key,
    required this.color,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: color,
        shape: const CircleBorder(),
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: SizedBox(
            width: 68,
            height: 68,
            child: Icon(icon, color: Colors.white, size: 30),
          ),
        ),
      ),
    );
  }
}

/// Her face. The mouth/orb moves ONLY while she is actually speaking — an
/// animation that is always on carries no information while looking exactly
/// like one that does. While dialling it breathes, slowly.
class _Face extends StatefulWidget {
  final bool speaking;
  final bool ringing;
  const _Face({required this.speaking, required this.ringing});

  @override
  State<_Face> createState() => _FaceState();
}

class _FaceState extends State<_Face> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 900),
  )..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final calm = MediaQuery.disableAnimationsOf(context);
    return AnimatedBuilder(
      animation: _c,
      builder: (_, _) {
        final t = calm ? 0.0 : _c.value;
        final pulse = widget.speaking
            ? 0.10 * t
            : (widget.ringing ? 0.04 * t : 0.0);
        return Container(
          key: ValueKey(widget.speaking ? 'shouq-face-speaking' : 'shouq-face'),
          width: 148 * (1 + pulse),
          height: 148 * (1 + pulse),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
              color: widget.speaking ? WainColors.palm400 : Colors.white24,
              width: widget.speaking ? 4 : 2,
            ),
            image: const DecorationImage(
              image: AssetImage('assets/img/shouq-face.jpg'),
              fit: BoxFit.cover,
            ),
          ),
        );
      },
    );
  }
}
