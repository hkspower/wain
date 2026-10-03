/// سالم's conversation, kept while the app is running.
///
/// A card in the chat opens a place, and «شوف الكل بالبحث» switches to the
/// search tab — both take the visitor off the chat, and coming back used to
/// land on «هلا! أنا سالم» and nothing else: the answer they had followed was
/// gone. The web keeps it in sessionStorage (`SalemChat.tsx`, `KEPT`): this
/// tab, this visit. The app's equivalent of «this visit» is the running
/// process, so the transcript lives here, in memory, and nowhere else —
/// nothing is written to the disk and nothing leaves the phone, which is what
/// the notice under the chat says.
///
/// The free chat only, as on the web: an agent conversation lives on its
/// socket, and a transcript restored without the session behind it would be a
/// chat that cannot answer.
library;

import 'package:flutter/foundation.dart';

import '../data/salem_followup.dart';

/// A line in the transcript — something either side SAID, a note from the
/// screen itself, or one of the answer's blocks (the web's `ChatLine`).
sealed class ChatLine {}

/// «user», «agent» or «system».
class ChatText extends ChatLine {
  final String role;
  final String text;
  ChatText(this.role, this.text);

  /// Played its arrival once; a ListView rebuilds rows as they scroll back
  /// into view, and a line must not slide in a second time.
  bool seen = false;
}

/// An answer's places: the cards, the map, the share panel and — under the
/// newest one only — the replies that would change it.
class ChatPlaces extends ChatLine {
  final String query;
  final List<String> slugs;
  final List<String>? chips;
  ChatPlaces(this.query, this.slugs, [this.chips]);
}

/// One place, picked («الثاني») or opened by the agent: its card and the
/// share panel.
class ChatPlace extends ChatLine {
  final String slug;
  ChatPlace(this.slug);
}

/// «وين بالضبط؟» — one place on the map, with the way there.
class ChatWhere extends ChatLine {
  final String slug;
  ChatWhere(this.slug);
}

class SalemTranscript {
  SalemTranscript._();
  static final SalemTranscript instance = SalemTranscript._();

  /// Lines kept, the newest — the web's KEPT_LINES.
  static const int keep = 60;

  List<ChatLine> _lines = [];
  ChatContext? context;

  List<ChatLine> get lines => _lines;

  void save(List<ChatLine> lines, ChatContext? ctx) {
    _lines = lines.length > keep
        ? lines.sublist(lines.length - keep)
        : List.of(lines);
    context = ctx;
  }

  /// Every line restored has already been seen: none slides in again.
  List<ChatLine> restore() {
    for (final l in _lines) {
      if (l is ChatText) l.seen = true;
    }
    return List.of(_lines);
  }

  @visibleForTesting
  void clear() {
    _lines = [];
    context = null;
  }
}
