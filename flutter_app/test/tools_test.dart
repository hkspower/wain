// What the agent on the line is told after it drives the app (lib/ai/tools.dart).
// Two agents since 14 October: a call's replies speak in the grammar of the
// persona on the line — hers («قولي», «لا تسكتين») or his («قول», «لا تسكت») —
// and the typed chat is his agent alone, so it only ever speaks his grammar.
// The count of matching places agrees with its noun, in Arabic digits, the way
// the web's countAr(MATCHING_PLACES) does.
import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/tools.dart';
import 'package:wain/data/answer_order.dart';
import 'package:wain/data/catalogue.dart';
import 'package:wain/data/places.g.dart';
import 'package:wain/data/search.dart';
import 'package:wain/data/text_kit.dart';

void main() {
  final index = searchIndex;

  test('a call with شوق is told in her grammar', () {
    final r = showPlacesForCall('بحر', index, kPlaces);
    expect(r.total, greaterThan(0));
    expect(r.spoken, contains('قولي بجملة وحدة ليش'));
    expect(r.spoken, contains('لا تعدّدين أماكن. لا تسكتين.'));
  });

  test('a call with سالم is told in his grammar, never hers', () {
    final r = showPlacesForCall('بحر', index, kPlaces, salem: true);
    expect(r.total, greaterThan(0));
    expect(r.spoken, contains('قول بجملة وحدة ليش'));
    expect(r.spoken, contains('لا تعدّد أماكن. لا تسكت.'));
    expect(r.spoken, isNot(contains('تسكتين')));
    expect(r.spoken, isNot(contains('قولي')));
    expect(r.spoken, isNot(contains('تعدّدين')));
  });

  test('no match, his way: he is told to say so, and to try a wider word', () {
    final r = showPlacesForCall('زقزقة', index, kPlaces, salem: true);
    expect(r.total, 0);
    expect(r.spoken, contains('قول له بصراحة إن هالكلمات ما طلّعت شي'));
    expect(r.spoken, contains('ونادِ show_places'));
    expect(r.spoken, endsWith('لا تسكت.'));
    expect(r.spoken, isNot(contains('تسكتين')));
  });

  test('no match, hers: unchanged, still in her grammar', () {
    final r = showPlacesForCall('زقزقة', index, kPlaces);
    expect(r.total, 0);
    expect(r.spoken, contains('قولي له بصراحة إن هالكلمات ما طلّعت شي'));
    expect(r.spoken, endsWith('لا تسكتين.'));
  });

  test('the count agrees with its noun, in Arabic digits, for either agent', () {
    var matched = 0;
    for (final q in ['بحر', 'قهوة', 'مطعم', 'عشا', 'طلعة']) {
      for (final salem in [false, true]) {
        final r = showPlacesForCall(q, index, kPlaces, salem: salem);
        if (r.total <= 0) continue;
        matched++;
        expect(
          r.spoken,
          startsWith(countAr(r.total, kMatchingPlacesCount)),
          reason: '«$q» with ${salem ? 'سالم' : 'شوق'}: ${r.spoken}',
        );
      }
    }
    expect(matched, greaterThan(0), reason: 'no query matched, so nothing was checked');
  });

  test('the count forms: one, two, a few, many — as the web says them', () {
    expect(countAr(1, kMatchingPlacesCount), 'مكان واحد مطابق');
    expect(countAr(2, kMatchingPlacesCount), 'مكانين مطابقين');
    expect(countAr(5, kMatchingPlacesCount), '٥ أماكن مطابقة');
    expect(countAr(12, kMatchingPlacesCount), '١٢ مكان مطابق');
  });

  test('the typed chat is his, and it never says her grammar', () {
    final r = showPlacesForChat('بحر', index, kPlaces);
    expect(r.total, greaterThan(0));
    expect(r.spoken, contains('قول له بجملة وحدة إنها قدامه'));
    expect(r.spoken, contains('واسأله سؤال قصير'));
    expect(r.spoken, isNot(contains('تسكتين')));
    expect(r.spoken, isNot(contains('قولي')));
    expect(r.spoken, startsWith(countAr(r.total, kMatchingPlacesCount)));

    final miss = showPlacesForChat('زقزقة', index, kPlaces);
    expect(miss.spoken, contains('لا تسكت، قول له بصراحة'));
    expect(miss.spoken, isNot(contains('تسكتين')));
  });

  test('open_place: her grammar for her call, his for his', () {
    final her = openPlaceForCall('kuwait-towers', kPlaces);
    expect(her.slug, 'kuwait-towers');
    expect(her.spoken, contains('قولي له إنك فتحتيها'));
    expect(her.spoken, endsWith('لا تسكتين.'));

    final his = openPlaceForCall('kuwait-towers', kPlaces, salem: true);
    expect(his.slug, 'kuwait-towers');
    expect(his.spoken, contains('قول له إنك فتحتها'));
    expect(his.spoken, endsWith('لا تسكت.'));

    final unknown = openPlaceForCall('no-such-place', kPlaces, salem: true);
    expect(unknown.slug, isNull);
    expect(unknown.spoken, contains('تأكد من الـ slug'));
    expect(unknown.spoken, isNot(contains('تأكدي')));
  });

  test('open_place in the typed chat is his grammar', () {
    final r = openPlaceForChat('kuwait-towers', kPlaces);
    expect(r.slug, 'kuwait-towers');
    expect(r.spoken, contains('قول له إنك حطيتها'));
    expect(r.spoken, endsWith('لا تسكت.'));
    expect(r.spoken, isNot(contains('تسكتين')));
  });

  // The web's call and chat search EVERY kind (limit 40, so a category or an
  // area takes a slot), order the hits with answerOrder and keep the places.
  // The app searched places alone, which is the same answer until more than
  // forty documents match: «بحر الكويت» matches 46, and the app said forty
  // places where the site says fewer — and handed the next agent a job
  // holding places the web's job does not (agent_job.dart).
  test('show_places counts, shows and hands on the web\'s answer: every '
      'kind, then the places', () {
    const q = 'بحر الكويت';
    expect(search(q, index, limit: 200).length, greaterThan(40));
    final web = [
      for (final h in answerOrder(
        q,
        search(q, index, limit: 40),
        index,
        kPlaces,
      ).hits)
        if (h.doc.kind == 'place') h.doc.id.substring('place:'.length),
    ];
    for (final r in [
      showPlacesForCall(q, index, kPlaces),
      showPlacesForChat(q, index, kPlaces),
    ]) {
      expect(r.total, web.length);
      expect(r.ranked, web);
      expect(r.slugs, web.take(8).toList());
    }
    expect(chatRanked(q, index, kPlaces), web);
  });
}
