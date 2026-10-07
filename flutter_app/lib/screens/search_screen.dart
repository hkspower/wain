import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../ai/call_controller.dart';
import '../ai/config.dart';
import '../app/app_state.dart';
import '../data/answer_order.dart';
import '../data/catalogue.dart';
import '../data/categories.g.dart';
import '../data/models.dart';
import '../data/places.g.dart';
import '../data/search.dart';
import '../data/text_kit.dart';
import '../data/voice_lines.dart';
import '../map/wain_map.dart';
import '../share/hangout.dart' show kChoiceMax;
import '../share/hangout_panel.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../voice/voice_service.dart';
import '../widgets/art.dart';
import '../widgets/layout.dart';
import '../widgets/place_card.dart';
import '../widgets/svg.dart';

const _kinds = [
  ('all', 'الكل'),
  ('place', 'أماكن'),
  ('category', 'تصنيفات'),
  ('area', 'مناطق'),
  ('page', 'صفحات'),
];
const _suggestions = [
  'قهوة هادية',
  'طلعة مع العيال',
  'بحر',
  'أكل كويتي',
  'متحف',
  'السالمية',
];

/// Search: one box, three ways in — type, call شوق, or look at the map.
/// The ranked engine is the web's own (ported, and proved by replaying its
/// answers); results, map and the hangout panel all point at the same place.
class SearchScreen extends StatefulWidget {
  final String initialQuery;
  const SearchScreen({super.key, this.initialQuery = ''});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.initialQuery,
  );
  String _kind = 'all';
  String? _activeSlug;

  /// The map is a bar under the count until it is asked for — the site's
  /// layout since 7 October. A search costs no tiles until then, and the first
  /// result row is not pushed a screen down by a map nobody opened.
  bool _mapOpen = false;
  Timer? _speakTimer;

  /// The share panel, for «رسّلها للربع» in her answer to bring into view.
  final _shareKey = GlobalKey();

  /// «رسّلها للربع» for the place she named: the page's own share panel, on
  /// it — the web's ShouqAnswer `onShare` (3 October).
  void _shareFromAnswer(String slug) {
    HapticFeedback.selectionClick();
    setState(() => _activeSlug = slug);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final ctx = _shareKey.currentContext;
      if (!mounted || ctx == null) return;
      Scrollable.ensureVisible(
        ctx,
        duration: MediaQuery.of(context).disableAnimations
            ? Duration.zero
            : const Duration(milliseconds: 300),
        curve: Curves.easeOut,
      );
    });
  }

  String _lastSpoken = '';

  String get _q => _controller.text;

  @override
  void didUpdateWidget(SearchScreen old) {
    super.didUpdateWidget(old);
    // A same-route push (?q=…) doesn't remount: adopt it.
    if (widget.initialQuery != old.initialQuery &&
        widget.initialQuery.isNotEmpty &&
        widget.initialQuery != _q) {
      _controller.text = widget.initialQuery;
      _activeSlug = null;
    }
  }

  @override
  void dispose() {
    _speakTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  List<SearchHit> _hits(String q, {String? kind, int limit = 40}) => search(
    q,
    searchIndex,
    limit: limit,
    kinds: (kind == null || kind == 'all') ? null : [kind],
  );

  /// The last answer, by query and kind. `build()` runs on every highlight of
  /// a pin or a row, not only on a new query, and each run searched the whole
  /// index twice (the list and the per-kind counts). Same question, same
  /// answer: it is asked once now.
  (String, String)? _memoKey;
  List<SearchHit> _memoHits = const [];
  List<SearchHit> _memoAll = const [];
  AnswerClock _memoClock = kuwaitClock();
  @visibleForTesting
  int searchRuns = 0;

  /// The hits in the order her answer gives them (`answerOrder` — the order
  /// the chat uses too), with Kuwait's month and hour read with them. A
  /// question with no topic comes back as the hour's default picks, and the
  /// per-kind counts are of those, not of the search's matches for «وين».
  (List<SearchHit>, List<SearchHit>) _results(String q) {
    final key = (q, _kind);
    if (key != _memoKey) {
      searchRuns++;
      _memoKey = key;
      _memoClock = kuwaitClock();
      if (q.isEmpty) {
        _memoHits = const [];
        _memoAll = const [];
      } else {
        final ordered = answerOrder(
          q,
          _hits(q, kind: _kind),
          searchIndex,
          kPlaces,
          _memoClock,
        );
        _memoHits = ordered.fallback && _kind != 'all' && _kind != 'place'
            ? const []
            : ordered.hits;
        _memoAll = ordered.fallback
            ? answerOrder(q, const [], searchIndex, kPlaces, _memoClock).hits
            : _hits(q, limit: 200);
      }
    }
    return (_memoHits, _memoAll);
  }

  List<Place> _placesOf(List<SearchHit> hits) {
    final bySlug = {for (final p in kPlaces) p.slug: p};
    final out = <Place>[];
    for (final h in hits) {
      if (h.doc.kind != 'place') continue;
      final p = bySlug[h.doc.id.substring(6)];
      if (p != null) out.add(p);
    }
    return out;
  }

  /// Speak the answer once the query settles, but only if it changed what
  /// would be said, and never while the voice is off.
  void _maybeSpeak(List<SearchHit> hits, List<Place> hitPlaces) {
    final state = context.read<AppState>();
    if (!state.voiceEnabled) return;
    _speakTimer?.cancel();
    final q = _q.trim();
    if (q.isEmpty) {
      _lastSpoken = '';
      return;
    }
    _speakTimer = Timer(const Duration(milliseconds: 900), () {
      if (!mounted) return;
      final sig = '${hits.isEmpty ? 'none' : hits.first.doc.id}|${hits.length}';
      if (sig == _lastSpoken) return;
      _lastSpoken = sig;
      context.read<VoiceService>().speak(_answer(q, hits, hitPlaces));
    });
  }

  List<SpeechPart> _answer(
    String q,
    List<SearchHit> hits,
    List<Place> hitPlaces,
  ) => answerParts(
    hits.map((h) => h.doc.title).toList(),
    hitPlaces,
    asked: null,
    // Kuwait's, read with the hits — it was the device's month, and no hour.
    month: _memoClock.month,
    hour: _memoClock.hour,
  );

  @override
  Widget build(BuildContext context) {
    final q = _q.trim();
    final (hits, all) = _results(q);
    final counts = {
      'all': all.length,
      for (final k in ['place', 'category', 'area', 'page'])
        k: all.where((h) => h.doc.kind == k).length,
    };
    final hitPlaces = _placesOf(hits);
    // The active place must still be in the results, or the panel would point
    // at something the list no longer shows.
    final active = hitPlaces.any((p) => p.slug == _activeSlug)
        ? _activeSlug
        : (hitPlaces.isEmpty ? null : hitPlaces.first.slug);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _maybeSpeak(hits, hitPlaces);
    });

    return ListView(
      padding: EdgeInsets.zero,
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      children: [
        PageColumn(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      'دوّر في وين',
                      style: wainText(
                        WainText.s4xl,
                        weight: FontWeight.w700,
                        color: WainColors.ink900,
                      ),
                    ),
                  ),
                  const _VoiceControls(),
                ],
              ),
              // No «١. دوّر بالكتابة · ٢. كلّمي شوق · ٣. عالخريطة» line: only the
              // middle item was a link, so it read like a stepper; the call link
              // moved to the empty state (3 October).
              const SizedBox(height: 10),
              _QueryBox(
                controller: _controller,
                onChanged: () => setState(() {}),
                onClear: () => setState(() => _controller.clear()),
              ),
              // Only the kinds this query found: a greyed chip that cannot be
              // tapped was an answer drawn as a control (3 October).
              if (q.isNotEmpty && counts['all']! > 0) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final (id, label) in _kinds)
                      if (counts[id]! > 0)
                        WainChip(
                          key: ValueKey('kind-$id'),
                          label: '$label ${toArabicDigits(counts[id]!)}',
                          active: _kind == id,
                          onTap: () => setState(() => _kind = id),
                        ),
                  ],
                ),
              ],
              const SizedBox(height: 20),
              if (q.isEmpty) ...[
                _Suggestions(
                  onPick: (s) => setState(() => _controller.text = s),
                ),
                const SizedBox(height: 20),
                const _EmptyWaysOn(),
              ] else if (hits.isNotEmpty) ...[
                if (hitPlaces.isNotEmpty)
                  _AnswerLine(
                    text: placeTryLine(hitPlaces.first),
                    query: q,
                    onShare: () => _shareFromAnswer(hitPlaces.first.slug),
                  ),
                Text(
                  countAr(hits.length, kResultsCount),
                  style: wainText(WainText.sm, color: WainColors.ink500),
                ),
                const SizedBox(height: 12),
                if (hitPlaces.isNotEmpty && !_mapOpen)
                  _MapBar(
                    count: hitPlaces.length,
                    onOpen: () => setState(() => _mapOpen = true),
                  ),
                if (hitPlaces.isNotEmpty && _mapOpen) ...[
                  _MapHeader(
                    count: hitPlaces.length,
                    onHide: () => setState(() => _mapOpen = false),
                  ),
                  const SizedBox(height: 8),
                  LayoutBuilder(
                    // As tall as it is wide, up to half the screen: 260px was
                    // a letterbox for a country whose places run wide and
                    // shallow. The site's opened map is ~370 at 390 for the
                    // same reason.
                    builder: (context, box) {
                      final screen = MediaQuery.sizeOf(context).height;
                      final h = box.maxWidth
                          .clamp(0.0, screen * 0.5)
                          .clamp(300.0, 520.0)
                          .toDouble();
                      return WainMap(
                        key: const ValueKey('search-map'),
                        places: hitPlaces,
                        activeSlug: active,
                        onActive: (s) => setState(() => _activeSlug = s),
                        onOpen: (p) => context.push('/places/${p.slug}'),
                        height: h,
                      );
                    },
                  ),
                ],
                const SizedBox(height: 12),
                for (var i = 0; i < hits.length; i++)
                  _ResultRow(
                    hit: hits[i],
                    active: hits[i].doc.id == 'place:$active',
                    onHover: (slug) => setState(() => _activeSlug = slug),
                  ),
                if (hitPlaces.isNotEmpty && active != null)
                  KeyedSubtree(
                    key: _shareKey,
                    child: ShareHangout(
                      key: const ValueKey('search-hangout'),
                      place: hitPlaces.firstWhere((p) => p.slug == active),
                      choices: hitPlaces.take(kChoiceMax).toList(),
                      onChoose: (s) => setState(() => _activeSlug = s),
                    ),
                  ),
              ] else
                _DeadEnd(query: q),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ],
    );
  }
}

