/// Port of `src/lib/salem-followup.ts` — what a short reply to سالم means, the
/// chat's memory in the free build. The web file carries the reasons; in
/// short, a message is read against the last answer first:
///
///  - «أرخص», «داخلي», «للعيال» narrow it (the words are added to the last
///    question and it is asked again — `answerOrder` knows what they mean —
///    and the answer stays inside the places the last one found,
///    [withinAnswer]);
///  - an area name, «السالمية», «بحولي», narrows it to that area;
///  - «غيره», «شي ثاني» shows the next places of the same answer;
///  - «الثاني», «رقم ٣», «أحسن واحد» picks one of the places on screen, and
///    «وين الثاني؟» says where it is;
///  - «وين بالضبط؟» answers where, for the place being pointed at;
///  - anything else is a new question, and the memory starts again.
///
/// And a message that is not about places at all is not searched (8 October):
/// greetings, thanks, «مين أنت», «شنو تقدر تسوي», goodbyes and «تمام» are
/// [FollowUpKind.social], answered in words and never touching the memory; a
/// greeting in front of a question is taken off it and answered first
/// ([FollowUp.opener]); a follow-up with nothing to follow, or «قريب مني» from
/// a screen that does not know where you are, is [FollowUpKind.ask].
///
/// Words are folded with the search's own [normalise], exactly as the index
/// folds them. Replayed against the web's own readings in
/// `test/salem_followup_test.dart` (the `followups` block of
/// `search_parity.json`).
library;

import 'models.dart';
import 'search.dart' show normalise;
import 'voice_lines.dart' show isKuwaitNight, isSummerMonth;

/// What the chat remembers about its last answer.
class ChatContext {
  /// The question that answer was for — refinements included.
  final String query;

  /// Every place that answer found, in its order (up to 40).
  final List<String> ranked;

  /// Those already put on screen, across «غيره» turns.
  final List<String> seen;

  /// The ones on screen in the latest turn.
  final List<String> shown;

  const ChatContext({
    required this.query,
    required this.ranked,
    required this.seen,
    required this.shown,
  });
}

enum FollowUpKind { newQuestion, refine, more, pick, where, social, ask }

/// A message that is not about places. The first four are also the greetings
/// said in front of a question ([FollowUp.opener]). Named as the web names
/// them, so `name` is the wire value.
enum SocialAct {
  salam,
  greet,
  morning,
  evening,
  how,
  thanks,
  afia,
  who,
  notShouq,
  help,
  bye,
  ok,
  no,
}

/// What an [FollowUpKind.ask] asks for.
enum AskWhat { subject, area }

class FollowUp {
  final FollowUpKind kind;

  /// The question to ask, for [FollowUpKind.newQuestion] and
  /// [FollowUpKind.refine].
  final String? query;

  /// What a refinement added.
  final String? added;

  /// The catalogue area a refinement narrows to, as the catalogue spells it.
  final String? area;

  /// The place, for [FollowUpKind.pick] and [FollowUpKind.where].
  final String? slug;

  /// What was said, for [FollowUpKind.social].
  final SocialAct? act;

  /// What is asked back, for [FollowUpKind.ask].
  final AskWhat? what;

  /// A greeting said in front of the message — one of the first four
  /// [SocialAct]s — answered before the answer.
  final SocialAct? opener;

  const FollowUp._(
    this.kind, {
    this.query,
    this.added,
    this.area,
    this.slug,
    this.act,
    this.what,
    this.opener,
  });

  FollowUp _withOpener(SocialAct? o) => FollowUp._(
    kind,
    query: query,
    added: added,
    area: area,
    slug: slug,
    act: act,
    what: what,
    opener: o,
  );

  /// The web's `kind` string, for the parity fixtures.
  String get wire => switch (kind) {
    FollowUpKind.newQuestion => 'new',
    FollowUpKind.refine => 'refine',
    FollowUpKind.more => 'more',
    FollowUpKind.pick => 'pick',
    FollowUpKind.where => 'where',
    FollowUpKind.social => 'social',
    FollowUpKind.ask => 'ask',
  };
}

Set<String> _fold(List<String> words) => {for (final w in words) normalise(w)};

