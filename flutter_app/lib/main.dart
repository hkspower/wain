import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';

import 'app/app_state.dart';
import 'ai/call_controller.dart';
import 'ai/call_overlay.dart';
import 'ai/elevenlabs_session.dart';
import 'app/deep_link.dart';
import 'app/router.dart';
import 'voice/platform_voice.dart';
import 'voice/voice_service.dart';
import 'data/catalogue.dart';
import 'data/places.g.dart';
import 'theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final state = await AppState.load();
  runApp(WainApp(state: state));
}

class WainApp extends StatefulWidget {
  final AppState state;

  /// Where to start; tests use it to land on a route directly.
  final String initialLocation;
  const WainApp({super.key, required this.state, this.initialLocation = '/'});

  @override
  State<WainApp> createState() => _WainAppState();
}

class _WainAppState extends State<WainApp> {
  late final _router = buildRouter(initialLocation: widget.initialLocation);

  /// The call lives here, above the router, so a page change she causes
  /// (`open_place`) cannot hang up her own call.
  late final CallController _call = CallController(
    sessionFactory: ElevenLabsSession.new,
    places: kPlaces,
    indexOf: () => searchIndex,
    // A place opens ON TOP of whatever she was showing, so back returns
    // there; a search is the Search tab, switched to with its query.
    navigate: (location) => location.startsWith('/places/')
        ? _router.push(location)
        : _router.go(location),
    checkMic: checkMicrophone,
  );

  StreamSubscription<Uri>? _links;

  @override
  void initState() {
    super.initState();
    _listenForLinks();
  }

  /// A forwarded invitation opens the place in the app. The browser build IS
  /// the page, so it has no links to catch.
  Future<void> _listenForLinks() async {
    if (kIsWeb) return;
    try {
      final links = AppLinks();
      final first = await links.getInitialLink();
      // Cold start from a link: the place opens over Home, so back (or the
      // iOS swipe) lands somewhere instead of closing the app.
      if (first != null) _open(first);
      _links = links.uriLinkStream.listen(_open, onError: (_) {});
    } catch (_) {
      /* a platform without link support: nothing to catch */
    }
  }

  void _open(Uri link) => openLink(_router, link);

  late final VoiceService _voice = VoiceService(
    player: AudioClipPlayer(),
    tts: PlatformTts(),
    persona: () => widget.state.persona,
  );

  @override
  void dispose() {
    _links?.cancel();
    _voice.dispose();
    _call.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MultiProvider(
      providers: [
        ChangeNotifierProvider<AppState>.value(value: widget.state),
        ChangeNotifierProvider<CallController>.value(value: _call),
        ChangeNotifierProvider<VoiceService>.value(value: _voice),
      ],
      child: MaterialApp.router(
        title: 'وين',
        debugShowCheckedModeBanner: false,
        // Arabic throughout, right-to-left, the same as the web site — there
        // is no English UI here to fall back to.
        locale: const Locale('ar'),
        supportedLocales: const [Locale('ar')],
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        theme: buildWainTheme(),
        routerConfig: _router,
        builder: (context, child) => Stack(
          textDirection: TextDirection.rtl,
          children: [
            Positioned.fill(child: child ?? const SizedBox.shrink()),
            const CallOverlay(),
          ],
        ),
      ),
    );
  }
}
