/// «أضفها للتقويم» — the plan onto the phone's calendar, from the page that
/// holds it: the invitation banner, /pick after a vote, the panel after a
/// send. Mirrors `AddToCalendar.tsx`: nothing for a plan that cannot go on a
/// calendar («الحين», or a link with no day), and two ways side by side —
/// the file, and Google's own «add this» page.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/models.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/svg.dart';
import 'hangout_calendar.dart';
import 'plan_date.dart';
import 'share_service.dart';

class AddToCalendar extends StatelessWidget {
  final Place place;
  final WhenId when;
  final String? day;
  final String phrase;
  final String url;
  final String mapsUrl;

  /// Injected clock for tests (the entry's stamp).
  final DateTime Function() clock;

  const AddToCalendar({
    super.key,
    required this.place,
    required this.when,
    required this.day,
    required this.phrase,
    required this.url,
    required this.mapsUrl,
    this.clock = _now,
  });

  static DateTime _now() => DateTime.now();

  CalendarEntry _entry() => calendarEntry(
    place: place,
    when: when,
    day: day!,
    phrase: phrase,
    url: url,
    mapsUrl: mapsUrl,
    now: clock(),
  );

  @override
  Widget build(BuildContext context) {
    if (!hasCalendarEntry(when, day)) return const SizedBox.shrink();
    return Wrap(
      spacing: 12,
      runSpacing: 4,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        OutlinedButton.icon(
          key: const ValueKey('add-to-calendar'),
          onPressed: () {
            HapticFeedback.selectionClick();
            shareCalendar(entry: _entry(), title: 'طلعة — ${place.nameAr}');
          },
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(0, 48),
            side: const BorderSide(color: WainColors.lineControl),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(WainRadius.s2xl),
            ),
          ),
          icon: WainSvg.icon('clock', size: 16, color: WainColors.ink700),
          label: Text(
            'أضفها للتقويم',
            style: wainText(
              WainText.sm,
              weight: FontWeight.w600,
              color: WainColors.ink700,
            ),
          ),
        ),
        Semantics(
          link: true,
          child: TextButton(
            key: const ValueKey('add-to-calendar-google'),
            onPressed: () => launchUrl(
              Uri.parse(_entry().google),
              mode: LaunchMode.externalApplication,
            ),
            style: TextButton.styleFrom(
              minimumSize: const Size(0, 48),
              padding: const EdgeInsets.symmetric(horizontal: 4),
            ),
            child: Text(
              'قوقل كالندر',
              style: wainText(
                WainText.xs,
                weight: FontWeight.w600,
                color: WainColors.sea700,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
