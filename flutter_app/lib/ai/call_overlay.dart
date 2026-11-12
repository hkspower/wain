/// The call sheet — full screen, like a phone's own call screen. It lives
/// above the router, not inside a page, because `open_place` is a route change
/// and a call the page owned would be killed by its own tool.
///
/// Honesty is the design: «يرن…» while dialling, «متصل» only once the session
/// really opened, the face pulses only while the agent is speaking, the
/// stopwatch sits OUTSIDE the announced region (a screen reader re-read it
/// every second — and until 11 November it was inside it after all, see the
/// region below), and because the sheet covers the page she just drove, it
/// says in words what she did there. It also covers the page for a screen
/// reader: `BlockSemantics`, or TalkBack walked the page under a sheet that
/// was drawn over it (14 October).
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';

import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/svg.dart';
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
    if (call.minimised) return _OnCallBar(call: call);
    if (!call.sheetOpen) return const SizedBox.shrink();
    return Positioned.fill(
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: kChromeOnDark,
        child: BlockSemantics(child: _Sheet(call: call)),
      ),
    );
  }
}

class _Sheet extends StatelessWidget {
  final CallController call;
  const _Sheet({required this.call});

  /// Her sentences, or his: name, greeting, status and failures.
  CallPersonaCopy get copy => call.persona.copy;

  String get _phaseWord => switch (call.phase) {
    CallPhase.ringing => CallCopy.ringing,
    CallPhase.live => CallCopy.onCall,
    CallPhase.answering => copy.answering,
    CallPhase.ended => CallCopy.ended,
    CallPhase.failed => call.error ?? copy.callFailed,
    CallPhase.idle => '',
  };

