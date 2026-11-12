// ai/agent_job.dart — the job a visitor carries between the call-centre
// agents, the web's tests/agent-job.test.mjs ported case for case: the same
// inputs and the same Arabic. It round-trips, it goes stale, a bad value is no
// job rather than a crash, an agent is never handed its own job back, and the
// context line the next agent is told says what was asked, shown and picked —
// and nothing it cannot name.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:wain/ai/agent_job.dart';

/// A store double: a map, and a switch that makes every call throw — as a
/// blocked sessionStorage does on the web.
class _Store implements JobStore {
  final m = <String, String>{};
  bool blocked = false;

  @override
  String? getItem(String key) {
    if (blocked) throw StateError('SecurityError');
    return m[key];
  }

  @override
  void setItem(String key, String value) {
    if (blocked) throw StateError('SecurityError');
    m[key] = value;
  }

  @override
  void removeItem(String key) {
    if (blocked) throw StateError('SecurityError');
    m.remove(key);
  }
}

const int T = 1800000000000;
const _names = {
  'mubarakiya-tea-houses': 'مقاهي المباركية',
  'gulf-road-cafes': 'كافيهات شارع الخليج',
  'souq-sharq': 'سوق شرق',
  'marina-mall': 'مارينا مول',
};
String? _nameOf(String s) => _names[s];

