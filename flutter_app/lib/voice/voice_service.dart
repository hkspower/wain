/// صوت وين — the spoken answer, in three tiers, each a fallback for the last:
///
///  1. recorded clips, if the server has a manifest for them;
///  2. a live render from wain's bridge (`/api/tts.php`), for sentences no clip
///     covers — 4 seconds' patience, then give up on the LISTENER (the render
///     itself carries on server-side, so the characters are paid for once);
///  3. the platform's own Arabic voice.
///
/// Mirrors `voice.ts`. Two rules carry over exactly: a bridge that answers
/// 404, 503 or 403 cannot change while the app is open, so it is remembered
/// and never asked again this run; and a timeout, a 5xx or a 429 are NOT
/// remembered, because a second try can win.
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../ai/config.dart' show kAgentEnabled;
import '../data/voice_lines.dart';

const String kWainOrigin = 'https://www.wainkw.com';
const String _ttsConfigured = String.fromEnvironment('WAIN_TTS_URL');
const Duration kTtsDeadline = Duration(seconds: 4);

/// Absolute, because a native app has no origin to be relative to — the web's
/// `/api/tts.php` would resolve against nothing. `none` switches the bridge off.
///
/// The bridge renders with ElevenLabs on our server, so its default follows
/// شوق's switch: a free build (the live app since 2 October) never asks it,
/// and the phone's own voice speaks — the web's voice.ts does the same.
String resolveTtsUrl([String configured = _ttsConfigured, bool agent = false]) {
  final c = configured.trim().isEmpty
      ? (agent ? '$kWainOrigin/api/tts.php' : 'none')
      : configured.trim();
  return c.toLowerCase() == 'none' ? '' : c;
}

class Clip {
  final Uri src;
  final double volume;
  const Clip(this.src, this.volume);
}

abstract class ClipPlayer {
  /// Plays in order, returning when done; false if any failed to play.
  Future<bool> playClips(List<Clip> clips);
  Future<bool> playBytes(Uint8List mp3);
  Future<void> stop();
}

abstract class TtsBackend {
  /// Speaks each line in turn; completes when the last has finished.
  Future<void> speakLines(List<String> lines);
  Future<void> stop();
}

class VoiceService extends ChangeNotifier {
  VoiceService({
    required this.player,
    required this.tts,
    required this.persona,
    http.Client? client,
    String? ttsUrl,
    this.origin = kWainOrigin,
  }) : _client = client ?? http.Client(),
       _ttsUrl = ttsUrl ?? resolveTtsUrl(_ttsConfigured, kAgentEnabled);

  final ClipPlayer player;
  final TtsBackend tts;

  /// Read at speak time, so a persona change applies to the next sentence.
  final PersonaId Function() persona;
  final http.Client _client;
  final String _ttsUrl;
  final String origin;

  bool _speaking = false;
  bool _bridgeOff = false;
  int _generation = 0;
  Future<Map<String, dynamic>>? _manifest;

  bool get speaking => _speaking;
  bool get bridgeOff => _bridgeOff;

  void _setSpeaking(bool v) {
    if (_speaking == v) return;
    _speaking = v;
    notifyListeners();
  }

  Future<Map<String, dynamic>> _loadManifest() => _manifest ??= _client
      .get(Uri.parse('$origin/voice/manifest.json'))
      .timeout(kTtsDeadline)
      .then(
        (r) => r.statusCode == 200
            ? (jsonDecode(r.body) as Map<String, dynamic>)
            : const <String, dynamic>{},
      )
      .catchError((_) => const <String, dynamic>{});

  /// The clips for [parts], or null when any part lacks one — a half-recorded
  /// sentence would be worse than a consistent synthetic one.
  List<Clip>? resolveClips(
    List<SpeechPart> parts,
    Map<String, dynamic> manifest,
  ) {
    final clips =
        (manifest['clips'] as Map?)?.cast<String, dynamic>() ?? const {};
    final gains =
        (manifest['gains'] as Map?)?.cast<String, dynamic>() ?? const {};
    final out = <Clip>[];
    for (final part in parts) {
      if (part.key == null) {
        if (part.optional) continue;
        return null;
      }
      final id = '${persona().name}/${part.key}';
      final src = clips[id];
      if (src is! String) return null;
      final g = gains[id];
      out.add(
        Clip(
          Uri.parse(origin).resolve(src),
          g is num && g.isFinite ? g.toDouble().clamp(0.0, 1.0) : 1.0,
        ),
      );
    }
    return out.isEmpty ? null : out;
  }

  /// Say [parts]. Starting a new utterance silences the last.
  Future<void> speak(List<SpeechPart> parts) async {
    if (parts.isEmpty) return;
    await stop();
    final mine = ++_generation;

    final manifest = await _loadManifest();
    if (mine != _generation) return;

    final clips = resolveClips(parts, manifest);
    if (clips != null) {
      _setSpeaking(true);
      final ok = await player.playClips(clips);
      if (mine == _generation) _setSpeaking(false);
      if (ok) return;
      if (mine != _generation) return;
    }

    final text = parts.map((p) => p.text).join(' ');
    if (await _speakLive(text, mine)) return;
    if (mine != _generation) return;
    await _speakFallback(parts, mine);
  }

  Future<bool> _speakLive(String text, int mine) async {
    if (_ttsUrl.isEmpty || _bridgeOff) return false;
    try {
      final res = await _client
          .post(
            Uri.parse(_ttsUrl),
            headers: const {'content-type': 'application/json'},
            body: jsonEncode({
              'persona': persona().name,
              'text': forSpeech(text),
            }),
          )
          .timeout(kTtsDeadline);
      if (res.statusCode != 200) {
        // 404 / 503 / 403 cannot change while the app is open — stop asking.
        if (res.statusCode == 404 ||
            res.statusCode == 503 ||
            res.statusCode == 403)
          _bridgeOff = true;
        return false;
      }
      final type = res.headers['content-type'] ?? '';
      // Under 512 bytes is an error page wearing a 200, never audio.
      if (res.bodyBytes.length < 512 || !type.startsWith('audio/'))
        return false;
      if (mine != _generation) return false;
      _setSpeaking(true);
      final ok = await player.playBytes(res.bodyBytes);
      if (mine == _generation) _setSpeaking(false);
      return ok;
    } catch (_) {
      return false;
    }
  }

  Future<void> _speakFallback(List<SpeechPart> parts, int mine) async {
    final lines = parts
        .map((p) => forSpeech(p.text))
        .where((t) => t.isNotEmpty)
        .toList();
    if (lines.isEmpty) return;
    _setSpeaking(true);
    try {
      await tts.speakLines(lines);
    } catch (_) {
      /* no voice on this device: silence, not an error */
    }
    if (mine == _generation) _setSpeaking(false);
  }

  Future<void> stop() async {
    _generation++;
    _setSpeaking(false);
    await player.stop();
    await tts.stop();
  }

  @override
  void dispose() {
    _client.close();
    super.dispose();
  }
}