/// «٤ على الخريطة · اعرض الخريطة»: the map, folded. One tap opens it in place.
class _MapBar extends StatelessWidget {
  final int count;
  final VoidCallback onOpen;
  const _MapBar({required this.count, required this.onOpen});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(WainRadius.s2xl),
        side: const BorderSide(color: WainColors.lineControl),
      ),
      child: InkWell(
        key: const ValueKey('search-map-bar'),
        borderRadius: BorderRadius.circular(WainRadius.s2xl),
        onTap: () {
          HapticFeedback.selectionClick();
          onOpen();
        },
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            child: Row(
              children: [
                WainSvg.icon('map', size: 16, color: WainColors.sea600),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${toArabicDigits(count)} على الخريطة',
                    style: wainText(
                      WainText.sm,
                      weight: FontWeight.w600,
                      color: WainColors.ink800,
                    ),
                  ),
                ),
                Text(
                  'اعرض الخريطة',
                  style: wainText(
                    WainText.xs,
                    weight: FontWeight.w600,
                    color: WainColors.sea700,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The opened map's own line: the count, and the way back to the bar.
class _MapHeader extends StatelessWidget {
  final int count;
  final VoidCallback onHide;
  const _MapHeader({required this.count, required this.onHide});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        WainSvg.icon('map', size: 16, color: WainColors.sea600),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            '${toArabicDigits(count)} على الخريطة',
            style: wainText(
              WainText.sm,
              weight: FontWeight.w600,
              color: WainColors.ink700,
            ),
          ),
        ),
        OutlinedButton(
          key: const ValueKey('search-map-hide'),
          onPressed: onHide,
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(48, 48),
            foregroundColor: WainColors.ink700,
            shape: const StadiumBorder(),
          ),
          child: const Text('إخفاء'),
        ),
      ],
    );
  }
}

