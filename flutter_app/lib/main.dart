import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';

import 'app/app_state.dart';
import 'ai/call_controller.dart';
import 'ai/call_overlay.dart';
import 'ai/elevenlabs_session.dart';
import 'ai/keep_alive.dart';
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

  /// Tests replace the real session (LiveKit, a microphone, a network) and
  /// the keep-alive (wakelock, the Android service) with fakes.
  final SessionFactory? sessionFactory;
  final MicCheck? checkMic;
  final CallKeepAlive? keepAlive;
  final String? agentId;
  const WainApp({
    super.key,
    required this.state,
    this.initialLocation = '/',
    this.sessionFactory,
    this.checkMic,
    this.keepAlive,
    this.agentId,
  });

  @override
  State<WainApp> createState() => _WainAppState();
}

class _WainAppState extends State<WainApp> {
  late final _router = buildRouter(initialLocation: widget.initialLocation);

  /// The call lives here, above the router, so a page change she causes
  /// (`open_place`) cannot hang up her own call.
  late final CallKeepAlive _keepAlive = widget.keepAlive ?? PlatformKeepAlive();

  late final CallController _call = CallController(
    sessionFactory: widget.sessionFactory ?? ElevenLabsSession.new,
    keepAlive: _keepAlive,
    agentId: widget.agentId,
    places: kPlaces,
    indexOf: () => searchIndex,
    // A place opens ON TOP of whatever she was showing, so back returns
    // there; a search is the Search tab, switched to with its query.
    navigate: (location) => location.startsWith('/places/')
        ? _router.push(location)
        : _router.go(location),
    checkMic: widget.checkMic ?? checkMicrophone,
  );

  late final ChildBackButtonDispatcher _back = _router.backButtonDispatcher
      .createChildBackButtonDispatcher();

  StreamSubscription<Uri>? _links;

  @override
  void initState() {
    super.initState();
    _listenForLinks();
    final k = _keepAlive;
    if (k is PlatformKeepAlive) k.onHangUp = () => _call.hangUp();
    // Back while the call sheet is up acts on the SHEET: a live call shrinks
    // to its bar, a finished one closes. The sheet sits above the router, so
    // without this, back reached the page hidden under it — or closed the app.
    // After the first frame: taking priority asserts that the root dispatcher
    // already has the router's own callback, which it gets when the Router
    // first builds.
    _back.addCallback(_onBack);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _back.takePriority();
    });
    _call.addListener(_syncSystemBack);
  }

  Future<bool> _onBack() async {
    if (!_call.sheetOpen) return false;
    if (_call.active) {
      _call.minimise();
    } else {
      _call.closeSheet();
    }
    return true;
  }

  /// Android 16 delivers back to the app only while the framework says it
  /// will handle it, and the navigator alone says no on Home — so with the
  /// sheet open on Home, back would have left the app.
  bool _sheetWasOpen = false;
  void _syncSystemBack() {
    if (_call.sheetOpen == _sheetWasOpen) return;
    _sheetWasOpen = _call.sheetOpen;
    if (_sheetWasOpen) SystemNavigator.setFrameworkHandlesBack(true);
  }

  bool _onNavigation(NavigationNotification n) {
    SystemNavigator.setFrameworkHandlesBack(n.canHandlePop || _call.sheetOpen);
    return true;
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
    _call.removeListener(_syncSystemBack);
    _back.removeCallback(_onBack);
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
        onNavigationNotification: _onNavigation,
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
