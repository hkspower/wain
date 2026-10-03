/// Port of `src/lib/hangout-calendar.ts` — «أضفها للتقويم», the plan as a
/// calendar entry, composed on the device: RFC 5545 text (CRLF, lines of 75
/// OCTETS, folds that never split a letter) and Google Calendar's «add this»
/// link. The parity fixtures replay it byte for byte against the web.
library;

import 'dart:convert';

import '../data/models.dart';
import 'plan_date.dart';

const int _durationMin = 120;

class CalendarEntry {
  final String ics;
  final String google;
  final String filename;
  const CalendarEntry(this.ics, this.google, this.filename);
}

/// `\ , ;` and newlines as RFC 5545 wants them in TEXT values. The Arabic
/// comma «،» is not a comma to a calendar and is left alone.
String icsEscape(String text) => text
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(RegExp(r'\r?\n'), '\\n');

/// Lines may be 75 OCTETS long — an Arabic letter is two — and a fold must
/// not split a code point. Continuations begin with one space, which counts
/// against their 75.
String foldLine(String line) {
  final out = <String>[];
  var cur = StringBuffer();
  var bytes = 0;
  var limit = 75;
  for (final rune in line.runes) {
    final ch = String.fromCharCode(rune);
    final n = utf8.encode(ch).length;
    if (bytes + n > limit) {
      out.add(cur.toString());
      cur = StringBuffer(' ');
      bytes = 1;
      limit = 75;
    }
    cur.write(ch);
    bytes += n;
  }
  out.add(cur.toString());
  return out.join('\r\n');
}

String _two(int n) => n.toString().padLeft(2, '0');

String _stamp(DateTime t) {
  final u = t.toUtc();
  return '${u.year.toString().padLeft(4, '0')}${_two(u.month)}${_two(u.day)}T${_two(u.hour)}${_two(u.minute)}${_two(u.second)}Z';
}

/// A Kuwait wall-clock moment as the UTC stamp a calendar wants (`…Z`).
String kuwaitToUtcStamp(String day, int hour, int minute) {
  final p = day.split('-').map(int.parse).toList();
  final t = DateTime.utc(p[0], p[1], p[2], hour - 3, minute);
  return '${t.year.toString().padLeft(4, '0')}${_two(t.month)}${_two(t.day)}T${_two(t.hour)}${_two(t.minute)}00Z';
}

/// Deterministic, so the same plan is the same entry wherever it is added.
String icsUid(String slug, WhenId when, String day) =>
    '$day-${when.wire}-$slug@wainkw.com';

String icsFilename(String slug, String day) => 'wain-$slug-$day.ics';

/// `URLSearchParams` encoding, exactly: percent-encoding with `*-._`
/// unreserved and the space as `+`. Dart's own query encoder keeps `!~'()`
/// bare, which the web does not, and the fixtures compare byte for byte.
String _form(String s) => Uri.encodeComponent(s)
    .replaceAll('!', '%21')
    .replaceAll('~', '%7E')
    .replaceAll("'", '%27')
    .replaceAll('(', '%28')
    .replaceAll(')', '%29')
    .replaceAll('%20', '+');

/// The entry for one place at one plan. [phrase] is what the message said
/// and is printed as said; the hour a calendar needs is added beside it with
/// the label its kind requires.
CalendarEntry calendarEntry({
  required Place place,
  required WhenId when,
  required String day,
  required String phrase,
  required String url,
  required String mapsUrl,
  DateTime? now,
}) {
  final t = now ?? DateTime.now();
  final plan = resolvePlan(when, day, t);
  final hour = plan.hour ?? kEveningDefaultHour;
  final start = kuwaitToUtcStamp(plan.date, hour, plan.minute);
  final end = kuwaitToUtcStamp(plan.date, hour, plan.minute + _durationMin);

  final summary = 'طلعة — ${place.nameAr}';
  final location = '${place.nameAr}، ${place.areaAr}';
  final note = switch (plan.hourKind) {
    HourKind.approx => 'الوقت تقريبي — عقب المغرب.',
    HourKind.defaultHour => 'الساعة ٨ افتراضية — الرسالة قالت اليوم بس.',
    _ => '',
  };
  final description = [
    phrase,
    if (note.isNotEmpty) note,
    'الموقع: $mapsUrl',
    url,
  ].join('\n');

  final lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//wain//hangout//AR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:${icsUid(place.slug, when, day)}',
    'DTSTAMP:${_stamp(t)}',
    'DTSTART:$start',
    'DTEND:$end',
    'SUMMARY:${icsEscape(summary)}',
    'LOCATION:${icsEscape(location)}',
    'DESCRIPTION:${icsEscape(description)}',
    'GEO:${place.lat};${place.lng}',
    'URL:$url',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  final ics = '${lines.map(foldLine).join('\r\n')}\r\n';
  final q = [
    'action=TEMPLATE',
    'text=${_form(summary)}',
    'dates=${_form('$start/$end')}',
    'details=${_form(description)}',
    'location=${_form(location)}',
    'ctz=${_form('Asia/Kuwait')}',
  ].join('&');
  return CalendarEntry(
    ics,
    'https://calendar.google.com/calendar/render?$q',
    icsFilename(place.slug, day),
  );
}
