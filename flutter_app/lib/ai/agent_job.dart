/// The job a visitor carries between the call-centre agents — شوق's call, her
/// written answer on the search screen, سالم's typed chat and his call — so
/// the next one picks it up where the last one left it. The app's half of the
/// web's `src/lib/agent-job.ts` and `agent-job-context.ts` (14–15 October).
///
/// Until then a move between them carried one string: «كمّل مع سالم» handed
/// over `?q=` and nothing else. The places she had put on screen, the one the
/// visitor had picked, and everything the agent had been told were gone, so
/// the next agent asked again what the visitor had just finished saying.
///
/// So every agent writes the job it is holding — what was asked, the places
/// it showed, the one picked — and the next one reads it when it starts: his
/// chat keeps her pick as its own, and an agent session is told the job in one
/// contextual update ([jobContext]), which it reads as background and never
/// answers aloud.
///
/// The web keeps it in the tab's sessionStorage for half an hour. The app's
/// «this visit» is the running process (salem_transcript.dart says the same of
/// the chat), so the ticket lives in memory, for the same half hour, and is
/// gone when the app is closed. Nothing here leaves the phone by itself: only
/// an agent session the visitor has opened is told it.
///
/// Held as the web's own JSON under the web's own key, and read back through
/// the same checks: a read is a copy, never a list another screen can change
/// under the one holding it, and the unit cases are the web's inputs.
library;

import 'dart:convert';

/// Who held the job last — the web's `JobAgent`, by the same names.
enum JobAgent {
  shouqCall('shouq-call'),
  shouqAnswer('shouq-answer'),
  salemChat('salem-chat'),
  salemCall('salem-call'),
  callCenter('call-center');

  const JobAgent(this.id);
  final String id;

  static JobAgent? byId(Object? id) {
    for (final a in values) {
      if (a.id == id) return a;
    }
    return null;
  }
}

class AgentJob {
  final JobAgent by;

  /// What the visitor asked — the latest question, narrowing included.
  final String asked;

  /// The places put on screen for it, in order (at most 8).
  final List<String> shown;

  /// The whole answer they came from, for «غيره» (at most 40).
  final List<String> ranked;

  /// The one the visitor pointed at or opened, if any.
  final String? picked;

  /// When it was written, ms since the epoch.
  final int at;

  const AgentJob({
    required this.by,
    required this.asked,
    required this.shown,
    required this.ranked,
    required this.picked,
    required this.at,
  });

  Map<String, Object?> toJson() => {
    'v': 1,
    'by': by.id,
    'asked': asked,
    'shown': shown,
    'ranked': ranked,
    'picked': picked,
    'at': at,
  };
}

const String kJobKey = 'wain:job:v1';

/// A job older than this is a different visit's, not this one's.
const Duration kJobTtl = Duration(minutes: 30);
const int _maxShown = 8;
const int _maxRanked = 40;
const int _maxAsked = 160;
final RegExp _slug = RegExp(r'^[a-z0-9-]{1,80}$');

/// Where the ticket is kept — the web's `Pick<Storage, "getItem" | "setItem">`
/// and `removeItem`, so a test can hand in one that throws, as a blocked
/// sessionStorage does.
abstract class JobStore {
  String? getItem(String key);
  void setItem(String key, String value);
  void removeItem(String key);
}

/// The running app's: memory, and nothing written to the disk.
class MemoryJobStore implements JobStore {
  final Map<String, String> _items = {};

  @override
  String? getItem(String key) => _items[key];

  @override
  void setItem(String key, String value) => _items[key] = value;

  @override
  void removeItem(String key) => _items.remove(key);
}

/// The one store and the one clock the app reads; tests swap either.
class AgentJobs {
  AgentJobs._();
  static final AgentJobs instance = AgentJobs._();

  JobStore store = MemoryJobStore();

  /// Tests fix the clock; the app reads it.
  DateTime Function() now = DateTime.now;

  /// For tests: forget the job, and read the real clock again.
  void reset() {
    store = MemoryJobStore();
    now = DateTime.now;
  }
}

JobStore _store(JobStore? s) => s ?? AgentJobs.instance.store;
int _now(int? n) => n ?? AgentJobs.instance.now().millisecondsSinceEpoch;

String _cut(String s, int max) {
  final t = s.trim();
  return t.length > max ? t.substring(0, max) : t;
}

List<String> _slugs(Object? v, int max) => v is List
    ? v.whereType<String>().where(_slug.hasMatch).take(max).toList()
    : <String>[];

