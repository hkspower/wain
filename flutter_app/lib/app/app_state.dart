/// The little the app remembers between launches, and nothing else: whether
/// the voice is on (OFF until someone turns it on — a site that starts talking
/// on arrival is a site people close), which persona speaks, and whether the
/// visitor agreed to what happens to a conversation with شوق, and whether
/// سالم's chat reads his replies aloud. Same keys as the
/// web for the two voice preferences (`wain-voice-enabled`,
/// `wain-voice-persona`) so the two describe one preference, not two.
library;

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/voice_lines.dart';

class AppState extends ChangeNotifier {
  AppState._(this._prefs)
    : _voiceEnabled = _prefs?.getBool(_kVoice) ?? false,
      _persona = PersonaId.values.firstWhere(
        (p) => p.name == _prefs?.getString(_kPersona),
        orElse: () => PersonaId.shouq,
      ),
      _aiConsent = _prefs?.getBool(_kAiConsent) ?? false,
      _salemReadAloud = _prefs?.getBool(_kSalemRead) ?? false;

  static const _kVoice = 'wain-voice-enabled';
  static const _kPersona = 'wain-voice-persona';

  /// سالم's replies read aloud in his voice — off until pressed, and
  /// remembered; the web's `wain-salem-read`.
  static const _kSalemRead = 'wain-salem-read';

  /// Whether the visitor agreed to what happens to a conversation with شوق or
  /// سالم (`AiPrivacyCopy`). Versioned in the key on purpose: when what is
  /// kept changes, bump it and everybody is asked again — an answer given to
  /// different words is not an answer to these.
  static const _kAiConsent = 'wain-ai-consent-v1';

  final SharedPreferences? _prefs;
  bool _voiceEnabled;
  PersonaId _persona;
  bool _aiConsent;
  bool _salemReadAloud;

  bool get aiConsent => _aiConsent;
  bool get salemReadAloud => _salemReadAloud;

  void setSalemReadAloud(bool v) {
    _salemReadAloud = v;
    _prefs?.setBool(_kSalemRead, v);
    notifyListeners();
  }

  void setAiConsent(bool v) {
    _aiConsent = v;
    _prefs?.setBool(_kAiConsent, v);
    notifyListeners();
  }

  /// A missing or unreadable store is not an error: defaults apply, nothing
  /// persists. (Private windows and blocked storage do the same on the web.)
  static Future<AppState> load() async {
    try {
      return AppState._(await SharedPreferences.getInstance());
    } catch (_) {
      return AppState._(null);
    }
  }

  @visibleForTesting
  static AppState ephemeral() => AppState._(null);

  bool get voiceEnabled => _voiceEnabled;
  PersonaId get persona => _persona;

  void setVoiceEnabled(bool v) {
    _voiceEnabled = v;
    _prefs?.setBool(_kVoice, v);
    notifyListeners();
  }

  void setPersona(PersonaId p) {
    _persona = p;
    _prefs?.setString(_kPersona, p.name);
    notifyListeners();
  }
}
