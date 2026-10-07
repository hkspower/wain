/// Port of `src/lib/hangout.ts` — «رسّلها للربع». Turning a place into a plan
/// the group can answer with «تمام»: this place, at this time, with the map
/// attached. Nothing is stored and nothing is sent to wain; the message is
/// composed on the device and handed to whatever the person already uses.
///
/// Kuwait is UTC+3 all year, so every clock question here is asked of the
/// instant shifted by three hours — never of the device's own timezone.
library;

import '../data/models.dart';
import '../data/voice_lines.dart';
import '../data/text_kit.dart' show distanceKm;
import 'plan_date.dart';

export 'plan_date.dart';

/// How many places the panel offers to switch between, on search and in
/// سالم's chat alike (`CHOICE_MAX` on the web).
const int kChoiceMax = 5;

class WhenOption {
  final WhenId id;
  final String labelAr;
  final String phraseAr;
  final int? afterHour;
  const WhenOption(this.id, this.labelAr, this.phraseAr, [this.afterHour]);
}

const List<WhenOption> _all = [
  WhenOption(WhenId.now, 'الحين', 'الحين'),
  WhenOption(WhenId.soon, 'بعد ساعة', 'بعد ساعة'),
  // «عقب المغرب»: the words شوق uses for every summer plan; first among the
  // evening options, gone at seven. No clock time is attached anywhere a
  // person reads — the calendar entry alone turns it into an hour.
  WhenOption(WhenId.sunset, 'عقب المغرب', 'عقب المغرب', 19),
  WhenOption(WhenId.tonight7, '٧ مساءً', 'الليلة الساعة ٧', 19),
  WhenOption(WhenId.tonight8, '٨ مساءً', 'الليلة الساعة ٨', 20),
  WhenOption(WhenId.tonight9, '٩ مساءً', 'الليلة الساعة ٩', 21),
  WhenOption(WhenId.tonight10, '١٠ مساءً', 'الليلة الساعة ١٠', 22),
  WhenOption(WhenId.tomorrow, 'باچر', 'باچر'),
  WhenOption(WhenId.weekend, 'الويكند', 'الويكند'),
];

const _dayStarts = 9;
const _dayEnds = 19;

bool _bakesInTheSun(Place? place, int arrivalHour, int month) {
  if (place == null || place.summerOk == true || place.setting == 'indoor') {
    return false;
  }
  return isSummerMonth(month) &&
      arrivalHour >= _dayStarts &&
      arrivalHour < _dayEnds;
}

/// The choices worth offering at this hour — and, given a place, at this time
/// of year. Evening slots drop off as they pass; «الحين» and «بعد ساعة» go for
/// a place that would bake in the summer sun.
List<WhenOption> whenOptions([DateTime? now, Place? place]) {
  final t = now ?? DateTime.now();
  final hour = kuwaitHour(t);
  final month = kuwaitMonth(t);
  return _all.where((o) {
    if (o.afterHour != null && hour >= o.afterHour!) return false;
    if (o.id == WhenId.now && _bakesInTheSun(place, hour, month)) return false;
    if (o.id == WhenId.soon && _bakesInTheSun(place, hour + 1, month))
      return false;
    return true;
  }).toList();
}

/// Which one to offer first.
WhenId defaultWhen(Place place, [DateTime? now]) {
  final t = now ?? DateTime.now();
  final hour = kuwaitHour(t);
  final options = whenOptions(t).map((o) => o.id).toSet();
  final daytimeIsFine = place.setting == 'indoor' || place.summerOk == true;
  // In summer an open-air place is proposed for after sunset — the words
  // شوق says about it. Before seven only.
  if (!daytimeIsFine &&
      isSummerMonth(kuwaitMonth(t)) &&
      options.contains(WhenId.sunset)) {
    return WhenId.sunset;
  }
  if (hour >= 9 &&
      hour < 12 &&
      daytimeIsFine &&
      options.contains(WhenId.soon)) {
    return WhenId.soon;
  }
  // Thursday and Friday propose the weekend (the web's defaultWhen, 7
  // October): below the heat and the morning «بعد ساعة», before ten at night.
  final wd = weekday(kuwaitDay(t));
  if ((wd == 4 || wd == 5) && hour < 22 && options.contains(WhenId.weekend)) {
    return WhenId.weekend;
  }
  if (options.contains(WhenId.tonight8)) return WhenId.tonight8;
  if (options.contains(WhenId.tonight10)) return WhenId.tonight10;
  return WhenId.tomorrow;
}

