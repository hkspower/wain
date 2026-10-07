/// A shortlist's vote, counted on wain's own back end — the web's
/// `lib/votes.ts`, against the same `vote_cast` / `votes_get`.
///
/// No name: the device keeps a random voter id so a second tap moves its
/// vote rather than adding one, and the server answers with the tally alone.
library;

import 'dart:convert';
import 'dart:math';

import 'package:shared_preferences/shared_preferences.dart';

import '../orders/order_api.dart';

const String kVoterKey = 'wain:voter';
const String kMyVotesKey = 'wain:my-votes';

class Tally {
  final Map<String, int> tally;
  final int total;
  const Tally(this.tally, this.total);

  /// The slug with the most votes, when exactly one has the most.
  String? get leader {
    if (total == 0) return null;
    final sorted = tally.entries.toList()..sort((a, b) => b.value.compareTo(a.value));
    if (sorted.length > 1 && sorted[0].value == sorted[1].value) return null;
    return sorted.first.key;
  }

  static Tally? from(Map<String, Object?> data) {
    final t = data['tally'];
    final total = data['total'];
    if (t is! Map || total is! num) return null;
    return Tally({for (final e in t.entries) '${e.key}': (e.value as num).toInt()}, total.toInt());
  }
}

class VoteClient {
  VoteClient([OrderApi? api]) : _api = api ?? OrderApi();
  final OrderApi _api;

  Future<String> voterId() async {
    final prefs = await SharedPreferences.getInstance();
    final kept = prefs.getString(kVoterKey);
    if (kept != null && RegExp(r'^[a-f0-9]{32}$').hasMatch(kept)) return kept;
    final r = Random.secure();
    final fresh = [for (var i = 0; i < 16; i++) r.nextInt(256).toRadixString(16).padLeft(2, '0')].join();
    await prefs.setString(kVoterKey, fresh);
    return fresh;
  }

  Future<String?> myVote(String poll) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final all = jsonDecode(prefs.getString(kMyVotesKey) ?? '{}');
      return all is Map && all[poll] is String ? all[poll] as String : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> _remember(String poll, String slug) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = jsonDecode(prefs.getString(kMyVotesKey) ?? '{}');
      final all = raw is Map ? Map<String, Object?>.from(raw) : <String, Object?>{};
      all[poll] = slug;
      final keys = all.keys.toList();
      final kept = {for (final k in keys.skip(max(0, keys.length - 30))) k: all[k]};
      await prefs.setString(kMyVotesKey, jsonEncode(kept));
    } catch (_) {}
  }

  /// Cast (or move) this device's vote. Null when it could not be counted.
  Future<Tally?> cast(String poll, String slug, List<String> options) async {
    final r = await _api.call('vote_cast', {
      'poll': poll,
      'voter': await voterId(),
      'place_slug': slug,
      'options': options,
    });
    if (!r.ok) return null;
    await _remember(poll, slug);
    return Tally.from(r.data);
  }

  Future<Tally?> read(String poll, List<String> options) async {
    final r = await _api.call('votes_get', {'poll': poll, 'options': options});
    return r.ok ? Tally.from(r.data) : null;
  }
}