class _QueryBox extends StatelessWidget {
  final TextEditingController controller;
  final VoidCallback onChanged;
  final VoidCallback onClear;
  const _QueryBox({
    required this.controller,
    required this.onChanged,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    return Stack(
      alignment: AlignmentDirectional.centerEnd,
      children: [
        TextField(
          onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
          key: const ValueKey('search-input'),
          controller: controller,
          onChanged: (_) => onChanged(),
          textInputAction: TextInputAction.search,
          style: wainText(WainText.lg, color: WainColors.ink800),
          decoration: InputDecoration(
            hintText: 'اكتب اسم مكان، منطقة، أو جو…',
            contentPadding: const EdgeInsetsDirectional.fromSTEB(
              56,
              16,
              56,
              16,
            ),
            prefixIcon: Padding(
              padding: const EdgeInsets.all(14),
              child: WainSvg.icon('search', size: 20, color: WainColors.ink500),
            ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(WainRadius.s2xl),
              borderSide: const BorderSide(color: WainColors.lineControl),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(WainRadius.s2xl),
              borderSide: const BorderSide(color: WainColors.lineControl),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsetsDirectional.only(end: 10),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (controller.text.isNotEmpty)
                IconButton(
                  tooltip: 'مسح البحث',
                  onPressed: onClear,
                  icon: WainSvg.icon(
                    'close',
                    size: 16,
                    color: WainColors.ink500,
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _VoiceControls extends StatelessWidget {
  const _VoiceControls();

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AppState>();
    final voice = context.read<VoiceService>();
    final on = state.voiceEnabled;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        // The IconButton draws its own unnamed semantics node, which the
        // label here did not reach (labeledTapTargetGuideline found it), so
        // this node stands for it.
        Semantics(
          button: true,
          toggled: on,
          label: on ? 'إيقاف الصوت' : 'تشغيل الصوت',
          excludeSemantics: true,
          child: IconButton(
            key: const ValueKey('voice-toggle'),
            onPressed: () {
              state.setVoiceEnabled(!on);
              if (!on) {
                voice.speak(helloParts(state.persona));
              } else {
                voice.stop();
              }
            },
            icon: WainSvg.icon(
              on ? 'speaker' : 'speakeroff',
              size: 22,
              color: on ? WainColors.coral700 : WainColors.ink500,
            ),
          ),
        ),
        if (on)
          for (final p in PersonaId.values)
            Padding(
              padding: const EdgeInsetsDirectional.only(start: 4),
              child: WainChip(
                key: ValueKey('persona-${p.name}'),
                label: kPersonas[p]!.nameAr,
                active: state.persona == p,
                onTap: () {
                  if (state.persona == p) return;
                  state.setPersona(p);
                  voice.speak(helloParts(p));
                },
              ),
            ),
      ],
    );
  }
}

final _sectionHeading = wainText(
  WainText.base,
  weight: FontWeight.w600,
  color: WainColors.ink800,
);

class _Suggestions extends StatelessWidget {
  final ValueChanged<String> onPick;
  const _Suggestions({required this.onPick});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('شنو تدوّر؟', style: _sectionHeading),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final s in _suggestions)
              WainChip(label: s, active: false, onTap: () => onPick(s)),
          ],
        ),
      ],
    );
  }
}

/// The empty box's other ways on, as on the web: call شوق (a way to /find's
/// button, not a second one), browse by category, or start from the featured.
class _EmptyWaysOn extends StatelessWidget {
  const _EmptyWaysOn();