void main() {
  group('the ticket round-trips, and goes stale', () {
    // A store with the one ticket in it. A stale read drops the ticket, so
    // each read across the staleness line gets a store of its own.
    _Store written() {
      final s = _Store();
      writeJob(
        JobAgent.shouqCall,
        asked: '  قهوة هادية  ',
        shown: ['mubarakiya-tea-houses', 'gulf-road-cafes'],
        ranked: ['mubarakiya-tea-houses', 'gulf-road-cafes', 'souq-sharq'],
        store: s,
        now: T,
      );
      return s;
    }

    final s = written();

    test('what was written is read back', () {
      final j = readJob(store: s, now: T + 1000)!;
      expect(j.by, JobAgent.shouqCall);
      expect(j.asked, 'قهوة هادية');
      expect(j.shown, hasLength(2));
      expect(j.ranked, hasLength(3));
      expect(j.picked, isNull);
    });

    test('under the key the next agent reads', () {
      expect(s.m.containsKey(kJobKey), isTrue);
      expect(kJobKey, 'wain:job:v1', reason: 'the web\'s own key');
    });

    test('half an hour on, it is another visit\'s', () {
      expect(
        readJob(store: written(), now: T + kJobTtl.inMilliseconds + 1),
        isNull,
      );
      expect(
        readJob(store: written(), now: T + kJobTtl.inMilliseconds),
        isNotNull,
        reason: 'thirty minutes to the millisecond is still this visit',
      );
    });

    test('a ticket from the future is no ticket', () {
      expect(readJob(store: written(), now: T - 120000), isNull);
      expect(
        readJob(store: written(), now: T - 30000),
        isNotNull,
        reason: 'a clock a few seconds out is not the future',
      );
    });

    test('ranked defaults to what was shown', () {
      final s2 = _Store();
      writeJob(
        JobAgent.salemChat,
        asked: 'بحر',
        shown: ['marina-mall'],
        store: s2,
        now: T,
      );
      expect(readJob(store: s2, now: T)!.ranked, ['marina-mall']);
    });
  });

  group('a bad value is no job, never a crash', () {
    for (final raw in [
      '{',
      'null',
      '[]',
      jsonEncode({'v': 2, 'by': 'shouq-call', 'asked': 'x', 'at': T}),
      jsonEncode({'v': 1, 'by': 'someone', 'asked': 'x', 'at': T}),
      jsonEncode({
        'v': 1,
        'by': 'salem-chat',
        'asked': '',
        'shown': [],
        'at': T,
      }),
    ]) {
      test('«${raw.length > 40 ? raw.substring(0, 40) : raw}» reads as no '
          'job', () {
        final s = _Store()..m[kJobKey] = raw;
        expect(readJob(store: s, now: T), isNull);
      });
    }

    test('only well-formed slugs survive, and a bad pick is dropped', () {
      final s = _Store()
        ..m[kJobKey] = jsonEncode({
          'v': 1,
          'by': 'salem-chat',
          'asked': 'قهوة',
          'shown': ['ok-slug', '<script>', 7, 'Bad Slug'],
          'ranked': [],
          'picked': '../etc',
          'at': T,
        });
      final j = readJob(store: s, now: T)!;
      expect(j.shown, ['ok-slug']);
      expect(j.picked, isNull);
    });

    test('a store that throws reads as no job, and writing to it does not '
        'throw', () {
      final s = _Store()..blocked = true;
      expect(readJob(store: s, now: T), isNull);
      expect(
        () => writeJob(JobAgent.salemChat, asked: 'x', shown: [], store: s),
        returnsNormally,
      );
    });

    test('an empty store is no job', () {
      expect(readJob(store: _Store(), now: T), isNull);
    });
  });

  test('the sizes are bounded', () {
    final s = _Store();
    final many = [for (var i = 0; i < 60; i++) 'place-$i'];
    writeJob(
      JobAgent.shouqCall,
      asked: 'ق' * 400,
      shown: many,
      ranked: many,
      store: s,
      now: T,
    );
    final j = readJob(store: s, now: T)!;
    expect(j.shown, hasLength(8), reason: 'at most eight shown');
    expect(j.ranked, hasLength(40), reason: 'at most forty ranked');
    expect(j.asked.length, 160, reason: 'what was asked is cut to 160');
  });

  group('an agent is never handed its own job back', () {
    final s = _Store();
    writeJob(
      JobAgent.salemChat,
      asked: 'قهوة',
      shown: ['souq-sharq'],
      store: s,
      now: T,
    );
    test('سالم\'s chat does not pick up its own answer', () {
      expect(jobFor(JobAgent.salemChat, store: s, now: T), isNull);
    });
    test('شوق\'s call does', () {
      expect(
        jobFor(JobAgent.shouqCall, store: s, now: T)?.by,
        JobAgent.salemChat,
      );
    });
  });

  group('a pick stays with its job', () {
    test('a place from the answer is picked inside it; a place outside it '
        'starts a job of its own', () {
      final s = _Store();
      writeJob(
        JobAgent.shouqCall,
        asked: 'قهوة',
        shown: ['mubarakiya-tea-houses', 'gulf-road-cafes'],
        store: s,
        now: T,
      );
      pickInJob(
        JobAgent.shouqCall,
        'gulf-road-cafes',
        'كافيهات شارع الخليج',
        store: s,
        now: T + 5,
      );
      final j = readJob(store: s, now: T + 5)!;
      expect(j.asked, 'قهوة');
      expect(j.picked, 'gulf-road-cafes');
      expect(j.shown, hasLength(2));

      pickInJob(
        JobAgent.salemChat,
        'marina-mall',
        'مارينا مول',
        store: s,
        now: T + 10,
      );
      final k = readJob(store: s, now: T + 10)!;
      expect(k.by, JobAgent.salemChat);
      expect(k.asked, 'مارينا مول');
      expect(k.shown, ['marina-mall']);
      expect(k.picked, 'marina-mall');
    });

    // The half hour runs from the question, not from the last pick (round
    // three, review): a pick at minute 25 must not keep the job past minute 30.
    test('a pick does not restart the half hour', () {
      final s = _Store();
      const min = 60 * 1000;
      writeJob(
        JobAgent.shouqCall,
        asked: 'قهوة',
        shown: ['gulf-road-cafes'],
        store: s,
        now: T,
      );
      pickInJob(
        JobAgent.shouqCall,
        'gulf-road-cafes',
        'كافيهات شارع الخليج',
        store: s,
        now: T + 25 * min,
      );
      expect(
        readJob(store: s, now: T + 25 * min)!.picked,
        'gulf-road-cafes',
        reason: 'the pick is kept while the job is alive',
      );
      expect(
        readJob(store: s, now: T + 31 * min),
        isNull,
        reason: 'the half hour runs from the question',
      );
    });
  });

  // The web's rule (agent-job.ts, 14 October, the handover sweep #3): a pick
  // stays with the job that showed the place, or with the agent that wrote the
  // answer it came from. A place only another agent offered was never part of
  // the question the job was asked under.
  group('a pick follows the answer it came from', () {
    test('a place only in another agent\'s answer starts a job of its own', () {
      final s = _Store();
      writeJob(
        JobAgent.salemChat,
        asked: 'بحر',
        shown: ['marina-mall'],
        ranked: ['marina-mall', 'souq-sharq'],
        store: s,
        now: T,
      );
      pickInJob(
        JobAgent.shouqCall,
        'souq-sharq',
        'سوق شرق',
        store: s,
        now: T + 5,
      );
      final j = readJob(store: s, now: T + 5)!;
      expect(j.asked, 'سوق شرق', reason: 'not filed under «بحر»');
      expect(j.shown, ['souq-sharq']);
      expect(j.picked, 'souq-sharq');
    });

    test('a same-agent pick past the eighth result stays in the job', () {
      final s = _Store();
      final ranked = [for (var i = 0; i < 10; i++) 'place-$i'];
      writeJob(
        JobAgent.shouqCall,
        asked: 'قهوة',
        shown: ranked.take(8).toList(),
        ranked: ranked,
        store: s,
        now: T,
      );
      pickInJob(
        JobAgent.shouqCall,
        'place-9',
        'مكان تسعة',
        store: s,
        now: T + 5,
      );
      final j = readJob(store: s, now: T + 5)!;
      expect(j.asked, 'قهوة', reason: 'its own answer, past the eighth');
      expect(j.picked, 'place-9');
    });
  });

  // A job written from words answered on this device is marked `local`: the
  // pages that show the job still read it, and no agent is told it. The web's
  // jobToTell and the mark are agent-job.ts, the handover-privacy finding
  // (14 October, #1).
  group('a job written from words answered on this device', () {
    test('keeps its mark through a read and a pick inside the job', () {
      final s = _Store();
      writeJob(
        JobAgent.salemChat,
        asked: 'قهوة',
        shown: ['mubarakiya-tea-houses', 'souq-sharq'],
        local: true,
        store: s,
        now: T,
      );
      expect(readJob(store: s, now: T)!.local, isTrue);
      pickInJob(
        JobAgent.shouqCall,
        'souq-sharq',
        'سوق شرق',
        store: s,
        now: T + 5,
      );
      final j = readJob(store: s, now: T + 5)!;
      expect(j.local, isTrue, reason: 'a pick by another agent keeps it');
      expect(j.picked, 'souq-sharq');
      expect(j.asked, 'قهوة');
    });

    test('an unmarked job reads unmarked, and the key does not carry the '
        'field', () {
      final s = _Store();
      writeJob(
        JobAgent.shouqCall,
        asked: 'قهوة',
        shown: ['souq-sharq'],
        store: s,
        now: T,
      );
      expect(readJob(store: s, now: T)!.local, isFalse);
      expect(
        (jsonDecode(s.m[kJobKey]!) as Map).containsKey('local'),
        isFalse,
        reason: 'the web writes the field only when it is true',
      );
    });

    test('a pick that starts a job of its own takes the mark only from a '
        'local pick', () {
      final s = _Store();
      writeJob(
        JobAgent.salemChat,
        asked: 'قهوة',
        shown: ['souq-sharq'],
        local: true,
        store: s,
        now: T,
      );
      pickInJob(
        JobAgent.salemChat,
        'marina-mall',
        'مارينا مول',
        store: s,
        now: T + 5,
        local: true,
      );
      expect(readJob(store: s, now: T + 5)!.local, isTrue);
      expect(readJob(store: s, now: T + 5)!.asked, 'مارينا مول');
      pickInJob(
        JobAgent.shouqCall,
        'gulf-road-cafes',
        'كافيهات شارع الخليج',
        store: s,
        now: T + 9,
      );
      expect(readJob(store: s, now: T + 9)!.local, isFalse);
      expect(readJob(store: s, now: T + 9)!.asked, 'كافيهات شارع الخليج');
    });

    test('is read by the device, and no agent is told it', () {
      final s = _Store();
      writeJob(
        JobAgent.salemChat,
        asked: 'قهوة',
        shown: ['souq-sharq'],
        local: true,
        store: s,
        now: T,
      );
      expect(
        jobFor(JobAgent.shouqCall, store: s, now: T)?.local,
        isTrue,
        reason: 'the pages that show the job still read it',
      );
      expect(jobToTell(JobAgent.shouqCall, store: s, now: T), isNull);
      expect(jobToTell(JobAgent.salemCall, store: s, now: T), isNull);
      writeJob(
        JobAgent.salemChat,
        asked: 'قهوة',
        shown: ['souq-sharq'],
        store: s,
        now: T + 1,
      );
      expect(
        jobToTell(JobAgent.shouqCall, store: s, now: T + 1)?.by,
        JobAgent.salemChat,
        reason: 'control: a job an agent\'s own tool wrote is told',
      );
      expect(jobToTell(JobAgent.salemChat, store: s, now: T + 1), isNull);
    });
  });

  group('what the next agent is told', () {
    const job = AgentJob(
      by: JobAgent.shouqCall,
      asked: 'قهوة هادية',
      shown: [
        'mubarakiya-tea-houses',
        'gulf-road-cafes',
        'souq-sharq',
        'marina-mall',
      ],
      ranked: [],
      picked: 'gulf-road-cafes',
      at: T,
    );
    final line = jobContext(job, _nameOf);

    test('where the job was', () => expect(line, contains('مكالمته مع شوق')));
    test('what was asked', () => expect(line, contains('«قهوة هادية»')));
    test('the first three places, by name', () {
      expect(line, contains('مقاهي المباركية، كافيهات شارع الخليج، سوق شرق'));
      expect(line, isNot(contains('مارينا مول')));
    });
    test('the one picked', () {
      expect(line, contains('واختار منها: كافيهات شارع الخليج'));
    });
    test('and to carry on rather than ask again', () {
      expect(line, contains('كمّل معه من هني'));
    });
    test('the whole sentence, as the web says it', () {
      expect(
        line,
        'سياق للتسليم: الزائر جاي من مكالمته مع شوق. طلبه: «قهوة هادية». '
        'الأماكن اللي طلعت له: مقاهي المباركية، كافيهات شارع الخليج، سوق شرق. '
        'واختار منها: كافيهات شارع الخليج. '
        'كمّل معه من هني، ولا تعيد عليه سؤال جاوبه.',
      );
    });
    test('a place it cannot name is left out, not read out as a slug', () {
      final unknown = jobContext(
        const AgentJob(
          by: JobAgent.shouqCall,
          asked: 'قهوة هادية',
          shown: ['not-in-catalogue', 'souq-sharq'],
          ranked: [],
          picked: 'not-in-catalogue',
          at: T,
        ),
        _nameOf,
      );
      expect(unknown, isNot(contains('not-in-catalogue')));
      expect(unknown, contains('سوق شرق'));
      expect(unknown, isNot(contains('واختار')));
    });
    test('a job from the call-centre page with nothing shown says only what '
        'was asked', () {
      final bare = jobContext(
        const AgentJob(
          by: JobAgent.callCenter,
          asked: 'قهوة هادية',
          shown: [],
          ranked: [],
          picked: null,
          at: T,
        ),
        _nameOf,
      );
      expect(bare, contains('مركز الاتصال'));
      expect(bare, contains('«قهوة هادية»'));
      expect(bare, isNot(contains('الأماكن')));
    });
  });

  test('the app\'s own store and clock: process memory, read through the same '
      'checks', () {
    addTearDown(AgentJobs.instance.reset);
    final at = DateTime.utc(2026, 10, 15, 20);
    AgentJobs.instance.now = () => at;
    writeJob(JobAgent.shouqAnswer, asked: 'بحر', shown: ['marina-mall']);
    expect(readJob()?.asked, 'بحر');
    AgentJobs.instance.now = () => at.add(const Duration(minutes: 31));
    expect(readJob(), isNull, reason: 'thirty-one minutes on, it is stale');
  });

  // The privacy screen says the job is kept half an hour at most. A stale one
  // used to be ignored and left where it was, in a process that can run for
  // days; it is dropped the first time it is read stale.
  test('a stale job, or one stamped ahead of the clock, is dropped from the '
      'store when it is read', () {
    final s = _Store();
    writeJob(
      JobAgent.shouqCall,
      asked: 'بحر',
      shown: ['marina-mall'],
      store: s,
      now: T,
    );
    expect(readJob(store: s, now: T + 29 * 60000), isNotNull);
    expect(s.m, contains(kJobKey), reason: 'a live job is kept');
    expect(readJob(store: s, now: T + 31 * 60000), isNull);
    expect(s.m, isNot(contains(kJobKey)), reason: 'stale: gone, not ignored');
    writeJob(
      JobAgent.shouqCall,
      asked: 'بحر',
      shown: ['marina-mall'],
      store: s,
      now: T + 120000,
    );
    expect(readJob(store: s, now: T), isNull);
    expect(s.m, isNot(contains(kJobKey)), reason: 'from the future: gone');
    s.blocked = true;
    expect(
      readJob(store: s, now: T),
      isNull,
      reason: 'a store that throws',
    );
  });

  // The job is written with the real clock, so only the reset can make it go:
  // with a fixed clock a day off, the read after the reset was null whatever
  // the reset did — the stamp read as one from the future.
  test('reset forgets the job and reads the real clock again', () {
    addTearDown(AgentJobs.instance.reset);
    writeJob(JobAgent.shouqAnswer, asked: 'بحر', shown: ['marina-mall']);
    expect(readJob()?.asked, 'بحر');
    AgentJobs.instance.now = () => DateTime.utc(2000);
    AgentJobs.instance.reset();
    expect(AgentJobs.instance.store.getItem(kJobKey), isNull);
    expect(readJob(), isNull, reason: 'reset forgets it');
    expect(
      AgentJobs.instance.now().difference(DateTime.now()).inSeconds.abs(),
      lessThan(5),
    );
  });
}
