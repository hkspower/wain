/// Port of `src/lib/voice-lines.ts` — the sentences the personas say, and the
/// preparation that turns a line written to be READ into one fit to be SPOKEN.
/// The same strings feed the recorded clips, the bridge and the on-device
/// voice, so none of them can drift from the others. Replayed against the web
/// in `test/voice_hangout_parity_test.dart`.
library;

import 'arabic.dart';
import 'models.dart';
import 'social_act.dart';

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
  'summer-outdoor': 'بالصيف لا تروح إلا عقب المغرب، النهار حر.',
  'summer-mixed': 'بالنهار خلك بالمكيّف، والمكشوف عقب المغرب.',
  'summer-early': 'بالصيف روح بدري الصبح، قبل لا يحمى الجو.',
  // Said back to what is said to a person (8 October) — the web's lines,
  // keyed the same, so the clip library is one library.
  'social-salam': 'وعليكم السلام ورحمة الله!',
  'social-greet': 'هلا والله!',
  'social-morning': 'صباح النور!',
  'social-evening': 'مساء النور!',
  'social-how': 'بخير الحمدلله!',
  'social-thanks': 'العفو! إذا تبي شي ثاني، قول لي.',
  'social-afia': 'الله يعافيك! إذا تبي شي ثاني، قول لي.',
  'social-help':
      'أدوّر لك وين تطلع بالكويت — قهوة، بحر، مطاعم، طلعة عيال، أسواق. قول لي وش تبي.',
  'social-bye': 'مع السلامة! تلاقيني هني إذا احتجت شي.',
  'social-ok': 'تمام!',
  'social-no': 'ماشي! إذا غيّرت رايك، قول لي.',
  'ask-what': 'قول لي وش تبي — قهوة، بحر، مطعم، ولا طلعة عيال.',
  'ask-area':
      'ما أدري وين أنت بالضبط. قول لي المنطقة — السالمية، حولي، مدينة الكويت — وأدوّر لك.',
};

/// The lines that name the speaker: «مين أنت؟» and «أنت شوق؟».
Map<String, String> personaLines(PersonaId persona) {
  final name = kPersonas[persona]!.nameAr;
  return {
    'social-who': 'أنا $name من وين، أدوّر لك وين تطلع بالكويت.',
    'social-not-shouq': persona == PersonaId.shouq
        ? 'إيه، أنا شوق!'
        : 'لا، أنا $name!',
  };
}

/// What is read beside the answer rather than searched for — the web's
/// `Special` (answer-order.ts): a message that is not about places, «قريب
/// مني», or a part of Kuwait the catalogue has nothing in.
sealed class Special {
  const Special();
}

class SocialSpecial extends Special {
  final SocialAct act;
  final SocialAct? opener;
  const SocialSpecial(this.act, [this.opener]);
}

class NearSpecial extends Special {
  const NearSpecial();
}

class ElsewhereSpecial extends Special {
  final String name;
  const ElsewhereSpecial(this.name);
}

/// The acts answered with the question back after their line.
const Set<SocialAct> _socialTail = {
  SocialAct.salam,
  SocialAct.greet,
  SocialAct.morning,
  SocialAct.evening,
  SocialAct.how,
  SocialAct.who,
  SocialAct.notShouq,
  SocialAct.ok,
};

SpeechPart _keyed(String key, PersonaId persona, {bool note = false}) {
  final text = kGenericLines[key] ?? personaLines(persona)[key]!;
  return SpeechPart(key: key, text: text, note: note);
}

/// The answer to a message that is not about places, in the given voice
/// (`socialParts` on the web).
List<SpeechPart> socialParts(
  SocialAct act, [
  SocialAct? opener,
  PersonaId persona = PersonaId.shouq,
]) => [
  if (opener != null) _keyed(socialKey(opener), persona, note: true),
  _keyed(socialKey(act), persona),
  if (_socialTail.contains(act)) _keyed('ask-what', persona, note: true),
];

/// «ما عندي أماكن بالجهراء الحين.» — not fixed per place, so not a clip.
String elsewhereLine(String name) =>
    'ما عندي أماكن ب$name الحين. قول لي منطقة ثانية، أو وش تبي وأدوّر لك.';

/// «ما عندي «ياباني» بالضبط، بس هذا أقرب شي.» — said before the place.
String missedLine(List<String> words) {
  final named = words.take(2).map((w) => '«$w»').join(' و');
  return 'ما عندي $named بالضبط، بس هذا أقرب شي.';
}

String helloLine(String nameAr) =>
    'هلا! أنا $nameAr. من الحين، لما تدوّر أقول لك وش أحلى الأماكن بصوتي.';

/// June to September in Kuwait. [month] is 0-based, as from `Date#getMonth`.
bool isSummerMonth(int month) => month >= 5 && month <= 8;

/// Seven in the evening to five in the morning, when «don't go until after
/// sunset» has already come true (`isKuwaitNight` on the web).
bool isKuwaitNight(int hour) => hour >= 19 || hour < 5;

/// «جرّب سوق المباركية بمدينة الكويت.» — one fixed sentence per place, the
/// area left off when the name already carries it.
String placeTryLine(Place p) => p.nameAr.contains(p.areaAr)
    ? 'جرّب ${p.nameAr}.'
    : 'جرّب ${p.nameAr} ب${p.areaAr}.';

