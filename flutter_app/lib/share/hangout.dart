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

enum WhenId {
  now('now'),
  soon('soon'),
  tonight7('tonight-7'),
  tonight8('tonight-8'),
  tonight9('tonight-9'),
  tonight10('tonight-10'),
  tomorrow('tomorrow'),
  weekend('weekend');

  final String wire;
  const WhenId(this.wire);

  static WhenId? parse(String? raw) {
    for (final w in values) {
      if (w.wire == raw) return w;
    }
    return null;
  }
}

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
  WhenOption(WhenId.tonight7, '٧ مساءً', 'الليلة الساعة ٧', 19),
  WhenOption(WhenId.tonight8, '٨ مساءً', 'الليلة الساعة ٨', 20),
  WhenOption(WhenId.tonight9, '٩ مساءً', 'الليلة الساعة ٩', 21),
  WhenOption(WhenId.tonight10, '١٠ مساءً', 'الليلة الساعة ١٠', 22),
  WhenOption(WhenId.tomorrow, 'باچر', 'باچر'),
  WhenOption(WhenId.weekend, 'الويكند', 'الويكند'),
];

const _dayStarts = 9;
const _dayEnds = 19;
const _threeHours = Duration(hours: 3);

DateTime _kuwait(DateTime now) => now.toUtc().add(_threeHours);

/// Kuwait's wall-clock hour.
int kuwaitHour([DateTime? now]) => _kuwait(now ?? DateTime.now()).hour;

/// Kuwait's calendar month, 0-based (as `Date#getUTCMonth`).
int kuwaitMonth([DateTime? now]) => _kuwait(now ?? DateTime.now()).month - 1;

/// How long until the offered list changes — the next Kuwait hour boundary.
int msToNextKuwaitHour([DateTime? now]) {
  final k =
      (now ?? DateTime.now()).toUtc().millisecondsSinceEpoch + 3 * 3600000;
  return 3600000 - (((k % 3600000) + 3600000) % 3600000);
}

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
  if (hour >= 9 &&
      hour < 12 &&
      daytimeIsFine &&
      options.contains(WhenId.soon)) {
    return WhenId.soon;
  }
  if (options.contains(WhenId.tonight8)) return WhenId.tonight8;
  if (options.contains(WhenId.tonight10)) return WhenId.tonight10;
  return WhenId.tomorrow;
}

String phraseFor(WhenId id) => _all.firstWhere((o) => o.id == id).phraseAr;

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
    phraseFor(when),
    '',
    place.taglineAr,
    if (heat.isNotEmpty) heat,
    '',
    'الموقع: https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}',
    url,
  ].join('\n');
}

const inviteParam = 'when';

/// Built from the slug, never from an address bar, so it cannot compound.
String inviteUrl(Place place, WhenId when, String origin) =>
    '${origin.replaceAll(RegExp(r'/+$'), '')}/places/${place.slug}/?$inviteParam=${when.wire}';

/// The time in a link, or null. Validated against the known ids: an unknown
/// one is simply not an invitation.
WhenId? readInvite(String search) {
  // The FIRST `when`, as URLSearchParams#get gives — Uri.splitQueryString
  // keeps the last, which would let a pasted link with two of them disagree
  // with the web about which plan it carries.
  final q = search.startsWith('?') ? search.substring(1) : search;
  for (final pair in q.split('&')) {
    final eq = pair.indexOf('=');
    final key = Uri.decodeQueryComponent(eq < 0 ? pair : pair.substring(0, eq));
    if (key != inviteParam) continue;
    return WhenId.parse(
      eq < 0 ? '' : Uri.decodeQueryComponent(pair.substring(eq + 1)),
    );
  }
  return null;
}

/// Has the invited hour already gone? Only answerable for the four evening
/// slots; «الحين», «باچر» and «الويكند» are relative to a moment the link
/// does not carry, and claiming otherwise would be inventing a fact.
bool invitePassed(WhenId when, [DateTime? now]) {
  final o = _all.firstWhere((o) => o.id == when);
  if (o.afterHour == null) return false;
  return kuwaitHour(now ?? DateTime.now()) >= o.afterHour!;
}

String inviteAcceptMessage(Place place, WhenId when) =>
    'تمام، أنا معكم 👍 ${place.nameAr} — ${phraseFor(when)}';

String hangoutTitle(Place place) => '${place.nameAr} — وين؟';
