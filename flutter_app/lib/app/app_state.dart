/// The little the app remembers between launches, and nothing else: whether
/// the voice is on (OFF until someone turns it on — a site that starts talking
/// on arrival is a site people close) and which persona speaks. Same keys as the web
/// (`wain-voice-enabled`, `wain-voice-persona`) so the two describe one
/// preference, not two.
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
      );

  static const _kVoice = 'wain-voice-enabled';
  static const _kPersona = 'wain-voice-persona';

  final SharedPreferences? _prefs;
  bool _voiceEnabled;
  PersonaId _persona;

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
