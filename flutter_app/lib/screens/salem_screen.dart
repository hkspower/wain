import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../ai/config.dart';
import '../ai/salem_chat.dart';
import '../ai/tools.dart';
import '../data/catalogue.dart';
import '../data/models.dart';
import '../data/places.g.dart';
import '../share/hangout_panel.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/place_card.dart';
import '../widgets/svg.dart';

/// The typed conversation with شوق. Same agent, same prompt, same tools; text
/// only. `show_places` / `open_place` put REAL place cards in the transcript
/// instead of navigating — this screen IS the conversation, and a route
/// change would close the socket mid-sentence.
class SalemScreen extends StatefulWidget {
  /// Tests inject a socket factory; the app uses the real one.
  final ChannelFactory? connect;
  const SalemScreen({super.key, this.connect});

  @override
  State<SalemScreen> createState() => _SalemScreenState();
}

sealed class _Entry {}

class _Text extends _Entry {
  final String role; // user | agent | system
  final String text;
  _Text(this.role, this.text);
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

  @override
  void initState() {
    super.initState();
    _connect();
  }

  void _connect() {
    _handle?.close();
    setState(() {
      _status = ChatStatus.connecting;
      if (_entries.isNotEmpty) _entries.clear();
    });
    _handle = startSalemChat(
      connect:
          widget.connect ?? (uri, protocols) => defaultChannel(uri, protocols),
      onStatus: (s) {
        if (mounted) setState(() => _status = s);
      },
      onMessage: (m) => _add(_Text(m.role, m.text)),
      onToolUnavailable: () => _add(_Text('system', ChatCopy.toolUnavailable)),
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
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _send() {
    final text = _input.text.trim();
    if (text.isEmpty || _status != ChatStatus.connected) return;
    _input.clear();
    _handle?.send(text);
    _add(_Text('user', text));
  }

  @override
  void dispose() {
    _handle?.close();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  String get _statusText => switch (_status) {
    ChatStatus.connecting => ChatCopy.connecting,
    ChatStatus.connected => ChatCopy.connected,
    ChatStatus.disconnected => ChatCopy.disconnected,
    ChatStatus.error =>
      kAgentEnabled ? ChatCopy.failed : ChatCopy.notConfigured,
  };

  @override
  Widget build(BuildContext context) {
    final connected = _status == ChatStatus.connected;
    final over =
        _status == ChatStatus.disconnected || _status == ChatStatus.error;
    return Scaffold(
      backgroundColor: WainColors.sea950,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 12, 8),
              child: Row(
                children: [
                  IconButton(
                    tooltip: 'رجوع',
                    onPressed: () =>
                        context.canPop() ? context.pop() : context.go('/find'),
                    icon: WainSvg.icon('back', size: 24, color: Colors.white),
                  ),
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
                padding: const EdgeInsets.all(12),
                itemCount: _entries.length,
                itemBuilder: (_, i) => switch (_entries[i]) {
                  _Text t => _Bubble(t),
                  _Places p => _PlacesBlock(places: p.places),
                },
              ),
            ),
            if (over)
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
                    ChatCopy.reconnect,
                    style: wainText(
                      WainText.base,
                      weight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                ),
              )
            else
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
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
                      icon: WainSvg.icon('send', size: 20, color: Colors.white),
                    ),
                  ],
                ),
              ),
          ],
        ),
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
    return Align(
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
          borderRadius: BorderRadius.circular(WainRadius.s2xl),
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
