/// One searchable document (`SearchDoc` in `src/lib/search.ts`). The list of
/// them is generated — see `search_data.g.dart`.
library;

class SearchDoc {
  final String id;

  /// "place" | "category" | "area" | "page"
  final String kind;
  final String title;
  final String subtitle;
  final String url;
  final String? category;

  /// Extra terms that should match but are not shown.
  final List<String> keywords;
  final String body;

  const SearchDoc({
    required this.id,
    required this.kind,
    required this.title,
    required this.subtitle,
    required this.url,
    this.category,
    required this.keywords,
    required this.body,
  });
}

class SearchHit {
  final SearchDoc doc;
  final double score;

  /// Index terms that matched, for highlighting.
  final List<String> matched;

  const SearchHit(this.doc, this.score, this.matched);
}
