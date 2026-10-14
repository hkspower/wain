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

  /// A place's own area, as the catalogue spells it — the own-area rule in
  /// `search()`. Only place documents carry it.
  final String? area;

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
    this.area,
    required this.keywords,
    required this.body,
  });
}

class SearchHit {
  final SearchDoc doc;
  final double score;

  /// Index terms that matched, for highlighting.
  final List<String> matched;

  /// Which of the question's WORDS this document answers with some
  /// confidence — an exact, glued, synonym, prefix or one-letter-off reading,
  /// not a two-letter guess (`SearchHit.tokens` on the web). The answer reads
  /// it to own up to a word the place it names did not match.
  final List<String> tokens;

  const SearchHit(this.doc, this.score, this.matched, [this.tokens = const []]);
}