/// Words that carry nothing: «أبي واحد يكون…», «طيب», «لو سمحت».
final Set<String> _filler = _fold(const [
  'ابي', 'ابغى', 'ابا', 'بغيت', 'نبي', 'عطني', 'عطيني', 'وريني', 'شي', //
  'شيء', 'مكان', 'واحد', 'وحده', 'يكون', 'تكون', 'فيه', 'في', 'هذا', //
  'هذي', 'هذاك', 'طيب', 'اوكي', 'اوك', 'ok', 'يعني', 'و', 'بس', 'حلو', //
  'زين', 'عن', 'على', 'ع', 'ال', 'انا', 'احنا', 'لو', 'سمحت', 'تكفى', //
  'ممكن', 'شنو', 'شو', 'ايش', 'عاد', 'هم', 'بعد', 'كذا', 'اذا', 'يا', //
  'سالم', 'الله', 'يخليك', 'لي', 'لنا', 'حق', 'مال',
]);

/// «غيره» — the next places of the same answer.
final Set<String> _more = _fold(const [
  'غيره', 'غيرها', 'غيرهم', 'غير', 'ثاني', 'ثانيه', 'ثانين', 'زود', //
  'اكثر', 'باقي', 'كمان', 'المزيد', 'مزيد', 'خيارات', 'اقتراحات', //
  'بدايل', 'بديل',
]);

/// «وين بالضبط؟» — where, for the place being pointed at.
final Set<String> _where = _fold(const [
  'وين', 'وينه', 'وينها', 'وينهم', 'موقع', 'الموقع', 'موقعه', 'موقعها', //
  'لوكيشن', 'اللوكيشن', 'طريق', 'الطريق', 'بالضبط', 'مكانه', 'مكانها', //
  'خريطه', 'الخريطه', 'العنوان', 'عنوانه', 'هو', 'هي',
]);

/// «الثاني», «رقم ٣» — one of the places on screen, by its position.
final Map<String, int> _ordinals = {
  for (final w in const ['الاول', 'اول', 'اولها', 'الاولى']) normalise(w): 0,
  for (final w in const ['الثاني', 'الثانيه', 'ثانيها']) normalise(w): 1,
  for (final w in const ['الثالث', 'الثالثه', 'ثالث', 'ثالثها'])
    normalise(w): 2,
  for (final w in const ['الرابع', 'الرابعه', 'رابع']) normalise(w): 3,
  for (final w in const ['الخامس', 'الخامسه', 'خامس']) normalise(w): 4,
  for (var d = 1; d <= 8; d++) '$d': d - 1,
};
final Set<String> _ordinalFiller = _fold(const [
  'رقم', 'المكان', 'اللي', 'الي', 'خلنا', 'ناخذ', 'نروح', 'ابي', 'ودي', //
  'هذا', 'واحد',
]);

/// «وين» on its own — see [readFollowUp].
final String _whereAlone = normalise('وين');
final Set<String> _last = _fold(const ['الاخير', 'الاخيره', 'اخر', 'اخرها']);

/// «أحسن واحد» is the first place: the answer's order IS its best guess.
final Set<String> _best = _fold(const [
  'احسن', 'الاحسن', 'افضل', 'الافضل', 'احلى', 'الاحلى', //
]);

/// «كم سعر الأول؟» is the first place, and its card says the price band.
final Set<String> _price = _fold(const [
  'كم', 'بكم', 'سعر', 'سعره', 'سعرها', 'اسعار', 'الاسعار', 'اسعاره', //
  'اسعارها', 'السعر',
]);

/// «قريب مني», «وين أقرب واحد» — the screen does not know where anyone is.
final Set<String> _near = _fold(const [
  'قريب', 'قريبه', 'اقرب', 'الاقرب', 'جنبي', 'حذالي', 'near', 'nearby', //
  'closest', 'nearest',
]);
final Set<String> _nearFiller = _fold(const [
  'مني', 'منا', 'عندي', 'عندنا', 'me', 'us', //
]);

