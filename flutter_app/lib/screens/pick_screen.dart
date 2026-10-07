/// The other end of «خلّهم يختارون» — the shortlist a friend sent
/// (`/pick?p=a,b,c&when=…`). Mirrors the web's `PickClient.tsx`.
///
/// The places, numbered as the message numbered them, on one map; and beside
/// each one the reply that ends the thread, «أنا مع ٢», as a tap. Nothing is
/// counted here — there is no server to count on, and the group is already
/// counting in its own chat, which is where the votes go.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../data/catalogue.dart';
import '../data/models.dart';
import '../data/text_kit.dart' show countAr, kVotesCount;
import '../orders/order_api.dart' show kBackendEnabled;
import '../map/wain_map.dart';
import '../share/add_to_calendar.dart';
import '../share/hangout.dart';
import '../share/hangout_panel.dart' show kInviteOrigin;
import '../share/share_service.dart';
import '../share/votes.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/layout.dart';
import '../widgets/place_card.dart';
import '../widgets/svg.dart';

const List<String> _numbers = ['١', '٢', '٣'];

class PickScreen extends StatefulWidget {
  /// The link's query string, as it arrived (`p=…&when=…`).
  final String query;

  /// Injected clock for tests.
  final DateTime Function() clock;

  /// The vote count's client (tests pass a fake); null = the live one
  /// whenever the build has a back end.
  final VoteClient? votes;

  const PickScreen({
    super.key,
    required this.query,
    this.clock = _now,
    this.votes,
  });

  static DateTime _now() => DateTime.now();

  @override
  State<PickScreen> createState() => _PickScreenState();
}

class _PickScreenState extends State<PickScreen> {
  late final ({List<String> slugs, WhenId? when, String? day, String? poll})
  _read = readShortlist(widget.query, (s) => getPlace(s) != null);
  late final List<Place> _list = [for (final s in _read.slugs) ?getPlace(s)];
  String? _active;
  ({String slug, ShareOutcome outcome})? _voted;
  bool _busy = false;

  // The group's count, when the link carries a poll (votes.dart): read on
  // arrival and every twenty seconds while this screen is up.
  VoteClient? _votes;
  Tally? _tally;
  String? _mine;
  Timer? _refresh;
  List<String> get _options => [for (final p in _list) p.slug];

  @override
  void initState() {
    super.initState();
    final poll = _read.poll;
    if (poll == null || _list.length < 2) return;
    _votes = widget.votes ?? (kBackendEnabled ? VoteClient() : null);
    if (_votes == null) return;
    _votes!.myVote(poll).then((m) {
      if (mounted && m != null) setState(() => _mine = m);
    });
    _load();
    _refresh = Timer.periodic(const Duration(seconds: 20), (_) => _load());
  }

  Future<void> _load() async {
    final t = await _votes?.read(_read.poll!, _options);
    if (mounted && t != null) setState(() => _tally = t);
  }

  @override
  void dispose() {
    _refresh?.cancel();
    super.dispose();
  }