String phraseFor(WhenId id) => _all.firstWhere((o) => o.id == id).phraseAr;

/// The phrase with its day, when the day is known: «باچر الخميس», «الويكند —
/// الجمعة». Only the two day-words gain a weekday.
String planPhrase(WhenId id, String? day, [DateTime? now]) {
  final phrase = phraseFor(id);
  if (day == null) return phrase;
  final plan = resolvePlan(id, day, now);
  if (id == WhenId.tomorrow) return '$phrase ${plan.weekdayAr}';
  if (id == WhenId.weekend) return '$phrase — ${plan.weekdayAr}';
  return phrase;
}

/// The map link the messages carry — directions to the pin.
String mapsUrl(Place place) =>
    'https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}';

/// The message itself, one person talking to their group. The heat warning is
/// the very sentence شوق says aloud, imported rather than retyped.
String hangoutMessage({
  required Place place,
  required WhenId when,
  required String url,
  DateTime? now,
}) {
  final t = now ?? DateTime.now();
  final month = kuwaitMonth(t);
  final hour = kuwaitHour(t);
  final arrival = when == WhenId.now
      ? hour
      : when == WhenId.soon
      ? hour + 1
      : _dayStarts + 2;
  final daytimePlan =
      when == WhenId.now ||
      when == WhenId.soon ||
      when == WhenId.tomorrow ||
      when == WhenId.weekend;
  // `summerKey`: a morning market is told «روح بدري الصبح», not «لا تروح
  // إلا عقب المغرب» (3 October, as on the web).
  final heat = daytimePlan && _bakesInTheSun(place, arrival, month)
      ? kGenericLines[summerKey(place)]!
      : '';
  return [
    '${place.nameAr} — ${place.areaAr} 📍',
    // Composed at the moment of sending, so the day is always known here.
    planPhrase(when, kuwaitDay(t), t),
    '',
    place.taglineAr,
    if (heat.isNotEmpty) heat,
    '',
    'الموقع: ${mapsUrl(place)}',
    url,
  ].join('\n');
}

const inviteParam = 'when';

/// Built from the slug, never from an address bar, so it cannot compound.
/// [day] is the Kuwait day of sending (plan_date.dart); optional, so every
/// link already in a chat keeps meaning what it meant.
String inviteUrl(Place place, WhenId when, String origin, [String? day]) {
  final base =
      '${origin.replaceAll(RegExp(r'/+$'), '')}/places/${place.slug}/?$inviteParam=${when.wire}';
  return day != null ? '$base&$dayParam=$day' : base;
}

/// The sending day in a link, or null — absent on links from before 3 October.
String? readInviteDay(String search) => parseDay(_firstParam(search, dayParam));

/// The FIRST value of [key] in a query string, as `URLSearchParams#get`
/// gives — `Uri.splitQueryString` keeps the last, which would let a pasted
/// link with two of them disagree with the web about what it carries. Null
/// when the key is absent.
String? _firstParam(String search, String key) {
  final q = search.startsWith('?') ? search.substring(1) : search;
  for (final pair in q.split('&')) {
    final eq = pair.indexOf('=');
    final k = Uri.decodeQueryComponent(eq < 0 ? pair : pair.substring(0, eq));
    if (k != key) continue;
    return eq < 0 ? '' : Uri.decodeQueryComponent(pair.substring(eq + 1));
  }
  return null;
}