/// Words that narrow an answer. «مو غالي» is two of them. «قريب» is not one:
/// the order cannot know what is near (see [_near]).
final Set<String> _refiners = _fold(const [
  // the price
  'رخيص', 'رخيصه', 'ارخص', 'اقتصادي', 'ميزانيه', 'بلاش', 'غالي', 'مو', //
  'ما', 'مب',
  // inside or out
  'داخلي', 'داخل', 'مكيف', 'مكيفه', 'مسكر', 'برا', 'بره', 'خارجي', 'مكشوف',
  // who with
  'عيال', 'للعيال', 'لعيال', 'اطفال', 'للاطفال', 'صغار', 'عائلي', 'عائليه', //
  'عايلي', 'عائله', 'عايله', 'شباب', 'للشباب', 'بنات', 'ربع', 'الربع', //
  'للربع', 'شخصين', 'زوجتي', 'رومانسي',
  // the kind of outing
  'هادي', 'هادئ', 'هاديه', 'زحمه', 'رايق', 'فخم', 'بحر', 'البحر', 'عالبحر', //
  'بالبحر', 'شاطئ', 'منظر',
  // the hour
  'ليل', 'بالليل', 'الليله', 'سهره', 'عشا', 'غدا', 'فطور', 'ريوق', 'الصبح', //
  'العصر', 'الحين', 'باجر', 'الويكند',
]);

/// The things people say to a person and not to a search box, matched as
/// whole words: «السلام» opens «السلام عليكم» and is never looked for inside
/// «قصر السلام». The web's `SOCIAL`, in the same order.
const List<(SocialAct, List<String>)> _social = [
  (
    SocialAct.salam,
    [
      'السلام عليكم', 'سلام عليكم', 'السلام عليكم ورحمه الله', //
      'السلام عليكم ورحمه الله وبركاته', 'السلام', 'سلام',
    ],
  ),
  (
    SocialAct.greet,
    [
      'هلا', 'هلا والله', 'هلا وغلا', 'هلا فيك', 'هلا بك', 'يا هلا', 'اهلا', //
      'اهلين', 'اهلا وسهلا', 'مرحبا', 'مرحبتين', 'هاي', 'هلو', 'hi', 'hello', //
      'hey', 'salam',
    ],
  ),
  (
    SocialAct.morning,
    ['صباح الخير', 'صباح النور', 'صباح الورد', 'صباحو', 'good morning'],
  ),
  (
    SocialAct.evening,
    ['مساء الخير', 'مساء النور', 'مساء الورد', 'مسا الخير', 'good evening'],
  ),
  (
    SocialAct.how,
    [
      'شلونك', 'شلونكم', 'شلونك اليوم', 'شلون حالك', 'شخبارك', 'شخبارك اليوم', //
      'شلون الحال', 'كيفك', 'كيف حالك', 'عساك بخير', 'عساك طيب', 'how are you',
    ],
  ),
  (
    SocialAct.thanks,
    [
      'شكرا', 'شكرا لك', 'شكرا جزيلا', 'مشكور', 'مشكوره', 'تسلم', 'تسلم يدك', //
      'تسلم ايدك', 'ما قصرت', 'كفو', 'مرسي', 'ميرسي', 'ثانكس', 'ثانكيو', //
      'جزاك الله خير', 'يزاك الله خير', 'الله يجزاك خير', 'thanks', //
      'thank you', 'thx', 'ty',
    ],
  ),
  (
    SocialAct.afia,
    ['يعطيك العافيه', 'الله يعطيك العافيه', 'عطاك الله العافيه'],
  ),
  (
    SocialAct.who,
    [
      'مين انت', 'منو انت', 'من انت', 'انت مين', 'انت منو', 'شنو اسمك', //
      'وش اسمك', 'شسمك', 'شو اسمك', 'اسمك', 'شنو انت', 'انت شنو', 'انت بوت', //
      'انت روبوت', 'انت انسان', 'who are you', 'what is your name', //
      'whats your name',
    ],
  ),
  (
    SocialAct.notShouq,
    ['انت شوق', 'انتي شوق', 'هذي شوق', 'انت شوق ولا سالم'],
  ),
  (
    SocialAct.help,
    [
      'شنو تقدر تسوي', 'شنو تسوي', 'وش تقدر تسوي', 'وش تسوي', 'شتسوي', //
      'شنو عندك', 'وش عندك', 'شعندك', 'ساعدني', 'كيف استخدمك', //
      'شلون استخدمك', 'شلون استخدمه', 'help',
    ],
  ),
  (
    SocialAct.bye,
    [
      'مع السلامه', 'باي', 'باي باي', 'يلا باي', 'يلا سلام', 'فمان الله', //
      'في امان الله', 'تصبح علي خير', 'تصبحون علي خير', 'الله وياك', 'bye', //
      'bye bye', 'goodbye',
    ],
  ),
  (
    SocialAct.ok,
    [
      'اوكي', 'اوك', 'اوكيه', 'ok', 'okay', 'تمام', 'طيب', 'زين', 'ماشي', //
      'حلو', 'ايه', 'اي', 'اكيد', 'نعم', 'يب', 'يس', 'yes', 'هه', 'ه', //
      'هاها', 'lol',
    ],
  ),
  (SocialAct.no, ['لا', 'لا شكرا', 'لا مشكور', 'no', 'no thanks']),
];