/// When to go — «روح …», not the form-like «أحلى وقت: …».
String placeBestTimeLine(Place p) => 'روح ${p.bestTimeAr}.';

final RegExp _evening = RegExp('(المغرب|وقت الغروب|الليل|ليالي|العشا)');
final RegExp _daytime = RegExp('(الصبح|بدري|العصر|الظهر|النهار)');
final RegExp _morning = RegExp('(الصبح|بدري)');

/// A best time that names the morning and never the evening.
bool isMorningPlace(Place p) =>
    _morning.hasMatch(p.bestTimeAr) && !_evening.hasMatch(p.bestTimeAr);

/// Which summer line belongs to this place, once it is summer and daytime.
String summerKey(Place p) {
  if (isMorningPlace(p)) return 'summer-early';
  return p.setting == 'mixed' ? 'summer-mixed' : 'summer-outdoor';
}

/// Everything one persona needs recorded (greeting, the fixed lines, and two
/// lines per place), keyed the way the clip manifest is.
Map<String, String> buildClipLines(PersonaId persona, List<Place> list) {
  final lines = <String, String>{
    'hello': helloLine(kPersonas[persona]!.nameAr),
    ...kGenericLines,
    ...personaLines(persona),
  };
  for (final p in list) {
    lines['try-${p.slug}'] = placeTryLine(p);
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

  /// A sentence around the answer rather than the answer — a greeting said
  /// back, «ما عندي «ياباني» بالضبط», «قول لي وش تبي» — shown beside the lead
  /// and said in its place, never folded away (`note` on the web).
  final bool note;
  const SpeechPart({
    this.key,
    required this.text,
    this.optional = false,
    this.note = false,
  });
}

List<SpeechPart> helloParts(PersonaId persona) => [
  SpeechPart(key: 'hello', text: helloLine(kPersonas[persona]!.nameAr)),
];

/// What to say about WHEN: the best time, the heat line instead of it, both,
/// or neither — `whenParts` on the web, whose comment carries the reasons.
List<SpeechPart> whenParts(Place p, int? month, int? hour) {
  final best = SpeechPart(key: 'best-${p.slug}', text: placeBestTimeLine(p));
  final hot =
      month != null &&
      isSummerMonth(month) &&
      p.summerOk != true &&
      p.setting != 'indoor';
  if (!hot) return [best];
  final night = hour != null && isKuwaitNight(hour);
  final key = summerKey(p);
  final heat = SpeechPart(key: key, text: kGenericLines[key]!);
  if (key == 'summer-early') return night ? [best] : [heat];
  if (key == 'summer-outdoor') {
    if (!night) return [heat];
    return _evening.hasMatch(p.bestTimeAr) && !_daytime.hasMatch(p.bestTimeAr)
        ? [best]
        : const [];
  }
  return night || _evening.hasMatch(p.bestTimeAr) ? [best] : [best, heat];
}

/// The spoken answer to a search: the place and where it is, then when to go
/// — about nine seconds. The tagline and a second place are on screen in the
/// cards, and are not said (3 October). [hitTitles] are the matched
/// documents' titles (only used when the query matched categories, areas or
/// pages and there is no place to recommend). [month] and [hour] are
/// Kuwait's.
List<SpeechPart> answerParts(
  List<String> hitTitles,
  List<Place> places, {
  String? asked,
  int? month,
  int? hour,
  Special? special,
  SocialAct? opener,
  List<String>? missed,
}) {
  final a = asked?.trim();
  final echo = (a != null && a.isNotEmpty)
      ? [SpeechPart(text: '$a؟', optional: true)]
      : <SpeechPart>[];
  final open = opener != null
      ? [_keyed(socialKey(opener), PersonaId.shouq, note: true)]
      : <SpeechPart>[];

  switch (special) {
    case SocialSpecial(:final act, :final opener):
      return [...echo, ...socialParts(act, opener)];
    case NearSpecial():
      return [...echo, ...open, _keyed('ask-area', PersonaId.shouq)];
    case ElsewhereSpecial(:final name):
      return [...echo, ...open, SpeechPart(text: elsewhereLine(name))];
    case null:
      break;
  }

  if (places.isEmpty) {
    if (hitTitles.isEmpty) {
      return [
        ...echo,
        ...open,
        SpeechPart(key: 'search-empty', text: kGenericLines['search-empty']!),
      ];
    }
    return [
      ...echo,
      ...open,
      SpeechPart(text: 'أقرب شي لطلبك: ${hitTitles.first}.'),
    ];
  }
  final top = places.first;
  return [
    ...echo,
    ...open,
    if (missed != null && missed.isNotEmpty)
      SpeechPart(text: missedLine(missed), note: true),
    SpeechPart(key: 'try-${top.slug}', text: placeTryLine(top)),
    ...whenParts(top, month, hour),
  ];
}

/// What to say on a place page — the same two lines, with no season.
List<SpeechPart> placeSuggestParts(Place place) => [
  SpeechPart(key: 'try-${place.slug}', text: placeTryLine(place)),
  SpeechPart(key: 'best-${place.slug}', text: placeBestTimeLine(place)),
];
