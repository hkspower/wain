/// What شوق is told after she drives the app — the strings the agent's prompt
/// was tuned against, reproduced exactly. Two registers, as on the web: the
/// PHONE CALL says «على الشاشة / الخريطة» (`WainAiCall.tsx`), because the page
/// she drove is behind the call sheet; the TYPED CHAT says «قدام الزائر»
/// (`salem-tools.ts`), because the cards appear in the conversation itself.
library;

import '../data/models.dart';
import '../data/answer_order.dart';
import '../data/search.dart';
import '../data/text_kit.dart';

class ShowPlacesResult {
  /// What the agent is told.
  final String spoken;
  final String query;

  /// Slugs to put in front of the visitor (chat) — at most eight.
  final List<String> slugs;

  /// Matching places in all, or -1 when the search could not run.
  final int total;
  final List<String> names;
  const ShowPlacesResult(
    this.spoken,
    this.query,
    this.slugs,
    this.total,
    this.names,
  );
}

/// The place hits in the order the answer gives them — `answerOrder`, the
/// one ordering the search screen and the chat share, so a question names the
/// same place on screen, in the chat and in what she is told (3 October).
List<SearchHit> placeHits(
  String query,
  SearchIndex index,
  List<Place> places, [
  AnswerClock? clock,
]) => answerOrder(
  query,
  search(query, index, limit: 40, kinds: const ['place']),
  index,
  places,
  clock,
).hits;

/// The places a free answer in سالم's chat is made of, in its order — the
/// web's SalemChat `search`: the search over EVERY kind (limit 40, so a
/// category or an area takes a slot the way it does there), `answerOrder`,
/// then the place hits. Not [placeHits], which searches places alone and so
/// finds more of them than the web's chat remembers.
List<String> chatRanked(
  String query,
  SearchIndex index,
  List<Place> places, [
  AnswerClock? clock,
]) {
  final known = {for (final p in places) p.slug};
  return [
    for (final h in answerOrder(
      query,
      search(query, index, limit: 40),
      index,
      places,
      clock,
    ).hits)
      if (h.doc.kind == 'place' &&
          known.contains(h.doc.id.substring('place:'.length)))
        h.doc.id.substring('place:'.length),
  ];
}

/// `show_places` on a CALL.
ShowPlacesResult showPlacesForCall(
  String query,
  SearchIndex index,
  List<Place> places,
) {
  final q = query.trim();
  if (q.isEmpty) {
    return const ShowPlacesResult(
      'ما وصلت كلمات بحث — ما تغيّر شي على الشاشة.',
      '',
      [],
      -1,
      [],
    );
  }
  final found = placeHits(q, index, places);
  final known = {for (final p in places) p.slug};
  final slugs = [
    for (final h in found.take(8))
      if (known.contains(h.doc.id.substring('place:'.length)))
        h.doc.id.substring('place:'.length),
  ];
  final names = found.take(3).map((h) => h.doc.title).toList();
  final total = found.length;
  if (total == 0) {
    return ShowPlacesResult(
      'ما لقيت ولا مكان يطابق «$q» — الشاشة الحين تقول «ما لقينا شي». '
      'قولي له بصراحة إن هالكلمات ما طلّعت شي، ورشّحي أقرب مكان من معرفتك، '
      'ونادي show_places مرة ثانية بكلمة أوسع (مثلاً «بحر» بدل «شاطئ هادي»). لا تسكتين.',
      q,
      slugs,
      total,
      names,
    );
  }
  final summary = total > 0
      ? '$total ${total == 1 ? "مكان مطابق" : "أماكن مطابقة"} لـ «$q» الحين على الخريطة قدام الزائر، أولها: ${names.join("، ")}. '
      : 'الأماكن المطابقة لـ «$q» الحين على الخريطة قدام الزائر. ';
  return ShowPlacesResult(
    // One place, not the list — the web's call says why (WainAiCall.tsx).
    '$summaryاختاري منها مكان واحد بس يناسب طلبه، وقولي بجملة وحدة ليش وإنه على الخريطة قدامه، '
    'وبعدها سؤال قصير يرجّع له الدور. لا تعدّدين أماكن. لا تسكتين.',
    q,
    slugs,
    total,
    names,
  );
}

