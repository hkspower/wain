/// Port of `src/lib/search.ts` — the ALGORITHM only. Its data (documents,
/// synonyms, stopwords, the «elsewhere in Kuwait» list) is generated into
/// `search_data.g.dart`, and `test/search_parity_test.dart` replays the web
/// engine's own answers for ~200 queries, so «faithful» is measured.
///
/// Same pieces, same order, same constants:
///   normalise → tokenise → (exact | declitic | prefix | fuzzy) candidates →
///   BM25 over weighted fields → coverage, kind, area-only and category
///   multipliers.
///
/// Two JavaScript behaviours the port has to reproduce by hand:
///  * `Array.prototype.sort` is STABLE; Dart's `List.sort` is not. Every sort
///    here goes through [_stableSort], or equal scores would swap places.
///  * Maps and Sets iterate in insertion order in both languages, and the
///    score sums depend on it (floating-point addition is not associative),
///    so nothing here uses a hash-ordered collection.
library;

import 'dart:math' as math;

import 'arabic.dart';
import 'categories.g.dart';
import 'models.dart';
import 'search_data.g.dart';
import 'search_doc.dart';

export 'search_doc.dart';

// ── text handling ──────────────────────────────────────────────────────────

final RegExp _harakat = RegExp('[ً-ٰٞ]');
final RegExp _combining = RegExp(r'\p{M}', unicode: true);
final RegExp _nonWord = RegExp(r'[^\p{L}\p{N}]+', unicode: true);
final RegExp _arabicDigit = RegExp('[٠-٩]');

/// What NFD + «strip combining marks» does to the precomposed Latin letters a
/// catalogue can contain («Cafés»). Dart's core library has no normaliser, and
/// the Arabic half of `normalise` is done by the explicit folds above it, so
/// this covers the only characters that still need it. The parity fixtures
/// include «Cafés», «café» and «Café», and a letter missing here fails them.
const Map<String, String> _latinFold = {
  'à': 'a',
  'á': 'a',
  'â': 'a',
  'ã': 'a',
  'ä': 'a',
  'å': 'a',
  'ā': 'a',
  'ç': 'c',
  'ć': 'c',
  'č': 'c',
  'è': 'e',
  'é': 'e',
  'ê': 'e',
  'ë': 'e',
  'ē': 'e',
  'ę': 'e',
  'ì': 'i',
  'í': 'i',
  'î': 'i',
  'ï': 'i',
  'ī': 'i',
  'ñ': 'n',
  'ń': 'n',
  'ò': 'o',
  'ó': 'o',
  'ô': 'o',
  'õ': 'o',
  'ö': 'o',
  'ō': 'o',
  'ù': 'u',
  'ú': 'u',
  'û': 'u',
  'ü': 'u',
  'ū': 'u',
  'ý': 'y',
  'ÿ': 'y',
  'š': 's',
  'ś': 's',
  'ž': 'z',
  'ź': 'z',
};

String normalise(String value) {
  var s = toStandardArabic(value)
      .toLowerCase()
      .replaceAll(_harakat, '')
      .replaceAll('ـ', '')
      .replaceAll(RegExp('[أإآٱ]'), 'ا')
      .replaceAll('ى', 'ي')
      .replaceAll('ؤ', 'و')
      .replaceAll('ئ', 'ي')
      .replaceAll('ة', 'ه')
      .replaceAllMapped(
        _arabicDigit,
        (m) => '٠١٢٣٤٥٦٧٨٩'.indexOf(m[0]!).toString(),
      );
  final buf = StringBuffer();
  for (final r in s.runes) {
    final ch = String.fromCharCode(r);
    buf.write(_latinFold[ch] ?? ch);
  }
  s = buf.toString().replaceAll(_combining, '');
  return _jsTrim(s);
}

/// JavaScript's `trim()` strips the Unicode White_Space set plus U+FEFF; Dart's
/// also strips a slightly different set. A query ending in a no-break space is
/// exactly the input this matters for.
String _jsTrim(String s) {
  bool ws(int c) =>
      c == 0x09 ||
      c == 0x0A ||
      c == 0x0B ||
      c == 0x0C ||
      c == 0x0D ||
      c == 0x20 ||
      c == 0xA0 ||
      c == 0x1680 ||
      (c >= 0x2000 && c <= 0x200A) ||
      c == 0x2028 ||
      c == 0x2029 ||
      c == 0x202F ||
      c == 0x205F ||
      c == 0x3000 ||
      c == 0xFEFF;
  var a = 0, b = s.length;
  while (a < b && ws(s.codeUnitAt(a))) {
    a++;
  }
  while (b > a && ws(s.codeUnitAt(b - 1))) {
    b--;
  }
  return s.substring(a, b);
}