final RegExp _nonWord = RegExp(r'[^\p{L}\p{N}]+', unicode: true);
final RegExp _space = RegExp(r'\s+');

List<String> _splitWords(String folded) =>
    folded.split(_nonWord).where((w) => w.isNotEmpty).toList();

/// Phrase (folded words, space-joined) → what it is. Later entries win, as
/// `Map#set` does on the web.
final Map<String, SocialAct> _socialPhrases = {
  for (final (act, phrases) in _social)
    for (final p in phrases) _splitWords(normalise(p)).join(' '): act,
};
final int _longestPhrase = _socialPhrases.keys
    .map((k) => k.split(' ').length)
    .reduce((a, b) => a > b ? a : b);

/// Said to a person, around anything: «يا سالم», «والله», «لو سمحت».
final Set<String> _vocative = _fold(const [
  'يا', 'سالم', 'اخوي', 'حبيبي', 'والله', 'بالله', 'الله', 'يلا', 'يالله', //
  'طال', 'عمرك', 'لو', 'سمحت', 'بليز', 'please', 'تكفى', 'ياخي', 'يالغالي', //
  'الغالي',
]);
const Set<SocialAct> _openers = {
  SocialAct.salam,
  SocialAct.greet,
  SocialAct.morning,
  SocialAct.evening,
};

/// Taken off the front or the back of a question without a word said back.
const Set<SocialAct> _silent = {SocialAct.thanks, SocialAct.afia, SocialAct.ok};

/// When a message is several of these, the one that is answered.
const List<SocialAct> _priority = [
  SocialAct.notShouq,
  SocialAct.who,
  SocialAct.help,
  SocialAct.how,
  SocialAct.bye,
  SocialAct.afia,
  SocialAct.thanks,
  SocialAct.no,
  SocialAct.ok,
  SocialAct.salam,
  SocialAct.morning,
  SocialAct.evening,
  SocialAct.greet,
];

/// The social phrase starting at [i], longest first.
(SocialAct, int)? _phraseAt(List<String> words, int i) {
  final most = words.length - i;
  for (var len = _longestPhrase < most ? _longestPhrase : most; len >= 1; len--) {
    final act = _socialPhrases[words.sublist(i, i + len).join(' ')];
    if (act != null) return (act, len);
  }
  return null;
}

/// The social phrase ending at [j] (exclusive), longest first.
(SocialAct, int)? _phraseBefore(List<String> words, int j, int from) {
  final most = j - from;
  for (var len = _longestPhrase < most ? _longestPhrase : most; len >= 1; len--) {
    final act = _socialPhrases[words.sublist(j - len, j).join(' ')];
    if (act != null) return (act, len);
  }
  return null;
}

/// A folded word and the typed unit it came from, so the part of a question
/// left after its greeting is handed on in the visitor's own spelling.
typedef _Word = ({String w, int unit});

