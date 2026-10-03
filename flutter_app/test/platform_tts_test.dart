import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/voice/platform_voice.dart';

/// The free build's only voice is the phone's own, so which Arabic voice it
/// picks is the whole of how شوق sounds in the app. The web's ranking has had
/// a suite since September (tests/shouq-voice.test.mjs); this one had none.
/// Driven through flutter_tts's own method channel, so what is asserted is
/// what the plugin is actually told, not what a helper returns.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('flutter_tts');
  late List<MethodCall> calls;

  Future<Map?> pick(List<Map<String, String>> voices) async {
    calls = [];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      if (call.method == 'getVoices') return voices;
      return 1;
    });
    await PlatformTts().speakLines(['اختبار.']);
    final set = calls.where((c) => c.method == 'setVoice').toList();
    return set.isEmpty ? null : set.single.arguments as Map;
  }

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('Gulf beats other Arabic even when it is listed second', () async {
    final v = await pick([
      {'name': 'Maghrebi', 'locale': 'ar-MA'},
      {'name': 'Fatima', 'locale': 'ar-SA'},
    ]);
    expect(v?['name'], 'Fatima');
  });

  test('and Kuwaiti beats the rest of the Gulf', () async {
    final v = await pick([
      {'name': 'Fatima', 'locale': 'ar-SA'},
      {'name': 'Kuwaiti', 'locale': 'ar-KW'},
    ]);
    expect(v?['name'], 'Kuwaiti');
  });

  test('eSpeak loses to any real Arabic voice', () async {
    final v = await pick([
      {'name': 'eSpeak Arabic', 'locale': 'ar'},
      {'name': 'Fatima', 'locale': 'ar-SA'},
    ]);
    expect(v?['name'], 'Fatima');
  });

  test('an underscore locale (Android) still counts as Gulf', () async {
    final v = await pick([
      {'name': 'Levantine', 'locale': 'ar_LB'},
      {'name': 'Android TTS', 'locale': 'ar_KW'},
    ]);
    expect(v?['name'], 'Android TTS');
  });

  test('an English voice is never forced onto Arabic text', () async {
    final v = await pick([
      {'name': 'English (US)', 'locale': 'en-US'},
    ]);
    expect(v, isNull, reason: 'the engine keeps its own default');
  });

  test('it asks for Kuwaiti Arabic at the normal pace, then speaks', () async {
    await pick([
      {'name': 'Kuwaiti', 'locale': 'ar-KW'},
    ]);
    MethodCall? find(String m) =>
        calls.where((c) => c.method == m).firstOrNull;
    expect(find('setLanguage')?.arguments, 'ar-KW');
    // 0.5 is flutter_tts's normal speed on both platforms, not half speed.
    expect(find('setSpeechRate')?.arguments, 0.5);
    expect(calls.map((c) => c.method).last, 'speak');
  });
}
