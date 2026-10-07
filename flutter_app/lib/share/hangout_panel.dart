/// «رسّلها للربع» — the panel that turns a place into a plan the group can
/// answer with «تمام». Mirrors `ShareHangout.tsx`: pick a time (the list moves
/// with the Kuwait hour and the season), tap, and the composed message goes to
/// whatever the person already uses.
library;

import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/models.dart';
import '../orders/order_api.dart' show kBackendEnabled;
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/layout.dart';
import '../widgets/svg.dart';
import 'add_to_calendar.dart';
import 'hangout.dart';
import 'share_service.dart';

/// Where invitations point. The web is the canonical home of a place page, so
/// a link forwarded from the app opens there for anyone without it.
const String kInviteOrigin = 'https://www.wainkw.com';

/// Tests that drive the chips open the panel from the start; the app always
/// starts closed — the plan in one line, «غيّر» for the chips (7 October).
bool debugHangoutStartOpen = false;

/// The time this device sent last, the next default when still offered.
const String kUsualWhenKey = 'wain:usual-when';

/// A fresh poll id for a shortlist link (the web's `newPollId`).
String newPollId([Random? rng]) {
  final r = rng ?? Random.secure();
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return String.fromCharCodes([
    for (var i = 0; i < 12; i++) abc.codeUnitAt(r.nextInt(abc.length)),
  ]);
}

class ShareHangout extends StatefulWidget {
  final Place place;

  /// On /search: the results to choose among, and the callback that keeps the
  /// map and this panel pointing at the same place.
  final List<Place>? choices;
  final ValueChanged<String>? onChoose;

  /// Injected clock for tests.
  final DateTime Function() clock;

  const ShareHangout({
    super.key,
    required this.place,
    this.choices,
    this.onChoose,
    this.clock = _now,
  });

  static DateTime _now() => DateTime.now();

  @override
  State<ShareHangout> createState() => _ShareHangoutState();
}

class _ShareHangoutState extends State<ShareHangout> {
  late DateTime _now = widget.clock();
  WhenId? _when;
  ShareOutcome? _outcome;
  bool _busy = false;
  Timer? _tick;

  /// What was last sent — the text, for the one outcome where nothing took
  /// it and the visitor needs to see it; the plan, for the calendar button.
  ({String text, WhenId when, String day, bool list})? _sent;

  /// «خلّهم يختارون» — send two or three of the choices and let the group
  /// pick (`shortlistMessage`). Offered only where there is a choice to hand
  /// on; a place page has one place and no toggle. As `ShareHangout.tsx`.
  bool get _canList => (widget.choices?.length ?? 0) >= 2;
  bool _listMode = false;
  List<String> _picked = const [];
  bool get _inList => _canList && _listMode;
  List<Place> get _listed => [
    for (final c in widget.choices ?? const <Place>[])
      if (_picked.contains(c.slug)) c,
  ];

  /// The first few, until the visitor says otherwise; re-seeded when the
  /// choices change, so it never lists places no longer shown.
  void _seed() => _picked = [
    for (final c in fitShortlist(widget.choices ?? const <Place>[], _now))
      c.slug,
  ];

  late bool _open = debugHangoutStartOpen;
  bool _touched = false;

  @override
  void initState() {
    super.initState();
    _arm();
    _when = defaultWhen(widget.place, _now);
    _seed();
    _loadUsual();
  }

