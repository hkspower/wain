import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../ai/config.dart';
import '../ai/salem_transcript.dart';
import '../app/app_state.dart';
import '../app/online.dart';
import '../ai/salem_chat.dart';
import '../ai/tools.dart';
import '../data/catalogue.dart';
import '../data/models.dart';
import '../data/places.g.dart';
import '../data/answer_order.dart' show AnswerClock, kuwaitClock;
import '../data/salem_followup.dart';
import '../data/voice_lines.dart';
import '../map/wain_map.dart';
import '../share/directions.dart';
import '../share/hangout.dart' show kChoiceMax;
import '../share/hangout_panel.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../voice/voice_service.dart';
import '../widgets/back_fab.dart';
import '../widgets/place_card.dart';
import '../widgets/svg.dart';
import '../widgets/typing_dots.dart';

/// The typed conversation with سالم. Same agent, same prompt, same tools; text
/// only. `show_places` / `open_place` put REAL place cards in the transcript
/// instead of navigating — this screen IS the conversation, and a route
/// change would close the socket mid-sentence.
///
/// «سالم، شوق، الطلعة والخريطة كلها وحدة» (3 October, mirrored from the web's
/// SalemChat.tsx): the free answer remembers what it said
/// (data/salem_followup.dart), so «أرخص», «غيره», «الثاني» and «وين بالضبط؟»
/// answer the last answer; each answer carries its cards, a map of its own,
/// a way to the full search and the share panel, all pointing at one place;
/// the transcript survives leaving the screen (ai/salem_transcript.dart); a
/// question handed over from elsewhere is asked as the visitor's own; and his
/// replies can be read aloud in his voice.
class SalemScreen extends StatefulWidget {
  /// Tests inject a socket factory; the app uses the real one.
  final ChannelFactory? connect;

  /// The agent to talk to; null reads the build's (config.dart). Empty — the
  /// live app since 2 October — is the free chat: سالم answers from the
  /// app's own search, with nothing sent anywhere.
  final String? agentId;

  /// A question handed over from somewhere else — «كمّل مع سالم» on the
  /// search screen's answer, «اسأل سالم» on an invitation or a shortlist —
  /// asked once, as the visitor's own message (`/salem?q=…`).
  final String? initialQuery;

  /// Kuwait's month and hour; tests pin them, the app reads the clock.
  final AnswerClock Function()? clock;

  const SalemScreen({
    super.key,
    this.connect,
    this.agentId,
    this.initialQuery,
    this.clock,
  });

  @override
  State<SalemScreen> createState() => _SalemScreenState();
}

class _SalemScreenState extends State<SalemScreen> {
  List<ChatLine> _entries = [];

  /// The memory: what the last answer was, and which of its places the
  /// visitor last pointed at (a pin, a card or the share panel), for
  /// «وين بالضبط؟».
  ChatContext? _ctx;
  String? _active;

  /// The first line of the latest reply: a reply is a sentence, then its
  /// cards, its map and its share panel — taller than a small phone — so it
  /// is shown from where it STARTS, as on the web (3 October).
  ChatLine? _replyStart;
  final _replyKey = GlobalKey();
  final _listKey = GlobalKey();

  /// Captured once: dispose cannot look a provider up.
  VoiceService? _voice;
  AppState? _app;

  /// The handed-over question, until it has been asked.
  String? _handoff;
  final _input = TextEditingController();
  final _scroll = ScrollController();
  ChatStatus _status = ChatStatus.connecting;
  ChatHandle? _handle;

  /// A reply is on its way: from the moment the line opens until her
  /// greeting, and from every message until her answer. A tool call does not
  /// end it — she answers after the tool. Bounded like the web's, so a reply
  /// that never comes says so instead of leaving the dots up for ever.
  bool _waiting = false;
  Timer? _waitTimer;
  static const _waitLimit = Duration(seconds: 45);

  void _wait(bool on) {
    _waitTimer?.cancel();
    _waitTimer = on
        ? Timer(_waitLimit, () {
            if (!mounted || !_waiting) return;
            setState(() => _waiting = false);
            _add(ChatText('system', ChatCopy.noReply));
          })
        : null;
    if (mounted && _waiting != on) setState(() => _waiting = on);
  }

  /// No session opens until the visitor has agreed to what happens to the
  /// conversation (ai/consent.dart): opening the socket already starts a
  /// recorded conversation, before a word is typed.
  bool _awaitingConsent = false;

