/// Port of `src/lib/salem-followup.ts` — what a short reply to سالم means, the
/// chat's memory in the free build. The web file carries the reasons; in
/// short, a message is read against the last answer first:
///
///  - «أرخص», «داخلي», «للعيال» narrow it (the words are added to the last
///    question and it is asked again — `answerOrder` knows what they mean);
///  - «غيره», «شي ثاني» shows the next places of the same answer;
///  - «الثاني», «رقم ٣» picks one of the places on screen;
///  - «وين بالضبط؟» answers where, for the place being pointed at;
///  - anything else is a new question, and the memory starts again.
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

enum FollowUpKind { newQuestion, refine, more, pick, where }

class FollowUp {
  final FollowUpKind kind;

  /// The question to ask, for [FollowUpKind.newQuestion] and
  /// [FollowUpKind.refine].
  final String? query;

  /// What a refinement added.
  final String? added;

  /// The place, for [FollowUpKind.pick] and [FollowUpKind.where].
  final String? slug;

  const FollowUp._(this.kind, {this.query, this.added, this.slug});

  /// The web's `kind` string, for the parity fixtures.
  String get wire => switch (kind) {
    FollowUpKind.newQuestion => 'new',
    FollowUpKind.refine => 'refine',
    FollowUpKind.more => 'more',
    FollowUpKind.pick => 'pick',
    FollowUpKind.where => 'where',
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
final Set<String> _last = _fold(const ['الاخير', 'الاخيره', 'اخر', 'اخرها']);

/// Words that narrow an answer. «مو غالي» is two of them.
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
  'العصر', 'الحين', 'باجر', 'الويكند', 'قريب', 'قريبه',
]);

final RegExp _nonWord = RegExp(r'[^\p{L}\p{N}]+', unicode: true);

bool _known(String w) =>
    _filler.contains(w) ||
    _more.contains(w) ||
    _where.contains(w) ||
    _refiners.contains(w) ||
    _ordinals.containsKey(w) ||
    _last.contains(w);

/// The words of a message, folded, with a leading «و» peeled off a word the
/// lists know: «وللعيال» is «للعيال», «وأرخص» is «أرخص».
List<String> _words(String message) => normalise(message)
    .split(_nonWord)
    .where((w) => w.isNotEmpty)
    .map(
      (w) =>
          w.length > 2 &&
              w.startsWith('و') &&
              !_known(w) &&
              _known(w.substring(1))
          ? w.substring(1)
          : w,
    )
    .toList();

/// The longest reply that is read as a follow-up rather than a question.
const int _short = 4;

FollowUp readFollowUp(String message, ChatContext? ctx, [String? active]) {
  final text = message.trim();
  final asNew = FollowUp._(FollowUpKind.newQuestion, query: text);
  if (ctx == null || ctx.shown.isEmpty) return asNew;
  final all = _words(text);
  final core = all.where((w) => !_filler.contains(w)).toList();
  if (all.isEmpty || all.length > _short + 2) return asNew;

  // A position on screen: «الثاني», «رقم ٢», «الأخير».
  final ordinal = core.where(_ordinals.containsKey).firstOrNull;
  if (ordinal != null &&
      core.every(
        (w) => _ordinals.containsKey(w) || _ordinalFiller.contains(w),
      )) {
    final at = _ordinals[ordinal]!;
    if (at < ctx.shown.length) {
      return FollowUp._(FollowUpKind.pick, slug: ctx.shown[at]);
    }
  }
  if (core.isNotEmpty &&
      core.any(_last.contains) &&
      core.every((w) => _last.contains(w) || _ordinalFiller.contains(w))) {
    return FollowUp._(FollowUpKind.pick, slug: ctx.shown.last);
  }

  // Where — and only where: «وين بالضبط؟» is a follow-up, «وين أتعشى» is not.
  if (core.isNotEmpty && core.every(_where.contains)) {
    final slug = active != null && ctx.shown.contains(active)
        ? active
        : ctx.shown.first;
    return FollowUp._(FollowUpKind.where, slug: slug);
  }

  // «غيره», «شي ثاني» — and a bare «ثاني» is «another», not «the second».
  if (core.isNotEmpty && core.every(_more.contains)) {
    return const FollowUp._(FollowUpKind.more);
  }

  // Narrowing: short, and every word one that narrows.
  if (core.isNotEmpty &&
      core.length <= _short &&
      core.every(_refiners.contains)) {
    return FollowUp._(
      FollowUpKind.refine,
      query: '${ctx.query} $text',
      added: text,
    );
  }

  return asNew;
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