  /// The habit, read once: applied only if nobody has chosen a time yet and
  /// it is on offer — the same list the chips are drawn from.
  Future<void> _loadUsual() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final wire = prefs.getString(kUsualWhenKey);
      if (!mounted || _touched || wire == null) return;
      final usual = WhenId.values.where((w) => w.wire == wire).firstOrNull;
      if (usual == null) return;
      if (whenOptions(_now, widget.place).any((o) => o.id == usual)) {
        setState(() => _when = usual);
      }
    } catch (_) {
      // No preferences on this device: the rules alone decide.
    }
  }

  Future<void> _rememberUsual(WhenId when) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(kUsualWhenKey, when.wire);
    } catch (_) {}
  }

  /// Wake exactly once, when the offered list actually moves: every expiry is
  /// on the hour in Kuwait, so nothing changes in between.
  void _arm() {
    _tick?.cancel();
    _tick = Timer(Duration(milliseconds: msToNextKuwaitHour(_now) + 1000), () {
      if (!mounted) return;
      setState(() {
        _now = widget.clock();
        _arm();
      });
    });
  }

  @override
  void didUpdateWidget(ShareHangout old) {
    super.didUpdateWidget(old);
    String key(List<Place>? l) =>
        [for (final c in l ?? const []) c.slug].join(',');
    if (key(old.choices) != key(widget.choices)) {
      _seed();
      _outcome = null;
    }
    if (old.place.slug != widget.place.slug) {
      _outcome = null;
      if (!whenOptions(_now, widget.place).any((o) => o.id == _when)) {
        _when = defaultWhen(widget.place, _now);
      }
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  Future<void> _send() async {
    final when = _when;
    if (when == null || _busy) return;
    final listed = _listed;
    if (_inList && listed.length < 2) return;
    setState(() {
      _busy = true;
      _outcome = null;
    });
    HapticFeedback.selectionClick();
    final now = widget.clock();
    // The link carries the day it was sent (plan_date.dart).
    final day = kuwaitDay(now);
    final text = _inList
        ? shortlistMessage(
            places: listed,
            when: when,
            url: shortlistUrl(
              listed,
              when,
              kInviteOrigin,
              day,
              kBackendEnabled ? newPollId() : null,
            ),
            now: now,
          )
        : hangoutMessage(
            place: widget.place,
            when: when,
            url: inviteUrl(widget.place, when, kInviteOrigin, day),
            now: now,
          );
    _sent = (text: text, when: when, day: day, list: _inList);
    final result = await shareHangout(
      text: text,
      title: _inList ? shortlistTitle() : hangoutTitle(widget.place),
    );
    if (result == ShareOutcome.shared ||
        result == ShareOutcome.whatsapp ||
        result == ShareOutcome.copied) {
      HapticFeedback.lightImpact();
      unawaited(_rememberUsual(when));
    }
    if (!mounted) return;
    setState(() {
      _outcome = result;
      _busy = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final listMode = _inList;
    final listed = _listed;
    final options = listMode
        ? whenOptionsFor(listed, _now)
        : whenOptions(_now, widget.place);
    // The offer moved under the chosen time: fall back rather than show a
    // chip that is no longer there.
    final selected = options.any((o) => o.id == _when)
        ? _when
        : listMode
        ? defaultWhenFor(listed, _now)
        : defaultWhen(widget.place, _now);
    final choices = widget.choices;
    final short = listMode && listed.length < 2;

    return Container(
      margin: const EdgeInsets.only(top: 20),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(WainRadius.s3xl),
        border: Border.all(color: WainColors.line),
        boxShadow: WainShadows.xs,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              WainSvg.icon('send', size: 20, color: WainColors.coral700),
              const SizedBox(width: 8),
              Text(
                'رسّلها للربع',
                style: wainText(
                  WainText.lg,
                  weight: FontWeight.w600,
                  color: WainColors.ink900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _PlanLine(
            what: listMode
                ? listed.map((c) => c.nameAr).join('، ')
                : widget.place.nameAr,
            when: selected == null
                ? '…'
                : planPhrase(selected, kuwaitDay(_now), _now),
            open: _open,
            onToggle: () {
              HapticFeedback.selectionClick();
              setState(() => _open = !_open);
            },
          ),
          if (_open && _canList) ...[
            const SizedBox(height: 16),
            Semantics(
              container: true,
              label: 'كم مكان ترسل؟',
              child: Container(
                key: const ValueKey('hangout-mode'),
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(
                  color: WainColors.sand100,
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    for (final (list, label) in const [
                      (false, 'مكان واحد'),
                      (true, 'خلّهم يختارون'),
                    ])
                      Flexible(
                        child: _Segment(
                          key: ValueKey(list ? 'mode-list' : 'mode-one'),
                          label: label,
                          active: _listMode == list,
                          onTap: () {
                            HapticFeedback.selectionClick();
                            setState(() {
                              _listMode = list;
                              _outcome = null;
                            });
                          },
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
          if (_open && choices != null && choices.length > 1) ...[
            const SizedBox(height: 16),
            Text(
              listMode ? 'أي أماكن؟ (لين ٣)' : 'أي مكان؟',
              style: wainText(
                WainText.xs,
                weight: FontWeight.w600,
                color: WainColors.ink600,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final c in choices)
                  _Chip(
                    key: ValueKey('place-${c.slug}'),
                    label: c.nameAr,
                    active: listMode
                        ? _picked.contains(c.slug)
                        : c.slug == widget.place.slug,
                    activeColor: WainColors.ink900,
                    // A fourth place is not offered: the list is full at three.
                    onTap:
                        listMode &&
                            !_picked.contains(c.slug) &&
                            _picked.length >= kShortlistMax
                        ? null
                        : () {
                            HapticFeedback.selectionClick();
                            if (!listMode) {
                              widget.onChoose?.call(c.slug);
                              return;
                            }
                            setState(() {
                              _outcome = null;
                              _picked = _picked.contains(c.slug)
                                  ? [
                                      for (final s in _picked)
                                        if (s != c.slug) s,
                                    ]
                                  : [..._picked, c.slug];
                            });
                          },
                  ),
              ],
            ),
          ],
          if (_open) ...[
            const SizedBox(height: 16),
            Text(
              'متى؟',
              style: wainText(
                WainText.xs,
                weight: FontWeight.w600,
                color: WainColors.ink600,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final o in options)
                  _Chip(
                    key: ValueKey('when-${o.id.wire}'),
                    label: o.labelAr,
                    active: o.id == selected,
                    activeColor: WainColors.coral700,
                    onTap: () => setState(() {
                      _when = o.id;
                      _touched = true;
                      _outcome = null;
                    }),
                  ),
              ],
            ),
          ],
          if (short)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Semantics(
                liveRegion: true,
                child: Text(
                  'اختر مكانين على الأقل.',
                  key: const ValueKey('hangout-too-few'),
                  style: wainText(WainText.sm, color: WainColors.ink600),
                ),
              ),
            ),
          const SizedBox(height: 16),
          Wrap(
            spacing: 16,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              FilledButton.icon(
                key: const ValueKey('hangout-send'),
                onPressed: _busy || short
                    ? null
                    : () {
                        _when = selected;
                        _send();
                      },
                style: FilledButton.styleFrom(
                  backgroundColor: WainColors.coral700,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(0, 44),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(WainRadius.xl),
                  ),
                ),
                icon: WainSvg.icon('send', size: 16, color: Colors.white),
                label: Text(
                  _busy
                      ? 'لحظة…'
                      : listMode
                      ? 'رسّل القائمة'
                      : 'رسّلها',
                  style: wainText(
                    WainText.base,
                    weight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
              ),
              // The other way to send, without opening the chips.
              if (_canList && !_open)
                TextButton(
                  key: const ValueKey('hangout-list-toggle'),
                  onPressed: () {
                    HapticFeedback.selectionClick();
                    setState(() {
                      _listMode = !_listMode;
                      _outcome = null;
                    });
                  },
                  style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
                  child: Text(
                    listMode ? 'مكان واحد بس' : 'خلّهم يختارون',
                    style: wainText(
                      WainText.sm,
                      weight: FontWeight.w600,
                      color: WainColors.ink600,
                    ).copyWith(decoration: TextDecoration.underline),
                  ),
                ),
            ],
          ),
          if (_outcome == ShareOutcome.copied)
            _Note(icon: true, text: 'انتسخت — الصقها بالجروب.'),
          if (_outcome == ShareOutcome.whatsapp)
            _Note(icon: true, text: 'فتحنا لك واتساب.'),
          // Nothing took it: the message is the thing they need, so here it
          // is, with its own copy (the old line pointed at an address bar
          // that on search and in the chat holds no invitation).
          if (_outcome == ShareOutcome.failed && _sent != null) ...[
            _Note(
              icon: false,
              text: 'ما قدرنا نرسلها — هذا النص، انسخه والصقه بالجروب.',
            ),
            const SizedBox(height: 8),
            Container(
              key: const ValueKey('hangout-failed-text'),
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: WainColors.sand100,
                borderRadius: BorderRadius.circular(WainRadius.xl),
                border: Border.all(color: WainColors.line),
              ),
              child: SelectableText(
                _sent!.text,
                style: wainText(
                  WainText.sm,
                  color: WainColors.ink800,
                  height: 1.6,
                ),
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              key: const ValueKey('hangout-copy'),
              onPressed: () async {
                await Clipboard.setData(ClipboardData(text: _sent!.text));
                HapticFeedback.lightImpact();
                if (mounted) setState(() => _outcome = ShareOutcome.copied);
              },
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 44),
                side: const BorderSide(color: WainColors.line),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(WainRadius.xl),
                ),
              ),
              child: Text(
                'انسخ',
                style: wainText(
                  WainText.sm,
                  weight: FontWeight.w600,
                  color: WainColors.ink700,
                ),
              ),
            ),
          ],
          // The sender's own copy of the plan, once it has gone out. Not for
          // a shortlist: nobody has chosen yet.
          if (_sent != null &&
              !_sent!.list &&
              (_outcome == ShareOutcome.shared ||
                  _outcome == ShareOutcome.whatsapp ||
                  _outcome == ShareOutcome.copied))
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: AddToCalendar(
                place: widget.place,
                when: _sent!.when,
                day: _sent!.day,
                phrase: planPhrase(_sent!.when, _sent!.day),
                url: inviteUrl(
                  widget.place,
                  _sent!.when,
                  kInviteOrigin,
                  _sent!.day,
                ),
                mapsUrl: mapsUrl(widget.place),
                clock: widget.clock,
              ),
            ),
        ],
      ),
    );
  }
}

/// The plan, ready: what and when in one line, and «غيّر» for the chips.
class _PlanLine extends StatelessWidget {
  final String what;
  final String when;
  final bool open;
  final VoidCallback onToggle;

  const _PlanLine({
    required this.what,
    required this.when,
    required this.open,
    required this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('hangout-plan-line'),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        // sand-100, not sand-50: sand-50 is #ffffff, the panel's own white,
        // so the line showed only by its border (the web had it too).
        color: WainColors.sand100,
        borderRadius: BorderRadius.circular(WainRadius.s2xl),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Semantics(
              liveRegion: true,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    what,
                    key: const ValueKey('plan-what'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: wainText(
                      WainText.base,
                      weight: FontWeight.w600,
                      color: WainColors.ink900,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    when,
                    key: const ValueKey('plan-when'),
                    style: wainText(WainText.sm, color: WainColors.ink600),
                  ),
                ],
              ),
            ),
          ),
          Semantics(
            button: true,
            expanded: open,
            child: TextButton(
              key: const ValueKey('hangout-change'),
              onPressed: onToggle,
              style: TextButton.styleFrom(minimumSize: const Size(48, 48)),
              child: Text(
                open ? 'تمام' : 'غيّر',
                style: wainText(
                  WainText.sm,
                  weight: FontWeight.w600,
                  color: WainColors.sea700,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final bool active;
  final Color activeColor;

  /// Null draws it disabled, faded (a full shortlist).
  final VoidCallback? onTap;
  const _Chip({
    super.key,
    required this.label,
    required this.active,
    required this.activeColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: active,
      enabled: onTap != null,
      child: Opacity(
        opacity: onTap == null ? 0.4 : 1,
        child: HitArea(
          onTap: onTap,
          child: Material(
            color: active ? activeColor : WainColors.sand100,
            shape: StadiumBorder(
              side: active
                  ? BorderSide.none
                  : const BorderSide(color: WainColors.line),
            ),
            child: InkWell(
              customBorder: const StadiumBorder(),
              onTap: onTap,
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 36, maxWidth: 260),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Center(
                    widthFactor: 1,
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: wainText(
                        WainText.sm,
                        weight: FontWeight.w600,
                        color: active ? Colors.white : WainColors.ink700,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// One half of the «مكان واحد / خلّهم يختارون» toggle — the web's segmented
/// pill: the chosen half white and raised, the other plain.
class _Segment extends StatelessWidget {
  final String label;
  final bool active;
  final VoidCallback onTap;
  const _Segment({
    super.key,
    required this.label,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: active,
      child: Material(
        color: active ? Colors.white : Colors.transparent,
        elevation: active ? 1 : 0,
        shape: const StadiumBorder(),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 44),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              child: Center(
                widthFactor: 1,
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: wainText(
                    WainText.sm,
                    weight: FontWeight.w600,
                    color: active ? WainColors.ink900 : WainColors.ink600,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _Note extends StatelessWidget {
  final bool icon;
  final String text;
  const _Note({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Semantics(
        liveRegion: true,
        child: Row(
          children: [
            if (icon) ...[
              WainSvg.icon('check', size: 16, color: WainColors.palm600),
              const SizedBox(width: 6),
            ],
            Expanded(
              child: Text(
                text,
                style: wainText(
                  WainText.sm,
                  weight: FontWeight.w600,
                  color: icon ? WainColors.palm600 : WainColors.ink600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
