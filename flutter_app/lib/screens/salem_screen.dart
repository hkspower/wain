import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../ai/config.dart';
import '../app/app_state.dart';
import '../app/online.dart';
import '../ai/salem_chat.dart';
import '../ai/tools.dart';
import '../data/catalogue.dart';
import '../data/models.dart';
import '../data/places.g.dart';
import '../share/hangout.dart' show kuwaitMonth;
import '../data/voice_lines.dart';
import '../share/hangout_panel.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/back_fab.dart';
import '../widgets/place_card.dart';
import '../widgets/svg.dart';
import '../widgets/typing_dots.dart';

/// The typed conversation with شوق. Same agent, same prompt, same tools; text
/// only. `show_places` / `open_place` put REAL place cards in the transcript
/// instead of navigating — this screen IS the conversation, and a route
/// change would close the socket mid-sentence.
class SalemScreen extends StatefulWidget {
  /// Tests inject a socket factory; the app uses the real one.
  final ChannelFactory? connect;

  /// The agent to talk to; null reads the build's (config.dart). Empty — the
  /// live app since 2 October — is the free chat: سالم answers from the
  /// app's own search, with nothing sent anywhere.
  final String? agentId;
  const SalemScreen({super.key, this.connect, this.agentId});

  @override
  State<SalemScreen> createState() => _SalemScreenState();
}

sealed class _Entry {}

class _Text extends _Entry {
  final String role; // user | agent | system
  final String text;
  _Text(this.role, this.text);

  /// Played its arrival once; a ListView rebuilds rows as they scroll back
  /// into view, and a line must not slide in a second time.
  bool seen = false;
}

class _Places extends _Entry {
  final List<Place> places;
  _Places(this.places);
}

class _SalemScreenState extends State<SalemScreen> {
  final _entries = <_Entry>[];
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
            _add(_Text('system', ChatCopy.noReply));
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
    if (_free) {
      // Nothing to connect to and nothing recorded, so nothing to agree to:
      // he greets in words this screen owns, and the box works at once.
      _status = ChatStatus.connected;
      _entries.add(_Text('agent', ChatCopy.freeGreeting));
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
        _add(_Text(m.role, m.text));
      },
      onToolUnavailable: () => _add(_Text('system', ChatCopy.toolUnavailable)),
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
          final r = showPlacesForChat(
            '${p['query'] ?? ''}'.trim(),
            searchIndex,
            kPlaces,
          );
          final found = [for (final s in r.slugs) ?getPlace(s)];
          _add(_Places(found));
          return r.spoken;
        },
        'open_place': (p) {
          final r = openPlaceForChat('${p['slug'] ?? ''}', kPlaces);
          if (r.place != null) _add(_Places([r.place!]));
          return r.spoken;
        },
      },
    );
  }

  void _add(_Entry e) {
    if (!mounted) return;
    setState(() => _entries.add(e));
    _toNewest();
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
    final text = _input.text.trim();
    if (text.isEmpty || _status != ChatStatus.connected) return;
    HapticFeedback.lightImpact();
    _input.clear();
    if (_free) {
      _add(_Text('user', text));
      _answerLocally(text);
      return;
    }
    _handle?.send(text);
    _add(_Text('user', text));
    _wait(true);
  }

  /// The free chat's reply: the same search `show_places` runs, and the
  /// sentence the free call speaks on /search (`answerParts`), so the two
  /// free paths say the same thing about the same place. The web's
  /// SalemChat.tsx does exactly this.
  void _answerLocally(String q) {
    final r = showPlacesForChat(q, searchIndex, kPlaces);
    final found = [for (final s in r.slugs) ?getPlace(s)];
    if (found.isEmpty) {
      _add(_Text('agent', ChatCopy.freeEmpty));
      return;
    }
    final words = answerParts(
      found.map((p) => p.nameAr).toList(),
      found,
      month: kuwaitMonth(),
    ).map((p) => p.text).join(' ');
    _add(_Text('agent', words));
    _add(_Places(found));
  }

  @override
  void dispose() {
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
                  ],
                ),
              ),
              Expanded(
                child: ListView.builder(
                  controller: _scroll,
                  reverse: true,
                  padding: const EdgeInsets.all(12),
                  itemCount: _entries.length + (_waiting ? 1 : 0),
                  // Reversed: row 0 is the newest — the typing bubble while
                  // she writes, otherwise her latest line.
                  itemBuilder: (_, row) {
                    final i = _entries.length + (_waiting ? 1 : 0) - 1 - row;
                    return i == _entries.length
                        ? const _TypingBubble()
                        : switch (_entries[i]) {
                            _Text t => _Bubble(t),
                            _Places p => _PlacesBlock(places: p.places),
                          };
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
  final _Text entry;
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

/// The cards she put in front of the visitor, each with the «رسّلها للربع»
/// panel — this block's own selection, so one turn cannot leak into another.
class _PlacesBlock extends StatefulWidget {
  final List<Place> places;
  const _PlacesBlock({required this.places});

  @override
  State<_PlacesBlock> createState() => _PlacesBlockState();
}

class _PlacesBlockState extends State<_PlacesBlock> {
  String? _slug;

  @override
  Widget build(BuildContext context) {
    if (widget.places.isEmpty) return const SizedBox.shrink();
    final active = widget.places.firstWhere(
      (p) => p.slug == _slug,
      orElse: () => widget.places.first,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final p in widget.places)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SizedBox(
                height: placeCardExtent(context),
                child: PlaceCard(place: p),
              ),
            ),
          ShareHangout(
            place: active,
            choices: widget.places.length > 1 ? widget.places : null,
            onChoose: (s) => setState(() => _slug = s),
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
