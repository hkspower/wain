import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:wain/data/voice_lines.dart';
import 'package:wain/voice/voice_service.dart';

class FakePlayer implements ClipPlayer {
  final clips = <List<Clip>>[];
  final bytes = <Uint8List>[];
  bool ok = true;
  int stops = 0;
  @override
  Future<bool> playClips(List<Clip> c) async {
    clips.add(c);
    return ok;
  }

  @override
  Future<bool> playBytes(Uint8List b) async {
    bytes.add(b);
    return ok;
  }

  @override
  Future<void> stop() async => stops++;
}

class FakeTts implements TtsBackend {
  final spoken = <List<String>>[];
  @override
  Future<void> speakLines(List<String> lines) async => spoken.add(lines);
  @override
  Future<void> stop() async {}
}

const part = SpeechPart(
  key: 'place-kuwait-towers',
  text: 'أبراج الكويت، في مدينة الكويت. ١٨٧ متر — فوق الخليج',
);
final audio = Uint8List.fromList(List.filled(600, 7));

VoiceService make(
  http.Client client,
  FakePlayer p,
  FakeTts t, {
  PersonaId persona = PersonaId.shouq,
  String url = 'https://x.test/api/tts.php',
}) => VoiceService(
  player: p,
  tts: t,
  persona: () => persona,
  client: client,
  ttsUrl: url,
  origin: 'https://x.test',
);