  @override
  Widget build(BuildContext context) {
    final featured = featuredPlaces().take(6).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          spacing: 10,
          runSpacing: 8,
          children: [
            Text(
              'تبي تحكي بدال ما تكتب؟',
              style: wainText(WainText.sm, color: WainColors.ink700),
            ),
            FilledButton.icon(
              key: const ValueKey('search-call-link'),
              onPressed: () => context.push('/find'),
              style: FilledButton.styleFrom(
                backgroundColor: WainColors.coral600,
                foregroundColor: Colors.white,
                shape: const StadiumBorder(),
                minimumSize: const Size(48, 48),
              ),
              icon: WainSvg.icon('call', size: 18, color: Colors.white),
              label: const Text('كلّمي شوق'),
            ),
          ],
        ),
        const SizedBox(height: 20),
        Text('دوّر بالتصنيف', style: _sectionHeading),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final c in kCategories)
              WainChip(
                key: ValueKey('search-category-${c.id}'),
                label: c.ar,
                active: false,
                // The Explore TAB, switched to — as a category result row does.
                onTap: () => context.go('/explore?category=${c.id}'),
              ),
          ],
        ),
        const SizedBox(height: 20),
        Text('أماكن ما تنقال عنها لا', style: _sectionHeading),
        const SizedBox(height: 12),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          padding: EdgeInsets.zero,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            mainAxisSpacing: 8,
            crossAxisSpacing: 8,
            mainAxisExtent: placeCardExtent(context),
          ),
          itemCount: featured.length,
          itemBuilder: (_, i) => PlaceCard(place: featured[i]),
        ),
      ],
    );
  }
}