  bool get _free => (widget.agentId ?? kAgentId).isEmpty;

  @override
  void initState() {
    super.initState();
    _voice = Provider.of<VoiceService?>(context, listen: false);
    _app = Provider.of<AppState?>(context, listen: false);
    final q = widget.initialQuery?.trim() ?? '';
    if (q.isNotEmpty) _handoff = q.length > 120 ? q.substring(0, 120) : q;
    if (_free) {
      // Nothing to connect to and nothing recorded, so nothing to agree to:
      // he greets in words this screen owns, and the box works at once. Or
      // the conversation is back where it was (ai/salem_transcript.dart).
      _status = ChatStatus.connected;
      final kept = SalemTranscript.instance;
      if (kept.lines.isNotEmpty) {
        _entries = kept.restore();
        _ctx = kept.context;
      } else {
        _entries.add(ChatText('agent', ChatCopy.freeGreeting));
      }
      WidgetsBinding.instance.addPostFrameCallback((_) => _askHandoff());
      return;
    }
    if (context.read<AppState>().aiConsent) {
      _connect();
    } else {
      _awaitingConsent = true;
    }
  }

  void _agree() {
    context.read<AppState>().setAiConsent(true);
    setState(() => _awaitingConsent = false);
    _connect();
  }

  /// No network when the chat tried to open: said at once, not after the
  /// twelve-second connect timeout. «ابدأ من جديد» tries again.
  bool _offline = false;

  /// The server said he is unavailable (out of credits): said as it is, and
  /// the retry comes back only after a wait — at once it could only meet the
  /// same refusal. The web's UNAVAILABLE_RETRY_MS.
  bool _unavailable = false;
  bool _retryReady = true;
  Timer? _retryTimer;
  static const _retryWait = Duration(seconds: 30);

  void _connect() {
    _handle?.close();
    if (Provider.of<Online?>(context, listen: false)?.offline ?? false) {
      setState(() {
        _offline = true;
        _status = ChatStatus.error;
      });
      return;
    }
    _retryTimer?.cancel();
    setState(() {
      _offline = false;
      _unavailable = false;
      _retryReady = true;
      _status = ChatStatus.connecting;
      if (_entries.isNotEmpty) _entries.clear();
    });
    _handle = startSalemChat(
      agentId: widget.agentId,
      connect:
          widget.connect ?? (uri, protocols) => defaultChannel(uri, protocols),
      onStatus: (s) {
        if (!mounted) return;
        setState(() => _status = s);
        // She speaks first: connected means her greeting is on its way.
        _wait(s == ChatStatus.connected);
      },
      onMessage: (m) {
        if (m.role == 'agent') _wait(false);
        _add(ChatText(m.role, m.text));
        // His reply in his voice — the agent's own audio is off on this
        // channel.
        if (m.role == 'agent') {
          _readAloud([SpeechPart(text: m.text)]);
          // The handed-over question goes after her greeting.
          _askHandoff();
        }
      },
      onToolUnavailable: () =>
          _add(ChatText('system', ChatCopy.toolUnavailable)),
      onUnavailable: () {
        if (!mounted) return;
        setState(() {
          _unavailable = true;
          _retryReady = false;
        });
        _retryTimer?.cancel();
        _retryTimer = Timer(_retryWait, () {
          if (mounted) setState(() => _retryReady = true);
        });
      },
      clientTools: {
        'show_places': (p) {
          final q = '${p['query'] ?? ''}'.trim();
          final r = showPlacesForChat(q, searchIndex, kPlaces);
          _add(ChatPlaces(q, r.slugs));
          return r.spoken;
        },
        'open_place': (p) {
          final r = openPlaceForChat('${p['slug'] ?? ''}', kPlaces);
          if (r.place != null) _add(ChatPlace(r.place!.slug));
          return r.spoken;
        },
      },
    );
  }

  void _add(ChatLine e) {
    if (!mounted) return;
    setState(() => _entries.add(e));
    _keep();
    _toNewest();
  }

  /// The free chat's transcript, kept for the running app.
  void _keep() {
    if (_free) SalemTranscript.instance.save(_entries, _ctx);
  }