/// The one-line report the call sheet shows the CALLER, because the page she
/// drove is behind it: «دوّرت لك «قهوة» — ٤ أماكن».
String lastActionForSearch(String q, int total) => total >= 0
    ? 'دوّرت لك «$q» — ${countAr(total, kPlacesCount)}'
    : 'دوّرت لك «$q»';

class OpenPlaceResult {
  final String spoken;

  /// The slug to open, or null when nothing changed.
  final String? slug;
  final Place? place;
  const OpenPlaceResult(this.spoken, this.slug, this.place);
}

final RegExp _slugRe = RegExp(r'^[a-z0-9-]+$');

/// `open_place` on a CALL.
OpenPlaceResult openPlaceForCall(String slug, List<Place> places) {
  final s = slug.trim();
  if (!_slugRe.hasMatch(s)) {
    return const OpenPlaceResult(
      'ما لقيت مكان بهذا المعرّف — ما تغيّر شي على الشاشة.',
      null,
      null,
    );
  }
  Place? place;
  for (final p in places) {
    if (p.slug == s) place = p;
  }
  if (place == null) {
    return OpenPlaceResult(
      'ما فيه مكان بالمعرّف ($s) في قائمتك — ما تغيّر شي على الشاشة. '
      'تأكدي من الـ slug اللي في قاعدة المعرفة، أو حطي الأماكن على الخريطة بـ show_places بداله.',
      null,
      null,
    );
  }
  return OpenPlaceResult(
    'صفحة «${place.nameAr}» ($s) الحين مفتوحة قدام الزائر، فيها الصور وبيانات التواصل. '
    'قولي له إنك فتحتيها، واسأليه سؤال قصير يرجّع له الدور. لا تسكتين.',
    s,
    place,
  );
}

/// `show_places` in the TYPED CHAT — cards go in the transcript, nothing navigates.
ShowPlacesResult showPlacesForChat(
  String query,
  SearchIndex index,
  List<Place> places,
) {
  final found = placeHits(query, index, places);
  final known = {for (final p in places) p.slug};
  final slugs = [
    for (final h in found.take(8))
      if (known.contains(h.doc.id.substring('place:'.length)))
        h.doc.id.substring('place:'.length),
  ];
  if (found.isEmpty) {
    return ShowPlacesResult(
      'ما لقيت ولا مكان يطابق «$query» — لا تسكتين، قولي له بصراحة إن هالكلمات ما طلّعت شي، '
      'ورشّحي أقرب مكان من معرفتك، ونادي show_places مرة ثانية بكلمة أوسع.',
      query,
      const [],
      0,
      const [],
    );
  }
  final names = found.take(3).map((h) => h.doc.title).toList();
  return ShowPlacesResult(
    '${found.length} ${found.length == 1 ? "مكان مطابق" : "أماكن مطابقة"} لـ «$query» الحين قدام الزائر، أولها: '
    '${names.join("، ")}. قولي له بجملة وحدة إنها قدامه — وسمّي الأول لو ما ذكرتيه — '
    'واسأليه سؤال قصير يرجّع له الدور. لا تسكتين.',
    query,
    slugs,
    found.length,
    names,
  );
}

/// `open_place` in the TYPED CHAT.
OpenPlaceResult openPlaceForChat(String slug, List<Place> places) {
  final s = slug.trim();
  if (!_slugRe.hasMatch(s)) {
    return const OpenPlaceResult(
      'ما لقيت مكان بهذا المعرّف — ما تغيّر شي عند الزائر.',
      null,
      null,
    );
  }
  Place? place;
  for (final p in places) {
    if (p.slug == s) place = p;
  }
  if (place == null) {
    return OpenPlaceResult(
      'ما فيه مكان بالمعرّف ($s) في قائمتك — ما تغيّر شي عند الزائر. '
      'تأكدي من الـ slug اللي في قاعدة المعرفة، أو حطي الأماكن قدامه بـ show_places بداله.',
      null,
      null,
    );
  }
  return OpenPlaceResult(
    'بطاقة «${place.nameAr}» ($s) الحين قدام الزائر. قولي له إنك حطيتيها، '
    'واسأليه سؤال قصير يرجّع له الدور. لا تسكتين.',
    s,
    place,
  );
}
