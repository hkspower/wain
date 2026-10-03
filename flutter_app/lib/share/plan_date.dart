/// Port of `src/lib/plan-date.ts` — and Kuwait's clock, which the planner
/// used to carry itself.
///
/// A hangout link carries the Kuwait calendar day it was sent (`d=2026-10-03`),
/// and this turns id + day into a plan with a date: the weekday to print
/// beside «باچر», whether it has gone by, and the hour a calendar entry
/// should carry. Everything is computed on the UTC+3 clock, never the
/// device's own timezone. A link WITHOUT a day behaves exactly as before.
library;

enum WhenId {
  now('now'),
  soon('soon'),
  sunset('sunset'),
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

const String dayParam = 'd';

const Duration _threeHours = Duration(hours: 3);

/// The instant shifted onto Kuwait's clock; read its UTC parts.
DateTime kuwaitClock(DateTime now) => now.toUtc().add(_threeHours);

/// Kuwait's wall-clock hour.
int kuwaitHour([DateTime? now]) => kuwaitClock(now ?? DateTime.now()).hour;

/// Kuwait's calendar month, 0-based (as `Date#getUTCMonth`).
int kuwaitMonth([DateTime? now]) => kuwaitClock(now ?? DateTime.now()).month - 1;

/// Kuwait's calendar day as `YYYY-MM-DD`.
String kuwaitDay([DateTime? now]) {
  final k = kuwaitClock(now ?? DateTime.now());
  return '${k.year.toString().padLeft(4, '0')}-${_two(k.month)}-${_two(k.day)}';
}

/// How long until the offered list changes — the next Kuwait hour boundary.
int msToNextKuwaitHour([DateTime? now]) {
  final k =
      (now ?? DateTime.now()).toUtc().millisecondsSinceEpoch + 3 * 3600000;
  return 3600000 - (((k % 3600000) + 3600000) % 3600000);
}

String _two(int n) => n.toString().padLeft(2, '0');

final RegExp _dayShape = RegExp(r'^\d{4}-\d{2}-\d{2}$');

/// A day out of a link, or null. The shape alone would accept 2026-02-30,
/// so the parts are round-tripped through a UTC date and must come back
/// unchanged.
String? parseDay(String? raw) {
  if (raw == null || !_dayShape.hasMatch(raw)) return null;
  final parts = raw.split('-').map(int.parse).toList();
  final t = DateTime.utc(parts[0], parts[1], parts[2]);
  return t.year == parts[0] && t.month == parts[1] && t.day == parts[2]
      ? raw
      : null;
}

DateTime _utcOf(String day) {
  final p = day.split('-').map(int.parse).toList();
  return DateTime.utc(p[0], p[1], p[2]);
}

String _dayOf(DateTime t) =>
    '${t.year.toString().padLeft(4, '0')}-${_two(t.month)}-${_two(t.day)}';

/// Date arithmetic through a UTC date, so month, year and leap rollover are free.
String addDays(String day, int n) => _dayOf(_utcOf(day).add(Duration(days: n)));

/// 0 = Sunday … 6 = Saturday (Dart's weekday is 1 = Monday … 7 = Sunday).
int weekday(String day) => _utcOf(day).weekday % 7;

const List<String> kWeekdayAr = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
];

/// Kuwait City's sunset, mid-month, as (hour, minute) on the UTC+3 clock —
/// APPROXIMATE, and never presented as the minute the sun goes down. It
/// exists so a calendar entry for «عقب المغرب» lands in the right hour; the
/// entry says «تقريباً» wherever it shows.
const List<(int, int)> kSunsetKw = [
  (17, 15), (17, 35), (17, 55), (18, 15), (18, 35), (18, 55),
  (18, 55), (18, 35), (18, 0), (17, 25), (17, 5), (16, 55),
];

/// The hour a calendar gives «باچر» and «الويكند», which name no hour.
const int kEveningDefaultHour = 20;

/// Where an hour came from: `fixed` the sender chose it; `approx` sunset,
/// from the table — say «تقريباً»; `default` «باچر» named none, 20:00 is the
/// calendar's guess and stays inside the entry; `none` «الحين».
enum HourKind { fixed, approx, defaultHour, none }

class ResolvedPlan {
  final String date;
  final int? hour;
  final int minute;
  final HourKind hourKind;
  final int weekday;
  final String weekdayAr;
  final bool passed;
  const ResolvedPlan({
    required this.date,
    required this.hour,
    required this.minute,
    required this.hourKind,
    required this.weekday,
    required this.weekdayAr,
    required this.passed,
  });
}

const Map<WhenId, int> _tonight = {
  WhenId.tonight7: 19,
  WhenId.tonight8: 20,
  WhenId.tonight9: 21,
  WhenId.tonight10: 22,
};

/// The plan a link means, given the day it was sent. «الويكند» said on a
/// Friday means this weekend (Saturday); any other day the coming Friday. A
/// day plan has passed once Kuwait's date is past it (the weekend: past its
/// Saturday); a timed plan once the hour is, on its day; sunset is judged by
/// the planner's DAY_ENDS, seven o'clock.
ResolvedPlan resolvePlan(WhenId when, String day, [DateTime? now]) {
  final t = now ?? DateTime.now();
  final today = kuwaitDay(t);
  final hour = kuwaitHour(t);
  ResolvedPlan at(String date, int? h, int minute, HourKind kind, bool passed) {
    final wd = weekday(date);
    return ResolvedPlan(
      date: date,
      hour: h,
      minute: minute,
      hourKind: kind,
      weekday: wd,
      weekdayAr: kWeekdayAr[wd],
      passed: passed,
    );
  }

  switch (when) {
    case WhenId.tomorrow:
      final date = addDays(day, 1);
      return at(date, kEveningDefaultHour, 0, HourKind.defaultHour,
          today.compareTo(date) > 0);
    case WhenId.weekend:
      final wd = weekday(day);
      final date = addDays(day, wd == 5 ? 1 : (5 - wd + 7) % 7);
      final saturday = wd == 5 ? date : addDays(date, 1);
      return at(date, kEveningDefaultHour, 0, HourKind.defaultHour,
          today.compareTo(saturday) > 0);
    case WhenId.sunset:
      final (h, m) = kSunsetKw[int.parse(day.substring(5, 7)) - 1];
      return at(day, h, m, HourKind.approx,
          today.compareTo(day) > 0 || (today == day && hour >= 19));
    case WhenId.tonight7:
    case WhenId.tonight8:
    case WhenId.tonight9:
    case WhenId.tonight10:
      final h = _tonight[when]!;
      return at(day, h, 0, HourKind.fixed,
          today.compareTo(day) > 0 || (today == day && hour >= h));
    case WhenId.now:
    case WhenId.soon:
      return at(day, null, 0, HourKind.none, today.compareTo(day) > 0);
  }
}

/// Whether a plan can be put on a calendar at all: «الحين» and «بعد ساعة»
/// carry no hour, and a link with no day has no date to give.
bool hasCalendarEntry(WhenId when, String? day) =>
    day != null && when != WhenId.now && when != WhenId.soon;
