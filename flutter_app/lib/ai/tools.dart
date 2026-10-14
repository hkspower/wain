/// What the agent on the line is told after it drives the app — the strings
/// the agent's prompt was tuned against, reproduced exactly. Two registers, as
/// on the web: the PHONE CALL says «على الشاشة / الخريطة» (`WainAiCall.tsx`),
/// because the page the agent drove is behind the call sheet; the TYPED CHAT
/// says «قدام الزائر» (`salem-tools.ts`), because the cards appear in the
/// conversation itself.
///
/// Two agents (14 October): the call can be شوق's or سالم's, so its replies
/// take `salem:` and speak in that agent's grammar — «قولي» and «لا تسكتين» for
/// her, «قول» and «لا تسكت» for him. The typed chat is سالم's agent only, so it
/// speaks in his grammar alone.
library;

import '../data/models.dart';
import '../data/answer_order.dart';
import '../data/search.dart';
import '../data/text_kit.dart';

/// The form of a second-person sentence for the agent on the line: [salem]
/// chooses his, otherwise hers. Mirrors agentSay in src/lib/wain-ai.ts.
String _tell(bool salem, String fem, String masc) => salem ? masc : fem;

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

/// `show_places` on a CALL. [salem] is true when his agent is on the line.
ShowPlacesResult showPlacesForCall(
  String query,
  SearchIndex index,
  List<Place> places, {
  bool salem = false,
}) {
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
    final noMatch = _tell(
      salem,
      'قولي له بصراحة إن هالكلمات ما طلّعت شي، ورشّحي أقرب مكان من معرفتك، '
          'ونادي show_places مرة ثانية بكلمة أوسع (مثلاً «بحر» بدل «شاطئ هادي»). لا تسكتين.',
      'قول له بصراحة إن هالكلمات ما طلّعت شي، ورشّح أقرب مكان من معرفتك، '
          'ونادِ show_places مرة ثانية بكلمة أوسع (مثلاً «بحر» بدل «شاطئ هادي»). لا تسكت.',
    );
    return ShowPlacesResult(
      'ما لقيت ولا مكان يطابق «$q» — الشاشة الحين تقول «ما لقينا شي». $noMatch',
      q,
      slugs,
      total,
      names,
    );
  }
  // Agreeing, with Arabic digits — the web's countAr(MATCHING_PLACES). The old
  // line wrote «1 مكان مطابق» and «2 أماكن مطابقة» by hand; two is «مكانين».
  final summary = total > 0
      ? '${countAr(total, kMatchingPlacesCount)} لـ «$q» الحين على الخريطة قدام الزائر، أولها: ${names.join("، ")}. '
      : 'الأماكن المطابقة لـ «$q» الحين على الخريطة قدام الزائر. ';
  // One place, not the list — the web's call says why (WainAiCall.tsx).
  final ask = _tell(
    salem,
    'اختاري منها مكان واحد بس يناسب طلبه، وقولي بجملة وحدة ليش وإنه على الخريطة قدامه، '
        'وبعدها سؤال قصير يرجّع له الدور. لا تعدّدين أماكن. لا تسكتين.',
    'اختار منها مكان واحد بس يناسب طلبه، وقول بجملة وحدة ليش وإنه على الخريطة قدامه، '
        'وبعدها سؤال قصير يرجّع له الدور. لا تعدّد أماكن. لا تسكت.',
  );
  return ShowPlacesResult(
    '$summary$ask',
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

/// `open_place` on a CALL. [salem] is true when his agent is on the line.
OpenPlaceResult openPlaceForCall(
  String slug,
  List<Place> places, {
  bool salem = false,
}) {
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
    final unknown = _tell(
      salem,
      'تأكدي من الـ slug اللي في قاعدة المعرفة، أو حطي الأماكن على الخريطة بـ show_places بداله.',
      'تأكد من الـ slug اللي في قاعدة المعرفة، أو حط الأماكن على الخريطة بـ show_places بداله.',
    );
    return OpenPlaceResult(
      'ما فيه مكان بالمعرّف ($s) في قائمتك — ما تغيّر شي على الشاشة. $unknown',
      null,
      null,
    );
  }
  final ask = _tell(
    salem,
    'قولي له إنك فتحتيها، واسأليه سؤال قصير يرجّع له الدور. لا تسكتين.',
    'قول له إنك فتحتها، واسأله سؤال قصير يرجّع له الدور. لا تسكت.',
  );
  return OpenPlaceResult(
    'صفحة «${place.nameAr}» ($s) الحين مفتوحة قدام الزائر، فيها الصور وبيانات التواصل. $ask',
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
      'ما لقيت ولا مكان يطابق «$query» — لا تسكت، قول له بصراحة إن هالكلمات ما طلّعت شي، '
      'ورشّح أقرب مكان من معرفتك، ونادِ show_places مرة ثانية بكلمة أوسع.',
      query,
      const [],
      0,
      const [],
    );
  }
  final names = found.take(3).map((h) => h.doc.title).toList();
  return ShowPlacesResult(
    '${countAr(found.length, kMatchingPlacesCount)} لـ «$query» الحين قدام الزائر، أولها: '
    '${names.join("، ")}. قول له بجملة وحدة إنها قدامه — وسمّ الأول لو ما ذكرته — '
    'واسأله سؤال قصير يرجّع له الدور. لا تسكت.',
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
      'تأكد من الـ slug اللي في قاعدة المعرفة، أو حط الأماكن قدامه بـ show_places بداله.',
      null,
      null,
    );
  }
  return OpenPlaceResult(
    'بطاقة «${place.nameAr}» ($s) الحين قدام الزائر. قول له إنك حطيتها، '
    'واسأله سؤال قصير يرجّع له الدور. لا تسكت.',
    s,
    place,
  );
}