  Future<void> _vote(int i) async {
    if (_busy) return;
    final place = _list[i];
    setState(() {
      _busy = true;
      _active = place.slug;
    });
    HapticFeedback.selectionClick();
    // Counted first and not waited on: the share sheet holds the screen.
    final poll = _read.poll;
    if (poll != null && _votes != null) {
      setState(() => _mine = place.slug);
      unawaited(
        _votes!.cast(poll, place.slug, _options).then((t) {
          if (mounted && t != null) setState(() => _tally = t);
        }),
      );
    }
    // The vote carries the place's own link, so the chat ends up holding the
    // winner's plan the way a single proposal would have.
    final when = _read.when;
    final url = when != null
        ? inviteUrl(place, when, kInviteOrigin, _read.day)
        : null;
    final outcome = await shareHangout(
      text: shortlistVoteMessage(place, i, when, url, _read.day),
      title: shortlistTitle(),
    );
    if (outcome == ShareOutcome.shared ||
        outcome == ShareOutcome.whatsapp ||
        outcome == ShareOutcome.copied) {
      HapticFeedback.lightImpact();
    }
    if (!mounted) return;
    setState(() {
      _voted = (slug: place.slug, outcome: outcome);
      _busy = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    // A link with fewer than two places that exist is not a shortlist — a
    // place renamed since, or a link cut short in a forward.
    if (_list.length < 2) return const _NotAShortlist();
    final when = _read.when;
    final now = widget.clock();
    final passed = when != null && invitePassed(when, now, _read.day);
    final phrase = when != null ? planPhrase(when, _read.day, now) : '';
    final category = getCategory(_list.first.category);
    final ask = category != null
        ? '${category.ar} ${_list.first.areaAr}'
        : _list.first.areaAr;
    return ListView(
      padding: EdgeInsets.zero,
      children: [
        PageColumn(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                passed ? 'الوقت اللي اختاروه عدّى' : 'ربعك يختارون',
                key: const ValueKey('pick-title'),
                style: wainText(
                  WainText.s2xl,
                  weight: FontWeight.w700,
                  color: WainColors.ink900,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '${when != null ? 'وين نروح $phrase؟' : 'وين نروح؟'} اختار واحد ورد عليهم.',
                style: wainText(WainText.base, color: WainColors.ink600),
              ),
              if (_tally != null && _tally!.total > 0) ...[
                const SizedBox(height: 8),
                Semantics(
                  liveRegion: true,
                  child: Text(
                    'صوّتوا: ${countAr(_tally!.total, kVotesCount)}'
                    '${_tally!.leader != null ? ' — الأكثر: ${_list.firstWhere((p) => p.slug == _tally!.leader, orElse: () => _list.first).nameAr}' : ' — متعادلين'}',
                    key: const ValueKey('pick-tally-summary'),
                    style: wainText(
                      WainText.sm,
                      weight: FontWeight.w600,
                      color: WainColors.ink700,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 20),
              for (var i = 0; i < _list.length; i++) ...[
                Padding(
                  padding: EdgeInsets.only(bottom: _tally == null ? 12 : 4),
                  child: _Choice(
                    key: ValueKey('pick-${_list[i].slug}'),
                    number: _numbers[i],
                    place: _list[i],
                    active: _active == _list[i].slug,
                    mine:
                        _voted?.slug == _list[i].slug || _mine == _list[i].slug,
                    enabled: !_busy && !passed,
                    onVote: () => _vote(i),
                    onPoint: () => setState(() => _active = _list[i].slug),
                  ),
                ),
                if (_tally != null)
                  _TallyRow(
                    key: ValueKey('pick-tally-${_list[i].slug}'),
                    count: _tally!.tally[_list[i].slug] ?? 0,
                    total: _tally!.total,
                    lead: _tally!.leader == _list[i].slug,
                  ),
              ],
              if (_voted?.outcome == ShareOutcome.copied)
                _Note('نسخنا ردّك — الصقه بالجروب.'),
              if (_voted?.outcome == ShareOutcome.failed)
                _Note('ما قدرنا نرسل الرد — رد عليهم بالجروب.'),
              // Having voted, the voter has a plan of their own to keep.
              if (_voted != null &&
                  _voted!.outcome != ShareOutcome.failed &&
                  when != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: AddToCalendar(
                    place: _list.firstWhere((p) => p.slug == _voted!.slug),
                    when: when,
                    day: _read.day,
                    phrase: phrase,
                    url: inviteUrl(
                      _list.firstWhere((p) => p.slug == _voted!.slug),
                      when,
                      kInviteOrigin,
                      _read.day,
                    ),
                    mapsUrl: mapsUrl(
                      _list.firstWhere((p) => p.slug == _voted!.slug),
                    ),
                    clock: widget.clock,
                  ),
                ),
              const SizedBox(height: 12),
              // 1.25:1 like the place page: the site's /pick map was a 230px
              // strip on a phone until 7 October, and this one a fixed 260.
              LayoutBuilder(
                builder: (context, box) => WainMap(
                  key: const ValueKey('pick-map'),
                  places: _list,
                  activeSlug: _active,
                  onActive: (s) => setState(() => _active = s),
                  onOpen: (p) => context.push('/places/${p.slug}'),
                  height: (box.maxWidth / 1.25).clamp(240.0, 420.0).toDouble(),
                ),
              ),
              const SizedBox(height: 8),
              // None of the three? سالم is a tap away, already asked about
              // something like the first one.
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                spacing: 12,
                runSpacing: 8,
                children: [
                  Text(
                    'ولا واحد عاجبك؟',
                    style: wainText(WainText.sm, color: WainColors.ink600),
                  ),
                  OutlinedButton(
                    key: const ValueKey('pick-ask-salem'),
                    onPressed: () => context.push(
                      '/salem?q=${Uri.encodeQueryComponent(ask)}',
                    ),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 48),
                      shape: const StadiumBorder(),
                      side: const BorderSide(color: WainColors.lineControl),
                    ),
                    child: Text(
                      'اسأل سالم عن غيرها',
                      style: wainText(
                        WainText.sm,
                        weight: FontWeight.w600,
                        color: WainColors.ink700,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ],
    );
  }
}

/// One place on the list: its number, its card and «أنا معه». The vote sits
/// beside the card where the card keeps the width it was drawn for, and under
/// it on a narrow phone, where beside it the card would be squeezed below
/// that width (the web's row only ever meets a wider screen).
class _Choice extends StatelessWidget {
  final String number;
  final Place place;
  final bool active;
  final bool mine;
  final bool enabled;
  final VoidCallback onVote;
  final VoidCallback onPoint;
  const _Choice({
    super.key,
    required this.number,
    required this.place,
    required this.active,
    required this.mine,
    required this.enabled,
    required this.onVote,
    required this.onPoint,
  });

  @override
  Widget build(BuildContext context) {
    final vote = Semantics(
      button: true,
      enabled: enabled,
      label: 'أنا مع $number: ${place.nameAr}',
      excludeSemantics: true,
      child: FilledButton.icon(
        key: ValueKey('pick-vote-${place.slug}'),
        onPressed: enabled ? onVote : null,
        style: FilledButton.styleFrom(
          backgroundColor: mine ? WainColors.palm700 : WainColors.coral700,
          foregroundColor: Colors.white,
          minimumSize: const Size(0, 48),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(WainRadius.xl),
          ),
        ),
        icon: WainSvg.icon(
          mine ? 'check' : 'send',
          size: 16,
          color: Colors.white,
        ),
        label: Text(
          mine ? 'رديت' : 'أنا معه',
          style: wainText(
            WainText.sm,
            weight: FontWeight.w600,
            color: Colors.white,
          ),
        ),
      ),
    );
    final card = SizedBox(
      height: placeCardExtent(context),
      child: PlaceCard(place: place),
    );
    return Listener(
      onPointerDown: (_) => onPoint(),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(WainRadius.s3xl),
          border: Border.all(
            color: active ? WainColors.sea300 : WainColors.line,
          ),
          boxShadow: WainShadows.xs,
        ),
        child: LayoutBuilder(
          builder: (context, c) {
            final badge = Container(
              width: 36,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: WainColors.sand100,
                borderRadius: BorderRadius.circular(WainRadius.s2xl),
              ),
              child: ExcludeSemantics(
                child: Text(
                  number,
                  style: wainText(
                    WainText.lg,
                    weight: FontWeight.w700,
                    color: WainColors.ink800,
                  ),
                ),
              ),
            );
            // 36 for the number, two gaps, and the vote's ~110.
            final beside = c.maxWidth - 36 - 12 - 12 - 110 >= 160;
            final extent = placeCardExtent(context);
            return SizedBox(
              height: beside ? extent : extent + 8 + 48,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  badge,
                  const SizedBox(width: 12),
                  Expanded(
                    child: beside
                        ? card
                        : Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [card, const SizedBox(height: 8), vote],
                          ),
                  ),
                  if (beside) ...[
                    const SizedBox(width: 12),
                    Center(child: vote),
                  ],
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

/// One place's count and its share of the votes, under its row.
class _TallyRow extends StatelessWidget {
  final int count;
  final int total;
  final bool lead;
  const _TallyRow({
    super.key,
    required this.count,
    required this.total,
    required this.lead,
  });

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 12, right: 48, left: 8),
    child: Row(
      children: [
        Text(
          countAr(count, kVotesCount),
          style: wainText(
            WainText.xs,
            weight: FontWeight.w600,
            color: WainColors.ink600,
          ),
        ),
        const SizedBox(width: 8),
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: total == 0 ? 0 : count / total,
              minHeight: 6,
              backgroundColor: WainColors.sand200,
              color: lead ? WainColors.palm600 : WainColors.sand500,
            ),
          ),
        ),
      ],
    ),
  );
}

class _Note extends StatelessWidget {
  final String text;
  const _Note(this.text);

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Semantics(
      liveRegion: true,
      child: Text(text, style: wainText(WainText.sm, color: WainColors.ink600)),
    ),
  );
}

class _NotAShortlist extends StatelessWidget {
  const _NotAShortlist();

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: EdgeInsets.zero,
      children: [
        PageColumn(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'ما لقينا الأماكن اللي بالرابط',
                key: const ValueKey('pick-invalid'),
                style: wainText(
                  WainText.s2xl,
                  weight: FontWeight.w700,
                  color: WainColors.ink900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'يمكن الرابط انقص وهو ينرسل. تقدر تدوّر بنفسك أو تسأل سالم.',
                style: wainText(WainText.base, color: WainColors.ink600),
              ),
              const SizedBox(height: 20),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  FilledButton(
                    key: const ValueKey('pick-search'),
                    // The search TAB, switched to, as a link to /search is.
                    onPressed: () => context.go('/search'),
                    style: FilledButton.styleFrom(
                      backgroundColor: WainColors.sea600,
                      minimumSize: const Size(0, 48),
                    ),
                    child: const Text('دوّر'),
                  ),
                  OutlinedButton(
                    key: const ValueKey('pick-salem'),
                    onPressed: () => context.push('/salem'),
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size(0, 48),
                      side: const BorderSide(color: WainColors.lineControl),
                    ),
                    child: const Text('اسأل سالم'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}