({List<_Word> words, List<String> units}) _wordsOf(String message) {
  final units = message.split(_space).where((u) => u.isNotEmpty).toList();
  final words = <_Word>[
    for (var unit = 0; unit < units.length; unit++)
      for (final w in _splitWords(normalise(units[unit]))) (w: w, unit: unit),
  ];
  return (words: words, units: units);
}

bool _known(String w) =>
    _filler.contains(w) ||
    _more.contains(w) ||
    _where.contains(w) ||
    _refiners.contains(w) ||
    _ordinals.containsKey(w) ||
    _last.contains(w) ||
    _best.contains(w) ||
    _price.contains(w) ||
    _near.contains(w);

/// A leading «و» peeled off a word the lists know: «وللعيال» is «للعيال».
String _peelWaw(String w) =>
    w.length > 2 && w.startsWith('و') && !_known(w) && _known(w.substring(1))
    ? w.substring(1)
    : w;

/// The words of a message, folded, each with its «و» peeled.
List<String> _words(String message) =>
    _splitWords(normalise(message)).map(_peelWaw).toList();

/// The longest reply that is read as a follow-up rather than a question.
const int _short = 4;

final RegExp _gluedParticle = RegExp(r'^(?:بال|لل|ب|ل)(.+)$');

/// A catalogue area named by the whole of [core] — «السالمية», «بحولي», «في
/// مدينة الكويت» — as the catalogue spells it, or null.
String? _areaNamed(List<String> core, Map<String, String>? areas) {
  if (areas == null || core.isEmpty || core.length > 3) return null;
  final joined = core.join(' ');
  final tries = [joined];
  // «بالسالمية», «لحولي» — a particle glued to the first word.
  final m = _gluedParticle.firstMatch(joined);
  if (m != null) tries.addAll([m[1]!, 'ال${m[1]}']);
  // «سالمية» for «السالمية».
  tries.add('ال$joined');
  for (final t in tries) {
    final hit = areas[t];
    if (hit != null) return hit;
  }
  return null;
}

/// The catalogue's areas, folded → as written, for [readFollowUp].
Map<String, String> areaIndex(Iterable<String> areaNames) => {
  for (final name in areaNames) _splitWords(normalise(name)).join(' '): name,
};

