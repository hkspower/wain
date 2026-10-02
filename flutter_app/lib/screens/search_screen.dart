import 'dart:async';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../app/app_state.dart';
import '../data/catalogue.dart';
import '../data/categories.g.dart';
import '../data/models.dart';
import '../data/places.g.dart';
import '../data/search.dart';
import '../data/text_kit.dart';
import '../data/voice_lines.dart';
import '../map/wain_map.dart';
import '../share/hangout_panel.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../voice/voice_service.dart';
import '../widgets/art.dart';
import '../widgets/layout.dart';
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
  Timer? _speakTimer;
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
  @visibleForTesting
  int searchRuns = 0;

  (List<SearchHit>, List<SearchHit>) _results(String q) {
    final key = (q, _kind);
    if (key != _memoKey) {
      searchRuns++;
      _memoKey = key;
      _memoHits = q.isEmpty ? const [] : _hits(q, kind: _kind);
      _memoAll = q.isEmpty ? const [] : _hits(q, limit: 200);
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
    month: DateTime.now().month - 1,
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
              const SizedBox(height: 10),
              // The second step is a way to /find's button, not a button of
              // its own: one way to call شوق, on request (1 October). The box
              // and the dead end each had a call button until then.
              Wrap(
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text('${toArabicDigits(1)}. دوّر بالكتابة  ·', style: _steps),
                  TextButton(
                    key: const ValueKey('search-call-link'),
                    onPressed: () => context.push('/find'),
                    style: TextButton.styleFrom(
                      foregroundColor: WainColors.coral700,
                      padding: const EdgeInsets.symmetric(horizontal: 6),
                    ),
                    child: Text(
                      '${toArabicDigits(2)}. كلّمي شوق',
                      style: _steps.copyWith(
                        color: WainColors.coral700,
                        decoration: TextDecoration.underline,
                      ),
                    ),
                  ),
                  Text('·  ${toArabicDigits(3)}. عالخريطة', style: _steps),
                ],
              ),
              const SizedBox(height: 10),
              _QueryBox(
                controller: _controller,
                onChanged: () => setState(() {}),
                onClear: () => setState(() => _controller.clear()),
              ),
              if (q.isNotEmpty) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final (id, label) in _kinds)
                      WainChip(
                        label: counts[id]! > 0
                            ? '$label ${toArabicDigits(counts[id]!)}'
                            : label,
                        active: _kind == id,
                        onTap: counts[id] == 0
                            ? null
                            : () => setState(() => _kind = id),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 20),
              if (q.isEmpty)
                _Suggestions(
                  onPick: (s) => setState(() => _controller.text = s),
                )
              else if (hits.isNotEmpty) ...[
                if (hitPlaces.isNotEmpty)
                  _AnswerLine(text: placeSuggestLine(hitPlaces.first)),
                Text(
                  countAr(hits.length, kResultsCount),
                  style: wainText(WainText.sm, color: WainColors.ink500),
                ),
                const SizedBox(height: 12),
                if (hitPlaces.isNotEmpty)
                  WainMap(
                    key: const ValueKey('search-map'),
                    places: hitPlaces,
                    activeSlug: active,
                    onActive: (s) => setState(() => _activeSlug = s),
                    onOpen: (p) => context.push('/places/${p.slug}'),
                  ),
                const SizedBox(height: 12),
                for (var i = 0; i < hits.length; i++)
                  _ResultRow(
                    hit: hits[i],
                    active: hits[i].doc.id == 'place:$active',
                    onHover: (slug) => setState(() => _activeSlug = slug),
                  ),
                if (hitPlaces.isNotEmpty && active != null)
                  ShareHangout(
                    key: const ValueKey('search-hangout'),
                    place: hitPlaces.firstWhere((p) => p.slug == active),
                    choices: hitPlaces.take(8).toList(),
                    onChoose: (s) => setState(() => _activeSlug = s),
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

class _Suggestions extends StatelessWidget {
  final ValueChanged<String> onPick;
  const _Suggestions({required this.onPick});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'شنو تدوّر؟',
          style: wainText(
            WainText.base,
            weight: FontWeight.w600,
            color: WainColors.ink800,
          ),
        ),
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

class _AnswerLine extends StatelessWidget {
  final String text;
  const _AnswerLine({required this.text});

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 12),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: WainColors.sea50,
      borderRadius: BorderRadius.circular(WainRadius.s2xl),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        WainSvg.icon('shouq', size: 20, color: WainColors.sea700),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            'أقترح عليك: $text',
            style: wainText(WainText.sm, color: WainColors.ink700, height: 1.6),
          ),
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

final _steps = wainText(
  WainText.xs,
  weight: FontWeight.w600,
  color: WainColors.ink500,
);