class _AnswerLine extends StatelessWidget {
  final String text;

  /// The question, for «كمّل مع سالم» — the same question, in his chat.
  final String query;

  /// «رسّلها للربع» for the place she named.
  final VoidCallback onShare;
  const _AnswerLine({
    required this.text,
    required this.query,
    required this.onShare,
  });

  @override
  Widget build(BuildContext context) => Container(
    key: const ValueKey('search-answer'),
    margin: const EdgeInsets.only(bottom: 12),
    padding: const EdgeInsets.all(16),
    // White in her coral border, the web's ShouqAnswer: one box system, the
    // outer corner and the xs shadow, no tint of its own.
    decoration: BoxDecoration(
      color: Colors.white,
      borderRadius: BorderRadius.circular(WainRadius.s3xl),
      border: Border.all(color: WainColors.coral200),
      boxShadow: WainShadows.xs,
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            WainSvg.icon('shouq', size: 20, color: WainColors.coral700),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'أقترح عليك: $text',
                style: wainText(
                  WainText.sm,
                  color: WainColors.ink700,
                  height: 1.6,
                ),
              ),
            ),
          ],
        ),
        // Where to go from her answer, as on the web (3 October): send the
        // place she named to the group — the share panel is a screen further
        // down, unmentioned — or carry on with سالم, the same question typed,
        // with his memory of it.
        const SizedBox(height: 8),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            FilledButton.icon(
              key: const ValueKey('answer-share'),
              onPressed: onShare,
              style: FilledButton.styleFrom(
                backgroundColor: WainColors.coral700,
                foregroundColor: Colors.white,
                minimumSize: const Size(0, 48),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(WainRadius.xl),
                ),
              ),
              icon: WainSvg.icon('send', size: 16, color: Colors.white),
              label: Text(
                'رسّلها للربع',
                style: wainText(
                  WainText.sm,
                  weight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
            ),
            OutlinedButton(
              key: const ValueKey('answer-salem'),
              // Whether the question came from her call (the search a call's
              // show_places opened) or from this box — his chat says which.
              onPressed: () => context.push(
                salemHandoff(
                  query,
                  from: context.read<CallController?>()?.lastQuery == query
                      ? 'call'
                      : 'shouq',
                ),
              ),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 48),
                backgroundColor: Colors.white,
                side: const BorderSide(color: WainColors.coral200),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(WainRadius.xl),
                ),
              ),
              child: Text(
                CallCopy.toSalem,
                style: wainText(
                  WainText.sm,
                  weight: FontWeight.w600,
                  color: WainColors.coral800,
                ),
              ),
            ),
          ],
        ),
      ],
    ),
  );
}