  /// Shows the latest reply from its first line when it is taller than the
  /// transcript: scrolled to the newest end, a reply's sentence sat above the
  /// screen and the visitor met a share panel (the web's 320×568 finding).
  Future<void> _revealReply() async {
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted || !_scroll.hasClients) return;
    if (_scroll.offset != 0) {
      _scroll.jumpTo(0);
      await WidgetsBinding.instance.endOfFrame;
    }
    // The reply's first line may sit further up than the list builds ahead
    // of the screen: walk up to it, a screen at a time, then align it.
    for (var tries = 0; tries < 6; tries++) {
      if (!mounted || !_scroll.hasClients) return;
      final row = _replyKey.currentContext?.findRenderObject();
      final list = _listKey.currentContext?.findRenderObject();
      final pos = _scroll.position;
      if (row is RenderBox && list is RenderBox && row.attached) {
        final top = row.localToGlobal(Offset.zero, ancestor: list).dy;
        if (top >= 8) return;
        // A reversed list: a larger offset brings older lines down into view.
        final target = (pos.pixels + 8 - top).clamp(0.0, pos.maxScrollExtent);
        if (MediaQuery.of(context).disableAnimations || tries > 0) {
          _scroll.jumpTo(target);
        } else {
          await _scroll.animateTo(
            target,
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeOut,
          );
        }
        return;
      }
      if (pos.pixels >= pos.maxScrollExtent) return;
      _scroll.jumpTo(
        (pos.pixels + pos.viewportDimension * 0.8).clamp(
          0.0,
          pos.maxScrollExtent,
        ),
      );
      await WidgetsBinding.instance.endOfFrame;
    }
  }

  void _readAloud(List<SpeechPart> parts) {
    if (parts.isEmpty || !context.read<AppState>().salemReadAloud) return;
    _voice?.speak(parts, persona: PersonaId.salem);
  }

  void _toggleReadAloud() {
    final state = context.read<AppState>();
    final on = !state.salemReadAloud;
    HapticFeedback.selectionClick();
    if (!on) _voice?.stop();
    state.setSalemReadAloud(on);
  }

  /// The handed-over question, once the chat can take it: at once in the free
  /// chat, after her greeting on a socket.
  void _askHandoff() {
    final q = _handoff;
    if (q == null || !mounted) return;
    if (_status != ChatStatus.connected || _waiting) return;
    _handoff = null;
    _submit(q);
  }

  /// The transcript is a REVERSED list — offset 0 is the newest end — so a
  /// reply that arrives is already in view, at the bottom, the way a
  /// messaging app holds its thread. It was a forward list scrolled to
  /// `maxScrollExtent` after every reply, and that number is an estimate in a
  /// lazy list, cancelled by the next reply, and taken before a new row has
  /// grown in: fourteen replies in, the screen showed the third to the sixth
  /// and her newest answer was off screen — the app's half of «she did not
  /// answer», 1 October. Coming back down is now one exact number.
  void _toNewest() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scroll.hasClients || _scroll.offset <= 0) return;
      _scroll.animateTo(
        0,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    });
  }

  /// The keyboard opening shrinks the transcript from below, so the newest
  /// message — the one being answered — slid under the input. It follows the
  /// keyboard up now, the way a messaging app does.
  double _lastInset = 0;

  void _send() {
    if (_submit(_input.text)) _input.clear();
  }

  /// A message, typed or tapped (a chip, the handed-over question).
  bool _submit(String raw) {
    final text = raw.trim();
    if (text.isEmpty || _status != ChatStatus.connected || _waiting) {
      return false;
    }
    HapticFeedback.lightImpact();
    if (_free) {
      _add(ChatText('user', text));
      _answerLocally(text);
      return true;
    }
    _handle?.send(text);
    _add(ChatText('user', text));
    _wait(true);
    return true;
  }

  /// The free chat's reply: our own search, our own words, no wire — read
  /// against the last answer first (data/salem_followup.dart), so «أرخص»,
  /// «غيره» and «وين بالضبط؟» answer what he just said instead of starting
  /// again. The order is /search's (`answerOrder`) and the sentence is the
  /// free call's (`answerParts`), so the free paths agree about the same
  /// place. Mirrors SalemChat.tsx's `answerLocally`.
  void _answerLocally(String q) {
    final clock = (widget.clock ?? kuwaitClock)();
    final ctx = _ctx;
    final intent = readFollowUp(q, ctx, _active);
    final lines = <ChatLine>[];
    var parts = <SpeechPart>[];

    List<SpeechPart> placeParts(Place p) => [
      SpeechPart(key: 'try-${p.slug}', text: placeTryLine(p)),
      ...whenParts(p, clock.month, clock.hour),
    ];
    String said(List<SpeechPart> ps) => ps.map((p) => p.text).join(' ');

    // Cards for a list of slugs, and the memory and the chips that go with
    // them.
    void showList(
      String query,
      List<String> slugs,
      List<String> ranked,
      List<String> seen,
      List<SpeechPart> spoken,
    ) {
      final next = ChatContext(
        query: query,
        ranked: ranked,
        seen: seen,
        shown: slugs,
      );
      final shown = [for (final s in slugs) ?getPlace(s)];
      lines.add(
        ChatPlaces(
          query,
          slugs,
          followUpChips(next, shown, month: clock.month, hour: clock.hour),
        ),
      );
      _ctx = next;
      _active = null;
      parts = spoken;
    }

    if (ctx != null && intent.kind == FollowUpKind.more) {
      final slugs = nextPlaces(ctx);
      if (slugs.isEmpty) {
        lines.add(ChatText('agent', ChatCopy.moreNone));
      } else {
        final spoken = placeParts(getPlace(slugs.first)!);
        lines.add(ChatText('agent', '${ChatCopy.moreIntro} ${said(spoken)}'));
        showList(ctx.query, slugs, ctx.ranked, [...ctx.seen, ...slugs], spoken);
      }
    } else if (intent.kind == FollowUpKind.pick ||
        intent.kind == FollowUpKind.where) {
      final place = getPlace(intent.slug!)!;
      _active = place.slug;
      if (intent.kind == FollowUpKind.pick) {
        parts = placeParts(place);
        lines.add(ChatText('agent', said(parts)));
        lines.add(ChatPlace(place.slug));
      } else {
        parts = [SpeechPart(text: '${place.nameAr} — ${place.areaAr}.')];
        lines.add(ChatText('agent', '${parts.first.text} ${ChatCopy.where}'));
        lines.add(ChatWhere(place.slug));
      }
    } else {
      final query = intent.query ?? q;
      final ranked = chatRanked(query, searchIndex, kPlaces, clock);
      if (ranked.isEmpty && intent.kind == FollowUpKind.refine && ctx != null) {
        // Nothing fits both — say so, and leave the last answer where it is
        // rather than replacing it with the dead end.
        lines.add(ChatText('agent', ChatCopy.refineNone));
      } else if (ranked.isEmpty) {
        lines.add(ChatText('agent', ChatCopy.freeEmpty));
        _ctx = null;
      } else {
        final slugs = ranked.take(8).toList();
        final found = [for (final s in slugs) ?getPlace(s)];
        final spoken = answerParts(
          found.map((p) => p.nameAr).toList(),
          found,
          month: clock.month,
          hour: clock.hour,
        );
        lines.add(ChatText('agent', said(spoken)));
        showList(query, slugs, ranked, slugs, spoken);
      }
    }
    if (!mounted) return;
    setState(() {
      _replyStart = lines.first;
      _entries.addAll(lines);
    });
    _keep();
    _revealReply();
    _readAloud(parts);
  }

  @override
  void dispose() {
    // Leaving the chat should not leave him talking.
    if (_app?.salemReadAloud ?? false) _voice?.stop();
    _waitTimer?.cancel();
    _retryTimer?.cancel();
    _handle?.close();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  String get _statusText => _awaitingConsent
      ? AiPrivacyCopy.waiting
      : switch (_status) {
          ChatStatus.connecting => ChatCopy.connecting,
          ChatStatus.connected =>
            _free ? ChatCopy.freeStatus : ChatCopy.connected,
          ChatStatus.disconnected => ChatCopy.disconnected,
          ChatStatus.error =>
            _offline
                ? ChatCopy.offline
                : _unavailable
                ? ChatCopy.unavailableStatus
                : ChatCopy.failed,
        };

  @override
  Widget build(BuildContext context) {
    final connected = _status == ChatStatus.connected;
    final over =
        _status == ChatStatus.disconnected || _status == ChatStatus.error;
    final inset = MediaQuery.viewInsetsOf(context).bottom;
    if (inset > _lastInset) _toNewest();
    _lastInset = inset;
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: kChromeOnDark,
      child: Scaffold(
        backgroundColor: WainColors.sea950,
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(8, 8, 12, 8),
                child: Row(
                  children: [
                    const BackFab(fallback: '/find'),
                    const SizedBox(width: 8),
                    const CircleAvatar(
                      radius: 20,
                      backgroundImage: AssetImage('assets/img/salem-face.jpg'),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            kSalemName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: wainText(
                              WainText.lg,
                              weight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                          Semantics(
                            liveRegion: true,
                            child: Text(
                              _statusText,
                              key: const ValueKey('chat-status'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: wainText(
                                WainText.xs,
                                color: connected
                                    ? WainColors.palm400
                                    : WainColors.sand300,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    // His voice, on request: off until pressed, and
                    // remembered (AppState, `wain-salem-read`).
                    _ReadAloudToggle(
                      on: context.watch<AppState>().salemReadAloud,
                      onTap: _toggleReadAloud,
                    ),
                    const SizedBox(width: 8),
                    // The call is placed from /find — one call button in the
                    // app (1 October) — so this is the way there, not a
                    // second one.
                    const _CallShouqLink(),
                  ],
                ),
              ),
              Expanded(
                child: ListView.builder(
                  key: _listKey,
                  controller: _scroll,
                  reverse: true,
                  padding: const EdgeInsets.all(12),
                  itemCount: _entries.length + (_waiting ? 1 : 0),
                  // Reversed: row 0 is the newest — the typing bubble while
                  // she writes, otherwise her latest line.
                  itemBuilder: (_, row) {
                    final i = _entries.length + (_waiting ? 1 : 0) - 1 - row;
                    if (i == _entries.length) return const _TypingBubble();
                    final line = _entries[i];
                    final child = _line(line, i, connected);
                    return identical(line, _replyStart)
                        ? KeyedSubtree(key: _replyKey, child: child)
                        : child;
                  },
                ),
              ),
              if (_awaitingConsent)
                _ConsentPanel(onAgree: _agree)
              else if (over && _unavailable && !_retryReady)
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Text(
                    ChatCopy.unavailable,
                    key: const ValueKey('chat-unavailable'),
                    textAlign: TextAlign.center,
                    style: wainText(WainText.base, color: Colors.white),
                  ),
                )
              else if (over)
                Padding(
                  padding: const EdgeInsets.all(12),
                  child: FilledButton(
                    key: const ValueKey('chat-reconnect'),
                    onPressed: _connect,
                    style: FilledButton.styleFrom(
                      backgroundColor: WainColors.sea600,
                      minimumSize: const Size(220, 48),
                    ),
                    child: Text(
                      _unavailable ? ChatCopy.retryLater : ChatCopy.reconnect,
                      style: wainText(
                        WainText.base,
                        weight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
                  ),
                )
              else ...[
                // The web says this over its box too (WAIN_AI_RECORDING): the
                // agreement was given once, the reminder is read every time.
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                  // The free chat sends nothing anywhere, so it says that;
                  // a recording notice over it would be untrue.
                  child: Text(
                    _free ? ChatCopy.freeNotice : AiPrivacyCopy.chatNotice,
                    key: ValueKey(
                      _free ? 'chat-free-notice' : 'chat-recording-notice',
                    ),
                    style: wainText(WainText.xs, color: WainColors.sand200),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                  child: Row(
                    children: [
                      Expanded(
                        child: TextField(
                          onTapOutside: _dismissKeyboard,
                          key: const ValueKey('chat-input'),
                          controller: _input,
                          enabled: connected,
                          onSubmitted: (_) => _send(),
                          style: wainText(
                            WainText.base,
                            color: WainColors.ink800,
                          ),
                          decoration: InputDecoration(
                            hintText: ChatCopy.placeholder,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton.filled(
                        key: const ValueKey('chat-send'),
                        tooltip: ChatCopy.send,
                        onPressed: connected ? _send : null,
                        style: IconButton.styleFrom(
                          backgroundColor: WainColors.sea600,
                          minimumSize: const Size(48, 48),
                        ),
                        icon: WainSvg.icon(
                          'send',
                          size: 20,
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

extension on _SalemScreenState {
  /// One transcript line, drawn.
  Widget _line(ChatLine line, int i, bool connected) {
    switch (line) {
      case ChatText t:
        return _Bubble(t);
      case ChatPlaces p:
        final places = [for (final s in p.slugs) ?getPlace(s)];
        // The chips belong to the newest answer only: under an older one they
        // would narrow something that is no longer the subject.
        final latest = !_entries.skip(i + 1).any((x) => x is ChatPlaces);
        return _PlacesResult(
          key: ObjectKey(line),
          places: places,
          query: p.query,
          chips: latest && !_waiting && connected ? p.chips : null,
          onChip: _submit,
          onActive: latest ? (slug) => _active = slug : null,
        );
      case ChatPlace p:
        final place = getPlace(p.slug);
        if (place == null) return const SizedBox.shrink();
        return _PickedPlace(key: ObjectKey(line), place: place);
      case ChatWhere w:
        final place = getPlace(w.slug);
        if (place == null) return const SizedBox.shrink();
        return _Where(key: ObjectKey(line), place: place);
    }
  }
}

/// «اقرا لي الردود» — his replies read aloud in his voice.
class _ReadAloudToggle extends StatelessWidget {
  final bool on;
  final VoidCallback onTap;
  const _ReadAloudToggle({required this.on, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      toggled: on,
      label: ChatCopy.readAloud,
      excludeSemantics: true,
      child: IconButton(
        key: const ValueKey('chat-read-aloud'),
        onPressed: onTap,
        style: IconButton.styleFrom(
          backgroundColor: on
              ? WainColors.coral600
              : Colors.white.withValues(alpha: 0.1),
          minimumSize: const Size(48, 48),
        ),
        icon: WainSvg.icon(
          on ? 'speaker' : 'speakeroff',
          size: 20,
          color: Colors.white,
        ),
      ),
    );
  }
}

/// «كلّم شوق» — to /find, where the call is. The words go before the name
/// does: under 400 wide the header holds the back button, his face, his name
/// and two controls, so the link is its icon (and its label is still read).
class _CallShouqLink extends StatelessWidget {
  const _CallShouqLink();

  @override
  Widget build(BuildContext context) {
    final wide = MediaQuery.sizeOf(context).width >= 400;
    final icon = WainSvg.icon('call', size: 16, color: Colors.white);
    return Semantics(
      button: true,
      label: ChatCopy.callShouq,
      excludeSemantics: true,
      child: FilledButton(
        key: const ValueKey('chat-call-shouq'),
        onPressed: () => context.push('/find'),
        style: FilledButton.styleFrom(
          backgroundColor: WainColors.coral600,
          foregroundColor: Colors.white,
          minimumSize: const Size(48, 48),
          padding: EdgeInsets.symmetric(horizontal: wide ? 14 : 0),
          shape: const StadiumBorder(),
        ),
        child: wide
            ? Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  icon,
                  const SizedBox(width: 6),
                  Text(
                    ChatCopy.callShouq,
                    style: wainText(
                      WainText.sm,
                      weight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                ],
              )
            : icon,
      ),
    );
  }
}

/// The consent question, drawn where the input box will be: the same words
/// as the sheet before a call (`AiPrivacyCopy`), agreed to once for both.
class _ConsentPanel extends StatelessWidget {
  final VoidCallback onAgree;
  const _ConsentPanel({required this.onAgree});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            AiPrivacyCopy.consentBody,
            key: const ValueKey('chat-consent-body'),
            style: wainText(
              WainText.sm,
              color: WainColors.sand200,
              height: 1.7,
            ),
          ),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: TextButton(
              onPressed: () => context.push('/privacy'),
              child: Text(
                AiPrivacyCopy.details,
                style: wainText(
                  WainText.sm,
                  weight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
            ),
          ),
          FilledButton(
            key: const ValueKey('chat-consent-agree'),
            onPressed: onAgree,
            style: FilledButton.styleFrom(
              backgroundColor: WainColors.sea600,
              minimumSize: const Size.fromHeight(48),
            ),
            child: Text(
              AiPrivacyCopy.agree,
              style: wainText(
                WainText.base,
                weight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Bubble extends StatelessWidget {
  final ChatText entry;
  const _Bubble(this.entry);

  @override
  Widget build(BuildContext context) {
    if (entry.role == 'system') {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Center(
          child: Text(
            entry.text,
            textAlign: TextAlign.center,
            style: wainText(WainText.xs, color: WainColors.sand300),
          ),
        ),
      );
    }
    final mine = entry.role == 'user';
    final play = !entry.seen;
    entry.seen = true;
    return BubbleIn(
      play: play,
      child: Align(
        alignment: mine
            ? AlignmentDirectional.centerStart
            : AlignmentDirectional.centerEnd,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          constraints: BoxConstraints(
            maxWidth: MediaQuery.sizeOf(context).width * 0.8,
          ),
          decoration: BoxDecoration(
            color: mine ? WainColors.sea600 : Colors.white,
            borderRadius: _bubbleRadius(mine: mine),
          ),
          child: Text(
            entry.text,
            style: wainText(
              WainText.base,
              color: mine ? Colors.white : WainColors.ink800,
              height: 1.6,
            ),
          ),
        ),
      ),
    );
  }
}

/// The corner nearest the speaker is the tail, so the dots and the reply
/// that replaces them read as the same bubble.
BorderRadiusDirectional _bubbleRadius({required bool mine}) {
  const r = Radius.circular(WainRadius.s2xl);
  const tail = Radius.circular(6);
  return BorderRadiusDirectional.only(
    topStart: r,
    topEnd: r,
    bottomStart: mine ? tail : r,
    bottomEnd: mine ? r : tail,
  );
}

/// Her bubble while she is writing — the height of one line of her reply,
/// on her side, so the reply lands where the dots were.
class _TypingBubble extends StatelessWidget {
  const _TypingBubble();

  @override
  Widget build(BuildContext context) {
    return BubbleIn(
      play: true,
      child: Align(
        alignment: AlignmentDirectional.centerEnd,
        child: Container(
          key: const ValueKey('chat-typing'),
          margin: const EdgeInsets.symmetric(vertical: 4),
          height: 44,
          padding: const EdgeInsets.symmetric(horizontal: 18),
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: _bubbleRadius(mine: false),
          ),
          child: const TypingDots(label: ChatCopy.typing),
        ),
      ),
    );
  }
}

/// One answer's places: the cards in a rail, a map of their own, a way to the
/// same answer as a full search, the share panel, and — under the newest
/// answer — the replies that would change it. The pin, the card and the
/// panel's «أي مكان؟» point at one place together, as on /search. Its own
/// state, so one turn's selection cannot leak into another's; a map per
/// reply rather than one for the chat, as on the web — each answer keeps its
/// own places where they are.
class _PlacesResult extends StatefulWidget {
  final List<Place> places;
  final String query;
  final List<String>? chips;
  final ValueChanged<String> onChip;
  final ValueChanged<String>? onActive;
  const _PlacesResult({
    super.key,
    required this.places,
    required this.query,
    required this.chips,
    required this.onChip,
    required this.onActive,
  });

  @override
  State<_PlacesResult> createState() => _PlacesResultState();
}

class _PlacesResultState extends State<_PlacesResult> {
  String? _slug;
  final _rail = ScrollController();
  static const double _cardWidth = 168;

  void _choose(String? slug) {
    setState(() => _slug = slug);
    if (slug == null) return;
    widget.onActive?.call(slug);
    // Bring its card into the rail's view — the rail scrolls sideways, and a
    // pin pressed for the seventh place pointed at a card off the screen.
    final i = widget.places.indexWhere((p) => p.slug == slug);
    if (i < 0 || !_rail.hasClients) return;
    final pos = _rail.position;
    final start = i * (_cardWidth + 8);
    final end = start + _cardWidth;
    final target = start < pos.pixels
        ? start
        : end > pos.pixels + pos.viewportDimension
        ? end - pos.viewportDimension
        : pos.pixels;
    _rail.animateTo(
      target.clamp(0.0, pos.maxScrollExtent),
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
    );
  }

  @override
  void dispose() {
    _rail.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final places = widget.places;
    if (places.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Center(
          child: Text(
            '${ChatCopy.noResults} «${widget.query}»',
            textAlign: TextAlign.center,
            style: wainText(WainText.xs, color: WainColors.sand200),
          ),
        ),
      );
    }
    final active = places.any((p) => p.slug == _slug) ? _slug : null;
    final target = places.firstWhere(
      (p) => p.slug == active,
      orElse: () => places.first,
    );
    final chips = widget.chips;
    return Padding(
      key: const ValueKey('chat-places'),
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            // The card's own extent, the ring's 2px above and below, and the
            // rail's padding.
            height: placeCardExtent(context) + 4 + 8,
            child: ListView.separated(
              key: const ValueKey('chat-rail'),
              controller: _rail,
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(vertical: 4),
              itemCount: places.length,
              separatorBuilder: (_, _) => const SizedBox(width: 8),
              itemBuilder: (_, i) {
                final p = places[i];
                return Listener(
                  // A finger landing on a card points at it, as a pointer
                  // entering one does on the web; the tap still opens it.
                  onPointerDown: (_) => _choose(p.slug),
                  child: AnimatedContainer(
                    key: ValueKey('chat-card-${p.slug}'),
                    duration: const Duration(milliseconds: 150),
                    width: _cardWidth,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(WainRadius.s2xl + 2),
                      border: Border.all(
                        color: p.slug == active
                            ? WainColors.sun400
                            : Colors.transparent,
                        width: 2,
                      ),
                    ),
                    child: PlaceCard(place: p),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(WainRadius.s3xl),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Still until «حرّك الخريطة», like every map in the app: in a
                // scrolling transcript a live map would take the drag.
                WainMap(
                  key: const ValueKey('chat-map'),
                  places: places,
                  activeSlug: active,
                  onActive: _choose,
                  onOpen: (p) => context.push('/places/${p.slug}'),
                  // 230, not 200: the site's chat map went from a ~175px strip
                  // to 1.6:1 on 7 October.
                  height: 230,
                ),
                TextButton.icon(
                  key: const ValueKey('chat-see-all'),
                  onPressed: () => context.go(
                    '/search?q=${Uri.encodeQueryComponent(widget.query)}',
                  ),
                  style: TextButton.styleFrom(
                    minimumSize: const Size(48, 48),
                    foregroundColor: WainColors.sea700,
                  ),
                  icon: WainSvg.icon('map', size: 14, color: WainColors.sea700),
                  label: Text(
                    ChatCopy.seeAll,
                    style: wainText(
                      WainText.xs,
                      weight: FontWeight.w600,
                      color: WainColors.sea700,
                    ),
                  ),
                ),
              ],
            ),
          ),
          ShareHangout(
            place: target,
            // Five at most, as /search's panel and the web's SalemChat: a
            // longer row of times-by-place does not fit a phone.
            choices: places.length > 1
                ? places.take(kChoiceMax).toList()
                : null,
            onChoose: _choose,
          ),
          if (chips != null && chips.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              key: const ValueKey('chat-followups'),
              spacing: 8,
              runSpacing: 8,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  ChatCopy.followLabel,
                  style: wainText(WainText.xs, color: WainColors.sand200),
                ),
                for (final c in chips)
                  ActionChip(
                    key: ValueKey('chat-chip-$c'),
                    label: Text(
                      c,
                      style: wainText(WainText.sm, color: Colors.white),
                    ),
                    backgroundColor: Colors.white.withValues(alpha: 0.1),
                    side: BorderSide.none,
                    shape: const StadiumBorder(),
                    materialTapTargetSize: MaterialTapTargetSize.padded,
                    onPressed: () => widget.onChip(c),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

/// One place — picked from the answer («الثاني») or opened by the agent: its
/// card, and the share panel for it.
class _PickedPlace extends StatelessWidget {
  final Place place;
  const _PickedPlace({super.key, required this.place});

  @override
  Widget build(BuildContext context) {
    return Padding(
      key: const ValueKey('chat-picked'),
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 192,
            height: placeCardExtent(context),
            child: PlaceCard(place: place),
          ),
          ShareHangout(place: place),
        ],
      ),
    );
  }
}

/// «وين بالضبط؟» — one place, on the map, with the way there.
class _Where extends StatelessWidget {
  final Place place;
  const _Where({super.key, required this.place});

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('chat-where'),
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(WainRadius.s3xl),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          WainMap(places: [place], activeSlug: place.slug, height: 200),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                key: const ValueKey('chat-directions'),
                onPressed: () {
                  HapticFeedback.selectionClick();
                  openDirections(place);
                },
                style: FilledButton.styleFrom(
                  backgroundColor: WainColors.sea600,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(0, 48),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(WainRadius.xl),
                  ),
                ),
                icon: WainSvg.icon('go', size: 16, color: Colors.white),
                label: Text(
                  ChatCopy.directions,
                  style: wainText(
                    WainText.sm,
                    weight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
              ),
              OutlinedButton(
                key: const ValueKey('chat-open-place'),
                onPressed: () => context.push('/places/${place.slug}'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(0, 48),
                  side: const BorderSide(color: WainColors.lineControl),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(WainRadius.xl),
                  ),
                ),
                child: Text(
                  ChatCopy.openPlace,
                  style: wainText(
                    WainText.sm,
                    weight: FontWeight.w600,
                    color: WainColors.ink700,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A tap anywhere outside a text field puts the keyboard away, as on every
/// native app; Flutter's default on a phone is to leave it up.
void _dismissKeyboard(PointerDownEvent _) =>
    FocusManager.instance.primaryFocus?.unfocus();