/// The time in a link, or null. Validated against the known ids: an unknown
/// one is simply not an invitation.
WhenId? readInvite(String search) {
  final raw = _firstParam(search, inviteParam);
  return raw == null ? null : WhenId.parse(raw);
}

/// Has the invited hour already gone? Only answerable for the four evening
/// slots; «الحين», «باچر» and «الويكند» are relative to a moment the link
/// does not carry, and claiming otherwise would be inventing a fact.
bool invitePassed(WhenId when, [DateTime? now, String? day]) {
  // With the sending day in hand every kind of plan can be judged.
  if (day != null) return resolvePlan(when, day, now).passed;
  final o = _all.firstWhere((o) => o.id == when);
  if (o.afterHour == null) return false;
  return kuwaitHour(now ?? DateTime.now()) >= o.afterHour!;
}

String inviteAcceptMessage(Place place, WhenId when) =>
    'تمام، أنا معكم 👍 ${place.nameAr} — ${phraseFor(when)}';

// ── the shortlist: two or three places, and the group picks ──────────────
//
// «خلّهم يختارون» — when the sender has not decided either (hangout.ts, 3
// October). The panel can send a short list with one time on it, and a link
// that opens those places on a map where each person sends back the one they
// want (`/pick`). Three at most: «اختاروا من ثمانية» is the argument again.

const int kShortlistMax = 3;
const String shortlistParam = 'p';
const List<String> _ordinalAr = ['١', '٢', '٣'];

/// The times that fit every place on the list — the summer rule, for each.
List<WhenOption> whenOptionsFor(List<Place> list, [DateTime? now]) {
  final t = now ?? DateTime.now();
  final sets = [
    for (final p in list) {for (final o in whenOptions(t, p)) o.id},
  ];
  return whenOptions(t)
      .where((o) => sets.every((s) => s.contains(o.id)))
      .toList();
}

/// The first time to offer for a list: the first place's own default, if it
/// fits them all, else the evening, else tomorrow.
WhenId defaultWhenFor(List<Place> list, [DateTime? now]) {
  final t = now ?? DateTime.now();
  final ok = {for (final o in whenOptionsFor(list, t)) o.id};
  final first = list.isNotEmpty ? defaultWhen(list.first, t) : WhenId.tomorrow;
  if (ok.contains(first)) return first;
  if (ok.contains(WhenId.tonight8)) return WhenId.tonight8;
  if (ok.contains(WhenId.tonight10)) return WhenId.tonight10;
  return WhenId.tomorrow;
}

/// The places «خلّهم يختارون» starts with: the first, then the next ones near
/// it that one time suits too, then the rest in order (the web's
/// `fitShortlist`, 7 October).
const double kShortlistNearKm = 15;
List<Place> fitShortlist(List<Place> choices, [DateTime? now]) {
  final t = now ?? DateTime.now();
  if (choices.length <= kShortlistMax) return choices.take(kShortlistMax).toList();
  final first = choices.first;
  final rest = choices.skip(1).toList();
  final picked = <Place>[first];
  for (final c in rest) {
    if (picked.length == kShortlistMax) break;
    final near = distanceKm((lat: first.lat, lng: first.lng), (lat: c.lat, lng: c.lng)) <= kShortlistNearKm;
    final together = [...picked, c];
    final def = defaultWhenFor(together, t);
    final oneTime = whenOptionsFor(together, t).any((o) => o.id == def);
    if (near && oneTime) picked.add(c);
  }
  for (final c in rest) {
    if (picked.length == kShortlistMax) break;
    if (!picked.contains(c)) picked.add(c);
  }
  return picked;
}

/// `/pick/?p=a,b,c&when=…` — canonical, from the slugs, like [inviteUrl].
/// The poll a shortlist's votes are counted under on wainkw.com (the web's
/// `POLL_PARAM`, lib/votes.ts). Random per message sent.
const String pollParam = 'v';
final RegExp _pollShape = RegExp(r'^[a-z0-9]{10,16}$');