class _ResultRow extends StatelessWidget {
  final SearchHit hit;
  final bool active;
  final ValueChanged<String> onHover;
  const _ResultRow({
    required this.hit,
    required this.active,
    required this.onHover,
  });

  /// Web URLs → app routes: `/places/<slug>/`, `/explore/?category=…`, pages.
  String get _route {
    final u = Uri.parse(hit.doc.url);
    final path = u.path.length > 1 && u.path.endsWith('/')
        ? u.path.substring(0, u.path.length - 1)
        : u.path;
    return u.replace(path: path).toString();
  }

  @override
  Widget build(BuildContext context) {
    final doc = hit.doc;
    final place = doc.kind == 'place' ? getPlace(doc.id.substring(6)) : null;
    return Padding(
      // The result, not the same name in the hangout panel below it — the
      // simulator suite taps this one (integration_test/app_test.dart).
      key: ValueKey('result-${doc.id}'),
      padding: const EdgeInsets.only(bottom: 8),
      child: Material(
        color: active ? WainColors.sea50 : Colors.white,
        borderRadius: BorderRadius.circular(WainRadius.s2xl),
        child: InkWell(
          borderRadius: BorderRadius.circular(WainRadius.s2xl),
          onTap: () => _route.startsWith('/places/')
              ? context.push(_route)
              // A category row is the Explore TAB, switched to, not pushed.
              : context.go(_route),
          child: Ink(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(WainRadius.s2xl),
              border: Border.all(
                color: active ? WainColors.sea300 : WainColors.line,
              ),
            ),
            padding: const EdgeInsets.all(10),
            child: Row(
              children: [
                if (place != null)
                  ClipRRect(
                    borderRadius: BorderRadius.circular(WainRadius.xl),
                    child: PlaceMark(place: place, tile: 44, mark: 26),
                  )
                else
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: WainColors.sand100,
                      borderRadius: BorderRadius.circular(WainRadius.xl),
                    ),
                    child: const Icon(Icons.tag, color: WainColors.sand600),
                  ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        doc.title,
                        style: wainText(
                          WainText.base,
                          weight: FontWeight.w600,
                          color: WainColors.ink900,
                        ),
                      ),
                      Text(
                        doc.subtitle,
                        style: wainText(WainText.xs, color: WainColors.ink500),
                      ),
                    ],
                  ),
                ),
                WainSvg.icon('go', size: 16, color: WainColors.sand400),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The dead end, and a way on from it: browse by category, or call شوق.
class _DeadEnd extends StatelessWidget {
  final String query;
  const _DeadEnd({required this.query});

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      title: 'ما لقينا شي عن «$query»',
      action: Column(
        children: [
          Text(
            'دوّر بالتصنيف',
            style: wainText(
              WainText.sm,
              weight: FontWeight.w600,
              color: WainColors.ink700,
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            alignment: WrapAlignment.center,
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final c in kCategories)
                ActionChip(
                  label: Text(c.ar),
                  avatar: WainSvg(
                    'assets/art/cat-icon/${c.icon}.svg',
                    size: 16,
                    color: WainColors.ink500,
                  ),
                  onPressed: () => context.go('/explore?category=${c.id}'),
                ),
            ],
          ),
          const SizedBox(height: 16),
          // A way to /find's call button, not a second one (1 October).
          FilledButton.icon(
            key: const ValueKey('dead-end-call-link'),
            onPressed: () => context.push('/find'),
            style: FilledButton.styleFrom(
              backgroundColor: WainColors.coral600,
              minimumSize: const Size(48, 48),
            ),
            icon: WainSvg.icon('call', size: 18, color: Colors.white),
            label: const Text('اضغط عشان تكلّم شوق'),
          ),
          const SizedBox(height: 12),
          TextButton(
            onPressed: () => context.go('/explore'),
            child: const Text('تصفّح كل الأماكن'),
          ),
          TextButton(
            onPressed: () => context.push('/add'),
            child: const Text('سجّل مكانك مجاناً'),
          ),
        ],
      ),
    );
  }
}
