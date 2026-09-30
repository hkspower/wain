/// The two real backends [VoiceService] speaks through.
library;

import 'dart:async';
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter_tts/flutter_tts.dart';

import 'voice_service.dart';

class AudioClipPlayer implements ClipPlayer {
  // Lazy: nothing touches a platform channel until something is spoken.
  AudioPlayer? _p;
  AudioPlayer get _player => _p ??= AudioPlayer();

  Future<bool> _play(Source source, double volume) async {
    final done = Completer<bool>();
    final sub = _player.onPlayerComplete.listen((_) {
      if (!done.isCompleted) done.complete(true);
    });
    try {
      await _player.setVolume(volume);
      await _player.play(source);
      return await done.future.timeout(
        const Duration(minutes: 2),
        onTimeout: () => false,
      );
    } catch (_) {
      return false;
    } finally {
      await sub.cancel();
    }
  }

  @override
  Future<bool> playClips(List<Clip> clips) async {
    for (var i = 0; i < clips.length; i++) {
      if (!await _play(UrlSource(clips[i].src.toString()), clips[i].volume))
        return false;
      // A breath between sentences, as on the web.
      if (i < clips.length - 1)
        await Future<void>.delayed(const Duration(milliseconds: 200));
    }
    return true;
  }

  @override
  Future<bool> playBytes(Uint8List mp3) =>
      _play(BytesSource(mp3, mimeType: 'audio/mpeg'), 1);

  @override
  Future<void> stop() async {
    if (_p == null) return;
    try {
      await _player.stop();
    } catch (_) {
      /* nothing playing */
    }
  }
}

class PlatformTts implements TtsBackend {
  FlutterTts? _t;
  FlutterTts get _tts => _t ??= FlutterTts();
  bool _ready = false;

  static const _gulf = ['ar-kw', 'ar-sa', 'ar-ae', 'ar-bh', 'ar-qa', 'ar-om'];

  /// Prefer a Kuwaiti voice, then any Gulf one, then any Arabic; never eSpeak
  /// when something better exists.
  static int score(String name, String locale) {
    final lang = locale.toLowerCase().replaceAll('_', '-');
    if (!lang.startsWith('ar')) return -1;
    if (name.toLowerCase().contains('espeak')) return 0;
    if (lang.startsWith('ar-kw')) return 4;
    if (_gulf.any(lang.startsWith)) return 3;
    return 2;
  }

  Future<void> _init() async {
    if (_ready) return;
    _ready = true;
    await _tts.awaitSpeakCompletion(true);
    await _tts.setLanguage('ar-KW');
    await _tts.setSpeechRate(0.5);
    try {
      final voices = await _tts.getVoices;
      if (voices is List) {
        Map? best;
        var bestScore = -1;
        for (final v in voices) {
          if (v is! Map) continue;
          final s = score('${v['name']}', '${v['locale']}');
          if (s > bestScore) {
            best = v;
            bestScore = s;
          }
        }
        if (best != null) {
          await _tts.setVoice({
            'name': '${best['name']}',
            'locale': '${best['locale']}',
          });
        }
      }
    } catch (_) {
      /* the default Arabic voice will do */
    }
  }

  @override
  Future<void> speakLines(List<String> lines) async {
    await _init();
    for (final line in lines) {
      await _tts.speak(line);
    }
  }

  @override
  Future<void> stop() async {
    if (_t == null) return;
    try {
      await _tts.stop();
    } catch (_) {
      /* not started */
    }
  }
}