void main() {
  test(
    'tier 1: clips from the manifest, resolved against the origin, with gain',
    () async {
      final player = FakePlayer(), tts = FakeTts();
      final v = make(
        MockClient((r) async {
          expect(r.url.path, '/voice/manifest.json');
          return http.Response(
            jsonEncode({
              'clips': {
                'shouq/place-kuwait-towers':
                    '/voice/shouq/place-kuwait-towers.mp3',
              },
              'gains': {'shouq/place-kuwait-towers': 0.6},
            }),
            200,
          );
        }),
        player,
        tts,
      );
      await v.speak([part]);
      expect(
        player.clips.single.single.src.toString(),
        'https://x.test/voice/shouq/place-kuwait-towers.mp3',
      );
      expect(player.clips.single.single.volume, 0.6);
      expect(tts.spoken, isEmpty);
    },
  );

  test('a missing clip for ANY part means no clips at all — no half-recorded sentence', () async {
    final player = FakePlayer(), tts = FakeTts();
    final posted = <String>[];
    final v = make(
      MockClient((r) async {
        if (r.url.path.endsWith('manifest.json')) {
          return http.Response(
            jsonEncode({
              'clips': {'shouq/place-kuwait-towers': '/a.mp3'},
            }),
            200,
          );
        }
        posted.add(r.url.path);
        return http.Response('', 503);
      }),
      player,
      tts,
    );
    await v.speak([
      part,
      const SpeechPart(key: 'best-kuwait-towers', text: 'أحلى وقت: الغروب.'),
    ]);
    expect(player.clips, isEmpty);
    expect(posted, ['/api/tts.php'], reason: 'fell through to the bridge');
  });

  test('optional parts are skipped on the clip path', () {
    final v = make(
      MockClient((_) async => http.Response('', 404)),
      FakePlayer(),
      FakeTts(),
    );
    final got = v.resolveClips(
      [const SpeechPart(text: 'قهوة؟', optional: true), part],
      {
        'clips': {'shouq/place-kuwait-towers': '/a.mp3'},
      },
    );
    expect(got, hasLength(1));
  });

  test('the persona picks the clip set', () {
    final v = make(
      MockClient((_) async => http.Response('', 404)),
      FakePlayer(),
      FakeTts(),
      persona: PersonaId.salem,
    );
    final clips = {
      'clips': {
        'shouq/place-kuwait-towers': '/a.mp3',
        'salem/place-kuwait-towers': '/b.mp3',
      },
    };
    expect(v.resolveClips([part], clips)!.single.src.path, '/b.mp3');
  });

  test('tier 2: the bridge gets {persona, text} with the speech-prepared sentence, and its audio plays', () async {
    final player = FakePlayer(), tts = FakeTts();
    late Map<String, dynamic> body;
    final v = make(
      MockClient((r) async {
        if (r.url.path.endsWith('manifest.json'))
          return http.Response('{}', 200);
        body = jsonDecode(r.body) as Map<String, dynamic>;
        return http.Response.bytes(
          audio,
          200,
          headers: {'content-type': 'audio/mpeg'},
        );
      }),
      player,
      tts,
    );
    await v.speak([part]);
    expect(body['persona'], 'shouq');
    expect(
      body['text'],
      'أبراج الكويت، في مدينة الكويت. 187 متر، فوق الخليج',
      reason: 'Western digits and a comma for the dash: what a voice can read',
    );
    expect(player.bytes.single, audio);
    expect(tts.spoken, isEmpty);
  });

  for (final status in [404, 503, 403]) {
    test(
      'bridge answering $status is remembered: asked once, then straight to the device voice',
      () async {
        final player = FakePlayer(), tts = FakeTts();
        var asks = 0;
        final v = make(
          MockClient((r) async {
            if (r.url.path.endsWith('manifest.json'))
              return http.Response('{}', 200);
            asks++;
            return http.Response('', status);
          }),
          player,
          tts,
        );
        await v.speak([part]);
        await v.speak([part]);
        expect(asks, 1);
        expect(v.bridgeOff, isTrue);
        expect(tts.spoken, hasLength(2));
      },
    );
  }

  for (final status in [500, 429, 502]) {
    test(
      'bridge answering $status is NOT remembered — a second try can win',
      () async {
        var asks = 0;
        final v = make(
          MockClient((r) async {
            if (r.url.path.endsWith('manifest.json'))
              return http.Response('{}', 200);
            asks++;
            return http.Response('', status);
          }),
          FakePlayer(),
          FakeTts(),
        );
        await v.speak([part]);
        await v.speak([part]);
        expect(asks, 2);
        expect(v.bridgeOff, isFalse);
      },
    );
  }

  test(
    'an error page wearing a 200 (under 512 bytes, or not audio) is rejected',
    () async {
      for (final reply in [
        http.Response.bytes(
          Uint8List(100),
          200,
          headers: {'content-type': 'audio/mpeg'},
        ),
        http.Response.bytes(audio, 200, headers: {'content-type': 'text/html'}),
      ]) {
        final player = FakePlayer(), tts = FakeTts();
        final v = make(
          MockClient(
            (r) async => r.url.path.endsWith('manifest.json')
                ? http.Response('{}', 200)
                : reply,
          ),
          player,
          tts,
        );
        await v.speak([part]);
        expect(player.bytes, isEmpty);
        expect(tts.spoken, hasLength(1));
      }
    },
  );

  test('a slow bridge gives up on the listener after the deadline and the device voice speaks', () async {
    final player = FakePlayer(), tts = FakeTts();
    final v = VoiceService(
      player: player,
      tts: tts,
      persona: () => PersonaId.shouq,
      ttsUrl: 'https://x.test/api/tts.php',
      origin: 'https://x.test',
      client: MockClient((r) async {
        if (r.url.path.endsWith('manifest.json'))
          return http.Response('{}', 200);
        await Future<void>.delayed(
          kTtsDeadline + const Duration(milliseconds: 300),
        );
        return http.Response.bytes(
          audio,
          200,
          headers: {'content-type': 'audio/mpeg'},
        );
      }),
    );
    await v.speak([part]);
    expect(player.bytes, isEmpty);
    expect(tts.spoken, hasLength(1));
    expect(v.bridgeOff, isFalse, reason: 'a timeout is not remembered');
  }, timeout: const Timeout(Duration(seconds: 15)));

  test('bridge switched off ("none"): no request, device voice', () async {
    final tts = FakeTts();
    var asks = 0;
    final v = make(
      MockClient((r) async {
        if (!r.url.path.endsWith('manifest.json')) asks++;
        return http.Response('{}', 200);
      }),
      FakePlayer(),
      tts,
      url: '',
    );
    await v.speak([part]);
    expect(asks, 0);
    expect(tts.spoken, hasLength(1));
  });

  test('a newer sentence silences the last: a slow first one never speaks over the second', () async {
    final tts = FakeTts();
    final v = make(
      MockClient((r) async {
        if (r.url.path.endsWith('manifest.json'))
          return http.Response('{}', 200);
        return http.Response('', 503);
      }),
      FakePlayer(),
      tts,
    );
    final first = v.speak([const SpeechPart(text: 'واحد')]);
    final second = v.speak([const SpeechPart(text: 'اثنين')]);
    await Future.wait([first, second]);
    expect(tts.spoken.expand((l) => l).toList(), ['اثنين']);
  });

  test(
    'speaking is reported while audio plays, and stop() clears it',
    () async {
      final v = make(
        MockClient(
          (r) async => r.url.path.endsWith('manifest.json')
              ? http.Response('{}', 200)
              : http.Response('', 503),
        ),
        FakePlayer(),
        FakeTts(),
      );
      final seen = <bool>[];
      v.addListener(() => seen.add(v.speaking));
      await v.speak([const SpeechPart(text: 'x')]);
      expect(seen, containsAllInOrder([true, false]));
      await v.stop();
      expect(v.speaking, isFalse);
    },
  );

  test('resolveTtsUrl: absolute by default (a native app has no origin), none switches off', () {
    expect(resolveTtsUrl(''), 'https://www.wainkw.com/api/tts.php');
    expect(resolveTtsUrl('none'), '');
    expect(resolveTtsUrl('https://s.example/tts'), 'https://s.example/tts');
  });
}
