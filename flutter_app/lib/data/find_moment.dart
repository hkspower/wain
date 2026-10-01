/// What /find says depends on when it is read — the port of the web's
/// src/lib/find-moment.ts, replayed against its answers for all 288 moments
/// (test/fixtures/kit_parity.json, `findMoment`).
///
/// The page was one sentence at every hour, and in summer that sentence
/// offered the beach at noon. The examples follow the part of the day and the
/// season, in Kuwait's time, and the opening word follows the hour.
library;

import '../share/hangout.dart' show kuwaitHour, kuwaitMonth;
import 'voice_lines.dart' show isSummerMonth;

enum DayPart { morning, noon, evening, night }

/// 05–11 morning, 12–15 the heat of the day, 16–20 evening, 21–04 night.
DayPart dayPart(int hour) {
  if (hour >= 5 && hour < 12) return DayPart.morning;
  if (hour >= 12 && hour < 16) return DayPart.noon;
  if (hour >= 16 && hour < 21) return DayPart.evening;
  return DayPart.night;
}

const _opener = {
  DayPart.morning: 'صباح الخير!',
  DayPart.noon: 'هلا!',
  DayPart.evening: 'مساء الخير!',
  DayPart.night: 'هلا بالسهرانين!',
};

/// (rest of the year, summer). In summer nothing outdoors is offered by day.
const _examples = {
  DayPart.morning: ('فطور، قهوة، مشي على البحر', 'فطور، قهوة، مكان مكيّف'),
  DayPart.noon: ('غدا، قهوة، طلعة عيال', 'غدا، مول مكيّف، طلعة عيال'),
  DayPart.evening: ('قهوة، بحر، طلعة عيال', 'قهوة، بحر عقب المغرب، طلعة عيال'),
  DayPart.night: ('عشا، قهوة، سهرة', 'عشا، قهوة، سهرة'),
};

class FindMoment {
  final DayPart part;
  final bool summer;
  final String opener;
  final String examples;
  const FindMoment(this.part, this.summer, this.opener, this.examples);
}

FindMoment findMoment(int hour, int month) {
  final part = dayPart(hour);
  final summer = isSummerMonth(month);
  final ex = _examples[part]!;
  return FindMoment(part, summer, _opener[part]!, summer ? ex.$2 : ex.$1);
}

FindMoment findMomentNow([DateTime? now]) =>
    findMoment(kuwaitHour(now), kuwaitMonth(now));

/// «`opener` أنا `name`. قول لي وش تبي — `examples` — وأدلّك.»
String findGreeting(String name, FindMoment m) =>
    '${m.opener} أنا $name. قول لي وش تبي — ${m.examples} — وأدلّك.';