  /// What a screen reader is told of the phase. The word on screen, except
  /// while the AGENT speaks: that changes with every turn of an agent call,
  /// so «شوق ترد…» was read out each time she began to speak and «متصل» each
  /// time she stopped — turn-taking announced over her own voice (the web
  /// took the same out of its status on 23 September). The speaking state
  /// stays on screen, in the word and the ring round the face. The free call
  /// reaches «ترد…» once, as its answer goes up, and that is announced, as on
  /// the web.
  String get _announcedPhase => call.phase == CallPhase.answering && !call.local
      ? CallCopy.onCall
      : _phaseWord;

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
      child: _FitOrScroll(
        padding: EdgeInsets.fromLTRB(20, top + 16, 20, bottom + 16),
        child: Column(
          children: [
            // Put the sheet away without hanging up — the page she opened is
            // under it, and a phone's own call screen shrinks the same way.
            if (call.active)
              Align(
                alignment: AlignmentDirectional.centerStart,
                // No tooltip: the sheet sits above the navigator, so there
                // is no Overlay for one to float in. The label is the name.
                child: Semantics(
                  button: true,
                  label: CallCopy.minimise,
                  excludeSemantics: true,
                  child: IconButton(
                    key: const ValueKey('call-minimise'),
                    onPressed: call.minimise,
                    icon: const Icon(
                      Icons.keyboard_arrow_down_rounded,
                      color: Colors.white,
                      size: 30,
                    ),
                  ),
                ),
              ),
            Text(
              CallCopy.centre,
              style: wainText(WainText.sm, color: WainColors.sand300),
            ),
            const SizedBox(height: 4),
            // The ONE announced region: the phase word. The clock is a sibling.
            // A node of its own (`container`), or the flag merges up into the
            // sheet's node and the region is the whole sheet, clock included:
            // it did until 11 November, so the announced text changed every
            // second of a call. Its label is [_announcedPhase], not the word
            // on screen.
            Semantics(
              container: true,
              liveRegion: true,
              label: _announcedPhase,
              excludeSemantics: true,
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
            _Face(
              speaking: speaking,
              ringing: call.phase == CallPhase.ringing,
              image: copy.face,
            ),
            const SizedBox(height: 20),
            Text(
              copy.name,
              style: wainText(
                WainText.s3xl,
                weight: FontWeight.w700,
                color: Colors.white,
              ),
            ),
            Text(
              copy.role,
              style: wainText(WainText.sm, color: WainColors.sand300),
            ),
            const SizedBox(height: 16),
            if (call.phase == CallPhase.ringing)
              Text(
                copy.greeting,
                textAlign: TextAlign.center,
                style: wainText(
                  WainText.base,
                  color: WainColors.sand100,
                  height: 1.7,
                ),
              )
            else if (live) ...[
              // The free call shows what it has heard as it hears it — the
              // web's sheet does the same with its transcript. Until then it
              // asks, because there the caller speaks first. On an agent call
              // the agent does (its greeting), so «قول وش تبي…» told the
              // caller to talk over it: that sheet says the line is open, as
              // the web's has since 1 October (11 November here).
              Text(
                call.heard.isNotEmpty
                    ? call.heard
                    : (call.local ? CallCopy.listening : copy.onTheLine),
                key: const ValueKey('call-heard'),
                textAlign: TextAlign.center,
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
                // Its own node, for the same reason as the phase word's.
                container: true,
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
              const SizedBox(height: 8),
              _RoundButton(
                key: const ValueKey('call-hangup'),
                color: WainColors.coral600,
                icon: Icons.call_end,
                label: CallCopy.hangUp,
                onTap: call.hangUp,
              ),
            ],
            // A refusal the app can no longer ask about: only Settings undoes
            // it, so the way there is a button, not just a sentence. The same
            // for a phone that cannot listen (the speech permission is its
            // own switch on iOS), which was a dead end until 14 October — and
            // that one also offers the question typed, to سالم.
            if (call.phase == CallPhase.failed &&
                (call.error == CallCopy.micBlocked ||
                    call.error == CallCopy.speechUnavailable)) ...[
              FilledButton(
                key: const ValueKey('call-open-settings'),
                onPressed: openAppSettings,
                style: FilledButton.styleFrom(
                  backgroundColor: WainColors.sun300,
                  foregroundColor: WainColors.ink900,
                  minimumSize: const Size(220, 48),
                ),
                child: Text(
                  CallCopy.openSettings,
                  style: wainText(WainText.base, weight: FontWeight.w600),
                ),
              ),
              const SizedBox(height: 8),
            ],
            if (call.phase == CallPhase.failed &&
                call.error == CallCopy.speechUnavailable) ...[
              FilledButton(
                key: const ValueKey('call-type-salem'),
                onPressed: call.typeToSalem,
                style: FilledButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: WainColors.ink900,
                  minimumSize: const Size(220, 48),
                ),
                child: Text(
                  CallCopy.typeToSalem,
                  style: wainText(WainText.base, weight: FontWeight.w600),
                ),
              ),
              const SizedBox(height: 8),
            ],
            if (over) ...[
              // The place the call put on screen, one tap from its last
              // screen — the web's ended sheet has had it since 3 October.
              if (call.lastSlug != null) ...[
                FilledButton.icon(
                  key: const ValueKey('call-share-last'),
                  onPressed: call.shareLastPlace,
                  style: FilledButton.styleFrom(
                    backgroundColor: WainColors.coral600,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(220, 48),
                  ),
                  icon: WainSvg.icon('send', size: 16, color: Colors.white),
                  label: Text(
                    CallCopy.shareLast,
                    style: wainText(
                      WainText.base,
                      weight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                ),
                const SizedBox(height: 8),
              ],
              // The same question, typed, with سالم — switching used to mean
              // starting over (the web's last screen has the same button). Her
              // calls only: see CallController.canContinueWithSalem.
              if (call.canContinueWithSalem) ...[
                FilledButton(
                  key: const ValueKey('call-to-salem'),
                  onPressed: call.continueWithSalem,
                  style: FilledButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: WainColors.ink900,
                    minimumSize: const Size(220, 48),
                  ),
                  child: Text(
                    CallCopy.toSalem,
                    style: wainText(WainText.base, weight: FontWeight.w600),
                  ),
                ),
                const SizedBox(height: 8),
              ],
              FilledButton(
                key: const ValueKey('call-again'),
                // Redials whoever this call was with.
                onPressed: () => call.start(persona: call.persona),
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
                  copy.micNote,
                  style: wainText(WainText.xs, color: WainColors.sand300),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The sheet's column: the height of the screen when it fits, as it always
/// was, and scrollable when it does not. It was a fixed column, and what the
/// agent did is a line that can wrap — with the two place names it takes a
/// second line, which on a 320×568 phone made the column 15px taller than
/// the screen (measured, 11 November; while she spoke it had already been
/// 1.4px over). The web's sheet has `overflow-y-auto` as «the safety net for
/// a short screen»; this is the same net. `IntrinsicHeight` is what lets the
/// column's spacers go on sharing the spare room inside a scroll view.
class _FitOrScroll extends StatelessWidget {
  final EdgeInsets padding;
  final Widget child;
  const _FitOrScroll({required this.padding, required this.child});

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, box) => SingleChildScrollView(
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: box.maxHeight),
          child: IntrinsicHeight(
            child: Padding(padding: padding, child: child),
          ),
        ),
      ),
    );
  }
}

/// The call, shrunk: a bar under the status bar for as long as it goes on
/// with its sheet put away. Under the status bar rather than at the foot,
/// because the foot is the tab bar on a tab and the message box on /salem.
class _OnCallBar extends StatelessWidget {
  final CallController call;
  const _OnCallBar({required this.call});

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    final label = call.phase == CallPhase.ringing
        ? CallCopy.ringing
        : '${call.persona.copy.name} · ${_clock(call.elapsed)}';
    return Positioned(
      top: top + 6,
      left: 0,
      right: 0,
      child: Center(
        child: Semantics(
          button: true,
          label: '${CallCopy.backToCall} — $label',
          excludeSemantics: true,
          child: Material(
            key: const ValueKey('call-bar'),
            color: WainColors.palm600,
            elevation: 3,
            shape: const StadiumBorder(),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: call.restore,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 48),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 18),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.call, color: Colors.white, size: 18),
                      const SizedBox(width: 8),
                      Text(
                        label,
                        style: wainText(
                          WainText.sm,
                          weight: FontWeight.w600,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Text(
                        CallCopy.backToCall,
                        style: wainText(
                          WainText.xs,
                          color: Colors.white.withValues(alpha: 0.85),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
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

/// Her face, or his. The ring moves ONLY while the agent is actually speaking —
/// an animation that is always on carries no information while looking exactly
/// like one that does. While dialling it breathes, slowly.
class _Face extends StatefulWidget {
  final bool speaking;
  final bool ringing;

  /// The picture: the persona's own (CallPersonaCopy.face).
  final String image;
  const _Face({
    required this.speaking,
    required this.ringing,
    required this.image,
  });

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
          key: ValueKey(widget.speaking ? 'call-face-speaking' : 'call-face'),
          width: 148 * (1 + pulse),
          height: 148 * (1 + pulse),
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(
              color: widget.speaking ? WainColors.palm400 : Colors.white24,
              width: widget.speaking ? 4 : 2,
            ),
            image: DecorationImage(
              image: AssetImage(widget.image),
              fit: BoxFit.cover,
            ),
          ),
        );
      },
    );
  }
}