FollowUp readFollowUp(
  String message,
  ChatContext? ctx, [
  String? active,
  Map<String, String>? areas,
]) {
  final text = message.trim();
  final parsed = _wordsOf(text);
  final all = parsed.words;
  final units = parsed.units;
  final remembers = ctx != null && ctx.shown.isNotEmpty;
  if (all.isEmpty) {
    // «؟», «👍» — punctuation or an emoji, nothing to read.
    return text.isNotEmpty
        ? FollowUp._(
            FollowUpKind.social,
            act: remembers ? SocialAct.ok : SocialAct.greet,
          )
        : FollowUp._(FollowUpKind.newQuestion, query: text);
  }

  // What is said to a person, at the front and the back. Every act is noted;
  // only greetings, thanks and «تمام» are taken off a message that goes on to
  // say something else — «لا أبي شي مو غالي» is not a «no».
  final w = [for (final x in all) x.w];
  final lead = <SocialAct>[];
  var i = 0;
  while (i < w.length) {
    final p = _phraseAt(w, i);
    if (p != null) {
      lead.add(p.$1);
      i += p.$2;
    } else if (_vocative.contains(w[i])) {
      i += 1;
    } else {
      break;
    }
  }
  final trail = <SocialAct>[];
  var j = w.length;
  while (j > i) {
    final p = _phraseBefore(w, j, i);
    if (p != null) {
      trail.insert(0, p.$1);
      j -= p.$2;
    } else if (_vocative.contains(w[j - 1])) {
      j -= 1;
    } else {
      break;
    }
  }

  // All of it is said to a person: answer that, and read nothing else.
  if (i >= j) {
    final acts = [...lead, ...trail];
    if (acts.isEmpty) {
      return const FollowUp._(FollowUpKind.social, act: SocialAct.greet);
    }
    final act = _priority.firstWhere(acts.contains);
    final greeting = acts.where(_openers.contains).firstOrNull;
    const withGreeting = {
      SocialAct.how,
      SocialAct.who,
      SocialAct.help,
      SocialAct.notShouq,
    };
    return greeting != null &&
            !_openers.contains(act) &&
            withGreeting.contains(act)
        ? FollowUp._(FollowUpKind.social, act: act, opener: greeting)
        : FollowUp._(FollowUpKind.social, act: act);
  }
  // A greeting in front of a question is answered first; a «no», a «who» or a
  // goodbye in front of one is not a greeting, and the message is read whole.
  bool peelable(List<SocialAct> acts) =>
      acts.every((a) => _openers.contains(a) || _silent.contains(a));
  if (!peelable(lead)) i = 0;
  if (!peelable(trail)) j = w.length;
  final opener = lead.where(_openers.contains).firstOrNull;
  final from = i;
  FollowUp withOpener(FollowUp f) =>
      opener != null && from > 0 ? f._withOpener(opener) : f;

  final kept = all.sublist(i, j);
  // The question as typed, without the greeting: every typed unit with a word
  // left in it.
  final keptUnits = {for (final x in kept) x.unit};
  final rest = i == 0 && j == w.length
      ? text
      : [
          for (var u = 0; u < units.length; u++)
            if (keptUnits.contains(u)) units[u],
        ].join(' ');
  final restWords = [for (final x in kept) _peelWaw(x.w)];
  final core = restWords.where((x) => !_filler.contains(x)).toList();
  final asNew = withOpener(FollowUp._(FollowUpKind.newQuestion, query: rest));

  // «قريب مني» — there is nothing on this screen to be near to.
  if (core.any(_near.contains) &&
      core.every(
        (x) =>
            _near.contains(x) ||
            _nearFiller.contains(x) ||
            _where.contains(x) ||
            _more.contains(x) ||
            _ordinalFiller.contains(x),
      )) {
    return withOpener(const FollowUp._(FollowUpKind.ask, what: AskWhat.area));
  }

  // A follow-up with nothing to follow: «غيره», «وين بالضبط؟», «الثاني» as the
  // first thing said, or after a question that found nothing. «وين» alone is
  // not one — «وين نروح» is the commonest question there is.
  bool followOnly(String x) =>
      _more.contains(x) ||
      _where.contains(x) ||
      _ordinals.containsKey(x) ||
      _ordinalFiller.contains(x) ||
      _last.contains(x) ||
      _best.contains(x) ||
      _price.contains(x);
  bool followWord(String x) =>
      _more.contains(x) ||
      (_where.contains(x) && x != _whereAlone) ||
      _ordinals.containsKey(x) ||
      _last.contains(x) ||
      _best.contains(x) ||
      _price.contains(x);
  if (!remembers) {
    if (core.isNotEmpty && core.every(followOnly) && core.any(followWord)) {
      return withOpener(
        const FollowUp._(FollowUpKind.ask, what: AskWhat.subject),
      );
    }
    // «غيره أرخص» with nothing before it is «أرخص»: there is no «غيره» to give.
    if (core.any(_more.contains) && !core.every(_more.contains)) {
      final units2 = {
        for (final x in kept)
          if (!_more.contains(_peelWaw(x.w))) x.unit,
      };
      return withOpener(
        FollowUp._(
          FollowUpKind.newQuestion,
          query: [
            for (var u = 0; u < units.length; u++)
              if (units2.contains(u)) units[u],
          ].join(' '),
        ),
      );
    }
    return asNew;
  }
  if (restWords.length > _short + 2) return asNew;

  // A position on screen: «الثاني», «رقم ٢», «الأخير», «أحسن واحد» — and
  // where it is, when that is what was asked: «وين الثاني؟».
  bool positional(String x) =>
      _ordinals.containsKey(x) ||
      _ordinalFiller.contains(x) ||
      _last.contains(x) ||
      _best.contains(x) ||
      _where.contains(x) ||
      _price.contains(x);
  if (core.isNotEmpty && core.every(positional)) {
    final ordinal = core.where(_ordinals.containsKey).firstOrNull;
    final at = ordinal != null ? _ordinals[ordinal]! : null;
    final String? slug = at != null
        ? (at < ctx.shown.length ? ctx.shown[at] : null)
        : core.any(_last.contains)
        ? ctx.shown.last
        : core.any(_best.contains)
        ? ctx.shown.first
        : null;
    if (slug != null) {
      return withOpener(
        FollowUp._(
          core.any(_where.contains) ? FollowUpKind.where : FollowUpKind.pick,
          slug: slug,
        ),
      );
    }
  }

  final pointed = active != null && ctx.shown.contains(active)
      ? active
      : ctx.shown.first;

  // «كم سعره؟» — the place being pointed at, or the first.
  if (core.isNotEmpty &&
      core.any(_price.contains) &&
      core.every((x) => _price.contains(x) || _where.contains(x))) {
    return withOpener(FollowUp._(FollowUpKind.pick, slug: pointed));
  }

  // Where — and only where: «وين بالضبط؟» is a follow-up, «وين أتعشى» is not.
  if (core.isNotEmpty && core.every(_where.contains)) {
    return withOpener(FollowUp._(FollowUpKind.where, slug: pointed));
  }

  // «غيره», «شي ثاني» — and a bare «ثاني» is «another», not «the second».
  if (core.isNotEmpty && core.every(_more.contains)) {
    return withOpener(const FollowUp._(FollowUpKind.more));
  }

  // Narrowing: short, and every word one that narrows. «غيره أرخص» is the
  // same narrowing — the «غيره» says nothing the narrowed answer does not.
  final refining = core.where((x) => !_more.contains(x)).toList();
  if (refining.isNotEmpty &&
      refining.length <= _short &&
      refining.every(_refiners.contains)) {
    final added = core.length == refining.length
        ? rest
        : [
            for (final x in kept)
              if (!_more.contains(_peelWaw(x.w))) x.w,
          ].join(' ');
    return withOpener(
      FollowUp._(
        FollowUpKind.refine,
        query: '${ctx.query} $added',
        added: added,
      ),
    );
  }

  // An area: the last answer, there. «قهوة» then «السالمية» is coffee in
  // Salmiya, not everything in Salmiya.
  final area = _areaNamed(core, areas);
  if (area != null) {
    return withOpener(
      FollowUp._(
        FollowUpKind.refine,
        query: '${ctx.query} $area',
        added: rest,
        area: area,
      ),
    );
  }

  return asNew;
}