List<String> tokenize(String value) {
  return normalise(value)
      .split(_nonWord)
      .where((t) => t.length > 1 && !kStopwords.contains(t))
      .map((t) => (t.length > 3 && t.startsWith('ال')) ? t.substring(2) : t)
      .toList();
}

/// The synonym table keyed the way lookups arrive (normalised), colliding
/// entries merged — built once at load, like `SYNONYM_LOOKUP` on the web.
final Map<String, List<String>> _synonymLookup = () {
  final m = <String, List<String>>{};
  kSynonyms.forEach((key, values) {
    final k = normalise(key);
    final merged = <String>[...(m[k] ?? const <String>[])];
    for (final v in values.map(normalise)) {
      if (!merged.contains(v)) merged.add(v);
    }
    m[k] = merged;
  });
  return m;
}();

List<String> _variantsOf(String token) {
  final out = <String>[token];
  for (final s in _synonymLookup[token] ?? const <String>[]) {
    if (!out.contains(s)) out.add(s);
  }
  return out;
}

List<String> _declitic(String token) {
  final out = <String>[];
  void add(String t) {
    if (t.length > 1 && !out.contains(t) && t != token) out.add(t);
  }

  for (final p in const ['بال', 'وال', 'فال', 'كال', 'لل']) {
    if (token.startsWith(p) && token.length > p.length + 1) {
      add(token.substring(p.length));
    }
  }
  for (final p in const ['و', 'ب', 'ل', 'ك', 'ف']) {
    if (token.startsWith(p) && token.length > 3) {
      final rest = token.substring(1);
      add(rest);
      if (rest.startsWith('ال') && rest.length > 3) add(rest.substring(2));
    }
  }
  return out;
}

