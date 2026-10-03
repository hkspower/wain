/// «رسّلها للربع» — the panel that turns a place into a plan the group can
/// answer with «تمام». Mirrors `ShareHangout.tsx`: pick a time (the list moves
/// with the Kuwait hour and the season), tap, and the composed message goes to
/// whatever the person already uses.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../data/models.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/layout.dart';
import '../widgets/svg.dart';
import 'hangout.dart';
import 'share_service.dart';

/// Where invitations point. The web is the canonical home of a place page, so
/// a link forwarded from the app opens there for anyone without it.
const String kInviteOrigin = 'https://www.wainkw.com';

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
    for (final c in (widget.choices ?? const <Place>[]).take(kShortlistMax))
      c.slug,
  ];

  @override
  void initState() {
    super.initState();
    _arm();
    _when = defaultWhen(widget.place, _now);
    _seed();
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
    final result = _inList
        ? await shareHangout(
            text: shortlistMessage(
              places: listed,
              when: when,
              url: shortlistUrl(listed, when, kInviteOrigin),
              now: now,
            ),
            title: shortlistTitle(),
          )
        : await shareHangout(
            text: hangoutMessage(
              place: widget.place,
              when: when,
              url: inviteUrl(widget.place, when, kInviteOrigin),
              now: now,
            ),
            title: hangoutTitle(widget.place),
          );
    if (result == ShareOutcome.shared ||
        result == ShareOutcome.whatsapp ||
        result == ShareOutcome.copied) {
      HapticFeedback.lightImpact();
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
        boxShadow: WainShadows.sm,
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
          const SizedBox(height: 6),
          Text(
            'اختر الوقت وارسل المكان للجروب — بالموقع والرابط، وخلّص النقاش.',
            style: wainText(WainText.sm, color: WainColors.ink500, height: 1.6),
          ),
          if (_canList) ...[
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
                  border: Border.all(color: WainColors.line),
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
          if (choices != null && choices.length > 1) ...[
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
                    _outcome = null;
                  }),
                ),
            ],
          ),
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
          const SizedBox(height: 20),
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
                WainText.sm,
                weight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
          ),
          if (_outcome == ShareOutcome.copied)
            _Note(icon: true, text: 'انتسخت — الصقها بالجروب.'),
          if (_outcome == ShareOutcome.whatsapp)
            _Note(icon: true, text: 'فتحنا لك واتساب.'),
          if (_outcome == ShareOutcome.failed)
            _Note(
              icon: false,
              text: 'ما قدرنا نرسلها — انسخ الرابط من فوق وأرسله.',
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