/// A narrowed question's places, kept to the ones the answer it narrows had
/// found, in the narrowed order: «قهوة» then «أرخص» is cheaper coffee, not
/// everything cheap with the zoo in it.
List<String> withinAnswer(List<String> ranked, ChatContext ctx) {
  final had = ctx.ranked.toSet();
  return ranked.where(had.contains).toList();
}

/// The next places of the same answer, for «غيره». Empty when it has none.
List<String> nextPlaces(ChatContext ctx, [int count = 8]) {
  final seen = ctx.seen.toSet();
  return ctx.ranked.where((s) => !seen.contains(s)).take(count).toList();
}

/// The replies offered under an answer — only the ones that would change it,
/// at most four, so the row stays one row on a phone.
List<String> followUpChips(
  ChatContext ctx,
  List<Place> shown, {
  required int month,
  required int hour,
}) {
  final asked = _words(ctx.query).toSet();
  bool has(List<String> w) => w.any((x) => asked.contains(normalise(x)));
  final chips = <String>[];
  if (!has(const ['رخيص', 'رخيصه', 'ارخص', 'اقتصادي', 'ميزانيه']) &&
      shown.any((p) => p.priceLevel > 1)) {
    chips.add('أرخص');
  }
  if (isSummerMonth(month) &&
      !isKuwaitNight(hour) &&
      !has(const ['داخلي', 'مكيف', 'برا', 'بحر']) &&
      shown.any((p) => p.setting != 'indoor' && p.summerOk != true)) {
    chips.add('داخلي');
  }
  if (!has(const ['عيال', 'للعيال', 'اطفال', 'عائلي']) && chips.length < 2) {
    chips.add('للعيال');
  }
  if (nextPlaces(ctx).isNotEmpty) chips.add('غيره');
  chips.add('وين بالضبط؟');
  return chips.take(4).toList();
}
