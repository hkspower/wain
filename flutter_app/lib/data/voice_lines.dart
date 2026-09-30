/// Port of `src/lib/voice-lines.ts` — the sentences the personas say, and the
/// preparation that turns a line written to be READ into one fit to be SPOKEN.
/// The same strings feed the recorded clips, the bridge and the on-device
/// voice, so none of them can drift from the others. Replayed against the web
/// in `test/voice_hangout_parity_test.dart`.
library;

import 'arabic.dart';
import 'models.dart';

final RegExp _arDigit = RegExp('[٠-٩]');

/// The same sentence, prepared for a voice rather than an eye: Western digits,
/// a dot for the decimal mark, a comma for the em-dash beat, Kuwaiti letters
/// folded to ones an Arabic engine knows. The screen is untouched.
String forSpeech(String text) => toStandardArabic(text)
    .replaceAllMapped(_arDigit, (m) => '٠١٢٣٤٥٦٧٨٩'.indexOf(m[0]!).toString())
    .replaceAll('٫', '.')
    .replaceAll(RegExp(r'\s*—\s*'), '، ')
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

enum PersonaId { shouq, salem }

class Persona {
  final PersonaId id;
  final String nameAr;
  final String descAr;
  const Persona(this.id, this.nameAr, this.descAr);
}

const Map<PersonaId, Persona> kPersonas = {
  PersonaId.shouq: Persona(PersonaId.shouq, 'شوق', 'صوت كويتي شبابي — بنت'),
  PersonaId.salem: Persona(PersonaId.salem, 'سالم', 'صوت كويتي شبابي — ولد'),
};

const Map<String, String> kGenericLines = {
  'search-empty': 'ما لقيت شي بهالكلمة. قول لي الجو اللي تبيه — قهوة، بحر، مطعم، ولا طلعة عيال.',
  'suggest-intro': 'أقترح عليك:',
  'related-intro': 'وإذا تبي غيره:',
  'summer-outdoor': 'بس هذي أيام حر — لا تروح إلا بعد المغرب.',
  'summer-mixed': 'والجو حر — خذ المكيّف بالنهار، والمكشوف بعد المغرب.',
};

String helloLine(String nameAr) =>
    'هلا! أنا $nameAr. من الحين، لما تدوّر أقول لك وش أحلى الأماكن بصوتي.';

/// June to September in Kuwait. [month] is 0-based, as from `Date#getMonth`.
bool isSummerMonth(int month) => month >= 5 && month <= 8;

String placeSuggestLine(Place p) =>
    '${p.nameAr}، في ${p.areaAr}. ${p.taglineAr}';

String placeNameLine(Place p) => p.nameAr.contains(p.areaAr)
    ? '${p.nameAr}.'
    : '${p.nameAr} في ${p.areaAr}.';

String placeBestTimeLine(Place p) => 'أحلى وقت: ${p.bestTimeAr}.';

/// Everything one persona needs recorded (greeting, connectors, and three
/// lines per place), keyed the way the clip manifest is.
Map<String, String> buildClipLines(PersonaId persona, List<Place> list) {
  final lines = <String, String>{
    'hello': helloLine(kPersonas[persona]!.nameAr),
    ...kGenericLines,
  };
  for (final p in list) {
    lines['place-${p.slug}'] = placeSuggestLine(p);
    lines['name-${p.slug}'] = placeNameLine(p);
    lines['best-${p.slug}'] = placeBestTimeLine(p);
  }
  return lines;
}

/// One thing to say. A [key] means a pre-rendered clip can exist for it;
/// [optional] parts (an echo of what was heard) are skipped on the clip path.
class SpeechPart {
  final String? key;
  final String text;
  final bool optional;
  const SpeechPart({this.key, required this.text, this.optional = false});
}

List<SpeechPart> helloParts(PersonaId persona) => [
  SpeechPart(key: 'hello', text: helloLine(kPersonas[persona]!.nameAr)),
];

/// The spoken answer to a search: what to go to, when, then one alternative.
/// [hitTitles] are the matched documents' titles (only used when the query
/// matched categories/areas/pages and there is no place to recommend).
List<SpeechPart> answerParts(
  List<String> hitTitles,
  List<Place> places, {
  String? asked,
  int? month,
}) {
  final a = asked?.trim();
  final echo = (a != null && a.isNotEmpty)
      ? [SpeechPart(text: '$a؟', optional: true)]
      : <SpeechPart>[];

  if (hitTitles.isEmpty) {
    return [
      ...echo,
      SpeechPart(key: 'search-empty', text: kGenericLines['search-empty']!),
    ];
  }
  if (places.isEmpty) {
    return [...echo, SpeechPart(text: 'أقرب شي لطلبك: ${hitTitles.first}.')];
  }
  final top = places.first;
  final parts = <SpeechPart>[
    ...echo,
    SpeechPart(key: 'suggest-intro', text: kGenericLines['suggest-intro']!),
    SpeechPart(key: 'place-${top.slug}', text: placeSuggestLine(top)),
    SpeechPart(key: 'best-${top.slug}', text: placeBestTimeLine(top)),
  ];
  final summer = top.summerOk != true && month != null && isSummerMonth(month);
  if (summer && top.setting == 'outdoor') {
    parts.add(
      SpeechPart(key: 'summer-outdoor', text: kGenericLines['summer-outdoor']!),
    );
  } else if (summer && top.setting == 'mixed') {
    parts.add(
      SpeechPart(key: 'summer-mixed', text: kGenericLines['summer-mixed']!),
    );
  }
  if (places.length > 1) {
    final next = places[1];
    parts.addAll([
      SpeechPart(key: 'related-intro', text: kGenericLines['related-intro']!),
      SpeechPart(key: 'name-${next.slug}', text: placeNameLine(next)),
    ]);
  }
  return parts;
}

/// What to say on a place page: this place, then up to two related ones.
List<SpeechPart> placeSuggestParts(Place place, List<Place> related) {
  final parts = [
    SpeechPart(key: 'place-${place.slug}', text: placeSuggestLine(place)),
  ];
  if (related.isNotEmpty) {
    parts.add(
      SpeechPart(key: 'related-intro', text: kGenericLines['related-intro']!),
    );
    for (final r in related.take(2)) {
      parts.add(SpeechPart(key: 'name-${r.slug}', text: placeNameLine(r)));
    }
  }
  return parts;
}
