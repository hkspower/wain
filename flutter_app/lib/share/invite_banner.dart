/// «ربعك عازمينك هني» — what someone sees when they open a forwarded link:
/// the plan the link carried, whether its hour has already gone, and the
/// reply as one tap. Mirrors `InviteBanner.tsx`, copy and all.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/catalogue.dart';
import '../data/models.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/svg.dart';
import 'add_to_calendar.dart';
import 'hangout.dart';
import 'hangout_panel.dart' show kInviteOrigin;
import 'share_service.dart';

class InviteBanner extends StatefulWidget {
  final Place place;
  final WhenId when;

  /// The day the link was sent (`d=`), when it carries one — then «باچر» has
  /// a weekday and a plan from last week reads as gone.
  final String? day;
  final DateTime Function() clock;

  /// «شوفه على الخريطة» — the place page's own map, brought into view (the
  /// web's `#map` anchor).
  final VoidCallback? onShowMap;

  /// «اقترح وقت ثاني» on a passed invitation — the share panel further down
  /// the page (the web's `#share`).
  final VoidCallback? onPropose;

  const InviteBanner({
    super.key,
    required this.place,
    required this.when,
    this.day,
    this.clock = _now,
    this.onShowMap,
    this.onPropose,
  });

  static DateTime _now() => DateTime.now();

  @override
  State<InviteBanner> createState() => _InviteBannerState();
}

class _InviteBannerState extends State<InviteBanner> {
  ShareOutcome? _outcome;
  bool _busy = false;