int _editDistance(String a, String b, int max) {
  if ((a.length - b.length).abs() > max) return max + 1;
  var prev = List<int>.generate(b.length + 1, (i) => i);
  for (var i = 1; i <= a.length; i++) {
    final cur = <int>[i];
    var best = i;
    for (var j = 1; j <= b.length; j++) {
      final v = math.min(
        math.min(prev[j] + 1, cur[j - 1] + 1),
        prev[j - 1] + (a.codeUnitAt(i - 1) == b.codeUnitAt(j - 1) ? 0 : 1),
      );
      cur.add(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// ── index ──────────────────────────────────────────────────────────────────

const _fieldWeight = {'title': 4, 'subtitle': 2, 'keywords': 3, 'body': 1};
const _k1 = 1.2;
const _b = 0.75;

class _Posting {
  final int docIndex;
  final int weighted;
  const _Posting(this.docIndex, this.weighted);
}

class SearchIndex {
  final List<SearchDoc> docs;
  final Map<String, List<_Posting>> _postings;
  final List<int> _docLen;
  final double _avgLen;
  final List<String> _terms;
  final Set<String> _areaTerms;
  final Map<String, String> _categoryTerms;

  SearchIndex._(
    this.docs,
    this._postings,
    this._docLen,
    this._avgLen,
    this._terms,
    this._areaTerms,
    this._categoryTerms,
  );

  factory SearchIndex.build([List<SearchDoc>? list]) {
    final docs = list ?? kSearchDocs;
    final postings = <String, List<_Posting>>{};
    final docLen = <int>[];

    for (var i = 0; i < docs.length; i++) {
      final doc = docs[i];
      final counts = <String, int>{};
      var len = 0;
      void add(String text, int weight) {
        for (final t in tokenize(text)) {
          counts[t] = (counts[t] ?? 0) + weight;
          len += weight;
        }
      }

      add(doc.title, _fieldWeight['title']!);
      add(doc.subtitle, _fieldWeight['subtitle']!);
      add(doc.keywords.join(' '), _fieldWeight['keywords']!);
      add(doc.body, _fieldWeight['body']!);

      docLen.add(len == 0 ? 1 : len);
      counts.forEach((term, weighted) {
        (postings[term] ??= <_Posting>[]).add(_Posting(i, weighted));
      });
    }

    final avgLen =
        docLen.fold<int>(0, (a, b) => a + b) /
        (docLen.isEmpty ? 1 : docLen.length);
    final areaTerms = <String>{};
    for (final doc in docs) {
      if (doc.kind == 'area') areaTerms.addAll(tokenize(doc.title));
    }
    final categoryTerms = <String, String>{};
    for (final c in kCategories) {
      for (final t in [...tokenize(c.ar), ...tokenize(c.en)]) {
        categoryTerms[t] = c.id;
      }
    }
    return SearchIndex._(
      docs,
      postings,
      docLen,
      avgLen,
      postings.keys.toList(),
      areaTerms,
      categoryTerms,
    );
  }

  bool hasTerm(String t) => _postings.containsKey(t);
}

typedef _Cand = ({String term, double boost});

List<_Cand> _candidates(String term, SearchIndex index) {
  if (kElsewhereInKuwait.contains(term) && !index._postings.containsKey(term)) {
    return const [];
  }
  final found = <_Cand>[];
  if (index._postings.containsKey(term)) found.add((term: term, boost: 1.0));
  for (final stripped in _declitic(term)) {
    if (index._postings.containsKey(stripped)) {
      found.add((term: stripped, boost: 0.95));
    }
  }
  if (found.isNotEmpty) return found;

  final prefix = index._terms.where((t) => t.startsWith(term)).toList();
  if (prefix.isNotEmpty) {
    return prefix.take(12).map((t) => (term: t, boost: 0.82)).toList();
  }

  if (term.length < 4) return const [];

  final max = term.length >= 6 ? 2 : 1;
  final fuzzy = <_Cand>[];
  for (final t in index._terms) {
    final d = _editDistance(term, t, max);
    if (d <= max) fuzzy.add((term: t, boost: d == 1 ? 0.62 : 0.42));
  }
  _stableSort(fuzzy, (a, b) => b.boost.compareTo(a.boost));
  return fuzzy.take(8).toList();
}

void _stableSort<T>(List<T> list, int Function(T, T) cmp) {
  final decorated = [for (var i = 0; i < list.length; i++) (i, list[i])];
  decorated.sort((x, y) {
    final c = cmp(x.$2, y.$2);
    return c != 0 ? c : x.$1.compareTo(y.$1);
  });
  for (var i = 0; i < list.length; i++) {
    list[i] = decorated[i].$2;
  }
}

List<SearchHit> search(
  String query,
  SearchIndex index, {
  int limit = 20,
  List<String>? kinds,
}) {
  final raw = tokenize(query);
  if (raw.isEmpty) return const [];
  final n = index.docs.length;
  final scores = <int, double>{};
  final hitTerms = <int, Set<String>>{};
  final hitTokens = <int, Set<String>>{};

  for (final rawToken in raw) {
    for (final token in _variantsOf(rawToken)) {
      final isTyped = token == rawToken;
      for (final c in _candidates(token, index)) {
        final postings = index._postings[c.term];
        if (postings == null) continue;
        final idf = math.log(
          1 + (n - postings.length + 0.5) / (postings.length + 0.5),
        );
        for (final p in postings) {
          final dl = index._docLen[p.docIndex].toDouble();
          final tf =
              (p.weighted * (_k1 + 1)) /
              (p.weighted + _k1 * (1 - _b + _b * (dl / index._avgLen)));
          final add = idf * tf * c.boost * (isTyped ? 1 : 0.55);
          scores[p.docIndex] = (scores[p.docIndex] ?? 0) + add;
          (hitTerms[p.docIndex] ??= <String>{}).add(c.term);
          (hitTokens[p.docIndex] ??= <String>{}).add(rawToken);
        }
      }
    }
  }

  final areaTokens = raw.where((t) => index._areaTerms.contains(t)).toSet();
  final asksForMore = areaTokens.isNotEmpty && areaTokens.length < raw.length;

  final wantedCategories = <String>{};
  for (final rawToken in raw) {
    for (final token in _variantsOf(rawToken)) {
      final id = index._categoryTerms[token];
      if (id != null) wantedCategories.add(id);
    }
  }

  final hits = <SearchHit>[];
  scores.forEach((docIndex, score) {
    final doc = index.docs[docIndex];
    if (kinds != null && !kinds.contains(doc.kind)) return;
    final matchedTokens = hitTokens[docIndex] ?? const <String>{};
    final coverage = matchedTokens.length / raw.length;
    final onlyArea = asksForMore && matchedTokens.every(areaTokens.contains);
    final kindBoost = doc.kind == 'place'
        ? 1.15
        : (doc.kind == 'page' ? 0.7 : 1.0);
    hits.add(
      SearchHit(
        doc,
        score *
            (0.65 + 0.35 * math.min(1.0, coverage)) *
            kindBoost *
            (onlyArea ? 0.2 : 1.0) *
            (doc.category != null && wantedCategories.contains(doc.category)
                ? 1.5
                : 1.0),
        (hitTerms[docIndex] ?? const <String>{}).toList(),
      ),
    );
  });

  _stableSort(hits, (a, b) => b.score.compareTo(a.score));
  return hits.take(limit).toList();
}

/// Places in ranked order — what the search and explore screens show.
List<Place> searchPlaces(
  String query,
  SearchIndex index,
  List<Place> all, {
  int limit = 52,
}) {
  final bySlug = {for (final p in all) p.slug: p};
  return [
    for (final h in search(query, index, limit: limit, kinds: const ['place']))
      ?bySlug[h.doc.id.substring('place:'.length)],
  ];
}