String shortlistUrl(
  List<Place> list,
  WhenId when,
  String origin, [
  String? day,
  String? poll,
]) {
  final slugs = list.take(kShortlistMax).map((p) => p.slug).join(',');
  final base =
      '${origin.replaceAll(RegExp(r'/+$'), '')}/pick/?$shortlistParam=$slugs&$inviteParam=${when.wire}';
  final dated = day != null ? '$base&$dayParam=$day' : base;
  return poll != null && _pollShape.hasMatch(poll) ? '$dated&$pollParam=$poll' : dated;
}

final RegExp _slugShape = RegExp(r'^[a-z0-9-]+$');

/// The slugs and the time in a shortlist link. Each slug is checked against
/// the places that exist ([known]), duplicates dropped, three kept — the link
/// is whatever anyone pasted. Fewer than two left is not a shortlist.
({List<String> slugs, WhenId? when, String? day, String? poll}) readShortlist(
  String search,
  bool Function(String slug) known,
) {
  final raw = (_firstParam(search, shortlistParam) ?? '')
      .split(',')
      .map((s) => s.trim());
  final slugs = <String>[];
  for (final s in raw) {
    if (_slugShape.hasMatch(s) && known(s) && !slugs.contains(s)) slugs.add(s);
    if (slugs.length == kShortlistMax) break;
  }
  return (
    slugs: slugs.length >= 2 ? slugs : const <String>[],
    when: readInvite(search),
    day: readInviteDay(search),
    poll: _pollShape.hasMatch(_firstParam(search, pollParam) ?? '')
        ? _firstParam(search, pollParam)
        : null,
  );
}

/// The message: one time, the places numbered, and the link to vote. Each
/// place gets what a single plan gets — what it is, why it is worth it,
/// where it is — and the heat line sits inside the block of the place it is
/// about, every place that would bake (as on the web, 3 October).
String shortlistMessage({
  required List<Place> places,
  required WhenId when,
  required String url,
  DateTime? now,
}) {
  final t = now ?? DateTime.now();
  final month = kuwaitMonth(t);
  final hour = kuwaitHour(t);
  final arrival = when == WhenId.now
      ? hour
      : when == WhenId.soon
      ? hour + 1
      : _dayStarts + 2;
  final daytimePlan =
      when == WhenId.now ||
      when == WhenId.soon ||
      when == WhenId.tomorrow ||
      when == WhenId.weekend;
  final list = places.take(kShortlistMax).toList();
  final blocks = <String>[];
  for (var i = 0; i < list.length; i++) {
    final p = list[i];
    final hot = daytimePlan && _bakesInTheSun(p, arrival, month);
    blocks.add([
      '${_ordinalAr[i]}. ${p.nameAr} — ${p.areaAr}',
      p.taglineAr,
      if (hot) kGenericLines[summerKey(p)]!,
      'الموقع: ${mapsUrl(p)}',
    ].join('\n'));
  }
  return [
    'وين نروح ${planPhrase(when, kuwaitDay(t), t)}؟ اختاروا:',
    '',
    blocks.join('\n\n'),
    '',
    'صوّتوا هني: $url',
  ].join('\n');
}

/// «أنا مع ٢: سوق المباركية 👍» — a vote, as one tap; with the place's own
/// link under it when the page has one.
String shortlistVoteMessage(
  Place place,
  int position,
  WhenId? when, [
  String? url,
  String? day,
]) {
  final n = position < _ordinalAr.length
      ? _ordinalAr[position]
      : '${position + 1}';
  final line =
      'أنا مع $n: ${place.nameAr} 👍${when != null ? ' — ${planPhrase(when, day)}' : ''}';
  return url != null ? '$line\n$url' : line;
}

/// The share sheet's title for a list.
String shortlistTitle() => 'وين نروح؟ — وين';

String hangoutTitle(Place place) => '${place.nameAr} — وين؟';