  Future<void> _accept() async {
    if (_busy) return;
    setState(() => _busy = true);
    HapticFeedback.selectionClick();
    final result = await shareHangout(
      text: inviteAcceptMessage(widget.place, widget.when),
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
    final place = widget.place;
    final now = widget.clock();
    final passed = invitePassed(widget.when, now, widget.day);
    final phrase = planPhrase(widget.when, widget.day, now);
    return Semantics(
      label: 'دعوة',
      container: true,
      child: Container(
        key: const ValueKey('invite-banner'),
        margin: const EdgeInsets.only(top: 24),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: passed ? WainColors.sand100 : WainColors.coral50,
          borderRadius: BorderRadius.circular(WainRadius.s3xl),
          border: Border.all(
            color: passed ? WainColors.line : WainColors.coral200,
          ),
          boxShadow: WainShadows.xs,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              passed ? 'الدعوة هذي راحت' : 'ربعك عازمينك هني',
              style: wainText(
                WainText.lg,
                weight: FontWeight.w600,
                color: WainColors.ink900,
              ),
            ),
            const SizedBox(height: 4),
            Text.rich(
              TextSpan(
                style: wainText(WainText.base, color: WainColors.ink700),
                children: [
                  TextSpan(
                    text: place.nameAr,
                    style: wainText(
                      WainText.base,
                      weight: FontWeight.w700,
                      color: WainColors.ink900,
                    ),
                  ),
                  TextSpan(text: ' — ${place.areaAr}، $phrase'),
                ],
              ),
            ),
            const SizedBox(height: 12),
            if (passed) ...[
              Text(
                'الوقت اللي بالدعوة عدّى. المكان نفسه بعده هني — شوفه واقترح وقت ثاني للربع.',
                style: wainText(
                  WainText.sm,
                  color: WainColors.ink600,
                  height: 1.7,
                ),
              ),
              // The text used to say it and offer no way (3 October).
              const SizedBox(height: 12),
              FilledButton.icon(
                key: const ValueKey('invite-propose'),
                onPressed: () {
                  HapticFeedback.selectionClick();
                  widget.onPropose?.call();
                },
                style: FilledButton.styleFrom(
                  backgroundColor: WainColors.coral700,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(0, 44),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(WainRadius.s2xl),
                  ),
                ),
                icon: WainSvg.icon('send', size: 16, color: Colors.white),
                label: Text(
                  'اقترح وقت ثاني',
                  style: wainText(
                    WainText.sm,
                    weight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
              ),
            ] else
              Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  FilledButton.icon(
                    key: const ValueKey('invite-accept'),
                    onPressed: _busy ? null : _accept,
                    style: FilledButton.styleFrom(
                      backgroundColor: WainColors.coral700,
                      foregroundColor: Colors.white,
                      minimumSize: const Size(0, 44),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(WainRadius.s2xl),
                      ),
                    ),
                    icon: WainSvg.icon(
                      _outcome != null ? 'check' : 'send',
                      size: 16,
                      color: Colors.white,
                    ),
                    label: Text(
                      _outcome != null ? 'رديت عليهم' : 'تمام، أنا معكم',
                      style: wainText(
                        WainText.sm,
                        weight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
                  ),
                  OutlinedButton(
                    key: const ValueKey('invite-directions'),
                    onPressed: () => launchUrl(
                      Uri.parse(mapsUrl(place)),
                      mode: LaunchMode.externalApplication,
                    ),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 44),
                      side: const BorderSide(color: WainColors.lineControl),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(WainRadius.s2xl),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          'الطريق',
                          style: wainText(
                            WainText.sm,
                            weight: FontWeight.w600,
                            color: WainColors.ink700,
                          ),
                        ),
                        const SizedBox(width: 6),
                        WainSvg.icon('go', size: 16, color: WainColors.ink700),
                      ],
                    ),
                  ),
                  AddToCalendar(
                    place: place,
                    when: widget.when,
                    day: widget.day,
                    phrase: phrase,
                    url: inviteUrl(
                      place,
                      widget.when,
                      kInviteOrigin,
                      widget.day,
                    ),
                    mapsUrl: mapsUrl(place),
                    clock: widget.clock,
                  ),
                ],
              ),
            // Where it is, and a way to answer «لا، خلنا نروح مكان ثاني» with a
            // place instead of a complaint — سالم, asked about the same kind
            // of place in the same area (3 October, as on the web).
            const SizedBox(height: 8),
            Wrap(
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 4,
              children: [
                _Link(
                  key: const ValueKey('invite-map'),
                  label: 'شوفه على الخريطة',
                  onTap: () => widget.onShowMap?.call(),
                ),
                Text(
                  '·',
                  style: wainText(WainText.sm, color: WainColors.ink600),
                ),
                Text(
                  'تبي مكان ثاني؟',
                  style: wainText(WainText.sm, color: WainColors.ink600),
                ),
                _Link(
                  key: const ValueKey('invite-salem'),
                  label: 'اسأل سالم',
                  onTap: () => context.push(
                    '/salem?q=${Uri.encodeQueryComponent(inviteSalemQuestion(place))}',
                  ),
                ),
              ],
            ),
            if (_outcome == ShareOutcome.copied)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'نسخنا ردّك — الصقه بالجروب.',
                  style: wainText(WainText.sm, color: WainColors.ink600),
                ),
              ),
            if (_outcome == ShareOutcome.failed)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'ما قدرنا نرسل الرد — رد عليهم بالجروب.',
                  style: wainText(WainText.sm, color: WainColors.ink600),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// What «اسأل سالم» asks: the same kind of place, in the same area.
String inviteSalemQuestion(Place place) => [
  getCategory(place.category)?.ar,
  place.areaAr,
].whereType<String>().where((s) => s.isNotEmpty).join(' ');

/// A text link — the web's underlined sea-coloured anchor, a finger's height.
class _Link extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const _Link({super.key, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      link: true,
      child: TextButton(
        onPressed: onTap,
        style: TextButton.styleFrom(
          minimumSize: const Size(0, 48),
          padding: const EdgeInsets.symmetric(horizontal: 4),
          foregroundColor: WainColors.sea700,
        ),
        child: Text(
          label,
          style: wainText(
            WainText.sm,
            weight: FontWeight.w600,
            color: WainColors.sea700,
          ),
        ),
      ),
    );
  }
}