/// The job, or null when there is none, it is stale, or it does not parse — a
/// value of an older shape is no job, never a crash.
AgentJob? readJob({JobStore? store, int? now}) {
  final at = _now(now);
  try {
    final raw = _store(store).getItem(kJobKey);
    if (raw == null || raw.isEmpty) return null;
    final j = jsonDecode(raw);
    if (j is! Map) return null;
    final asked0 = j['asked'];
    final stamp = j['at'];
    if (j['v'] != 1 || asked0 is! String || stamp is! num) return null;
    if (at - stamp > kJobTtl.inMilliseconds || stamp > at + 60000) {
      // Another visit's, or a clock that moved: no job, and not kept either.
      // It used to be ignored and left in memory until the next write, in a
      // process that can run for days, under a privacy screen that says half
      // an hour (the web's sessionStorage goes with the tab). Dropped at the
      // first read after the half hour, which is every agent's start.
      _store(store).removeItem(kJobKey);
      return null;
    }
    final by = JobAgent.byId(j['by']);
    if (by == null) return null;
    final asked = _cut(asked0, _maxAsked);
    final shown = _slugs(j['shown'], _maxShown);
    if (asked.isEmpty && shown.isEmpty) return null;
    final picked = j['picked'];
    return AgentJob(
      by: by,
      asked: asked,
      shown: shown,
      ranked: _slugs(j['ranked'], _maxRanked),
      picked: picked is String && _slug.hasMatch(picked) ? picked : null,
      at: stamp.toInt(),
    );
  } catch (_) {
    return null;
  }
}

/// Write what this agent is holding now. [ranked] defaults to what is shown.
void writeJob(
  JobAgent by, {
  required String asked,
  required List<String> shown,
  List<String>? ranked,
  String? picked,
  JobStore? store,
  int? now,
}) {
  final value = AgentJob(
    by: by,
    asked: _cut(asked, _maxAsked),
    shown: _slugs(shown, _maxShown),
    ranked: _slugs(ranked ?? shown, _maxRanked),
    picked: picked != null && _slug.hasMatch(picked) ? picked : null,
    at: _now(now),
  );
  try {
    _store(store).setItem(kJobKey, jsonEncode(value.toJson()));
  } catch (_) {
    // A store that refuses: the next agent starts fresh, as it did before.
  }
}

/// The place the visitor pointed at or opened, kept with the job it belongs
/// to. A place outside the job starts a job of its own: what was asked is the
/// place itself.
void pickInJob(
  JobAgent by,
  String slug,
  String name, {
  JobStore? store,
  int? now,
}) {
  final job = readJob(store: store, now: now);
  if (job != null && (job.shown.contains(slug) || job.ranked.contains(slug))) {
    writeJob(
      by,
      asked: job.asked,
      shown: job.shown,
      ranked: job.ranked,
      picked: slug,
      store: store,
      now: now,
    );
  } else {
    writeJob(
      by,
      asked: name,
      shown: [slug],
      picked: slug,
      store: store,
      now: now,
    );
  }
}

/// The job, if the agent starting now did not write it itself — an agent is
/// never handed back its own last answer as news.
AgentJob? jobFor(JobAgent agent, {JobStore? store, int? now}) {
  final job = readJob(store: store, now: now);
  return job != null && job.by != agent ? job : null;
}

/// Where the job was, as the next agent hears it.
const Map<JobAgent, String> _where = {
  JobAgent.shouqCall: 'مكالمته مع شوق',
  JobAgent.shouqAnswer: 'جواب شوق المكتوب في صفحة البحث',
  JobAgent.salemChat: 'محادثته المكتوبة مع سالم',
  JobAgent.salemCall: 'مكالمته مع سالم',
  JobAgent.callCenter: 'مركز الاتصال',
};

/// The job as one contextual update for the agent picking it up: background
/// it reads, not a message it answers. Arabic, because the agent's prompt is,
/// and short, because it rides in every turn after it. [nameOf] turns a slug
/// into the place's name; a slug it does not know is left out rather than
/// read out. One module here, where the web keeps it in its own: there the
/// sentence table rode in /search's bundle (15 October), and a native build
/// has no per-page chunk to keep it out of.
String jobContext(AgentJob job, String? Function(String slug) nameOf) {
  final names = [
    for (final s in job.shown)
      if (nameOf(s) case final n? when n.isNotEmpty) n,
  ].take(3).toList();
  final picked = job.picked == null ? null : nameOf(job.picked!);
  return [
    'سياق للتسليم: الزائر جاي من ${_where[job.by]}.',
    if (job.asked.isNotEmpty) 'طلبه: «${job.asked}».',
    if (names.isNotEmpty) 'الأماكن اللي طلعت له: ${names.join('، ')}.',
    if (picked != null && picked.isNotEmpty) 'واختار منها: $picked.',
    'كمّل معه من هني، ولا تعيد عليه سؤال جاوبه.',
  ].join(' ');
}
