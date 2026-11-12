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

  /// The answer these chips were offered under: a chip acts on IT, whatever
  /// the chat remembers by the time it is tapped. They read the memory, and a
  /// «شكراً» that found nothing had wiped it, so «وين بالضبط؟» under four
  /// cafés was searched as words and answered with the Grand Mosque (the
  /// web's finding, 8 October).
  final ChatContext? context;

  /// The place the visitor picked in this answer (a pin, a card or the share
  /// panel), kept on the line: the block is rebuilt when a line is added below
  /// it, and it starts from here, so the pick survives the next message
  /// (14 October). Cleared when the kept transcript is restored, as the web
  /// drops it on a reload.
  String? picked;

  ChatPlaces(this.query, this.slugs, [this.chips, this.context]);
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

  /// Every line restored has already been seen: none slides in again, and no
  /// pick carries over (the screen's own pick starts where the answer starts).
  List<ChatLine> restore() {
    for (final l in _lines) {
      if (l is ChatText) l.seen = true;
      if (l is ChatPlaces) l.picked = null;
    }
    return List.of(_lines);
  }

  @visibleForTesting
  void clear() {
    _lines = [];
    context = null;
  }
}
