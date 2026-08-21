/// Accounts, passwords and sessions.
///
/// The rules are the web build's, kept deliberately identical:
///
///   * passwords are never stored — only a PBKDF2-HMAC-SHA256 hash of them,
///     with a per-account random salt and 310,000 iterations (the OWASP
///     figure for SHA-256);
///   * a wrong password counts against a lockout, so a stolen laptop cannot be
///     brute-forced at machine speed;
///   * sessions expire after 24 hours whether or not anyone signs out.
///
/// A desktop app makes one thing worse than the browser did: the hash file
/// sits on a disk someone else may reach. That is exactly why the iteration
/// count is not negotiable downwards for the sake of a faster login.
library;

import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

const int kPbkdf2Iterations = 310000;
const int kSaltBytes = 16;
const int kHashBytes = 32;
const Duration kSessionTtl = Duration(hours: 24);
const int kMaxAttempts = 5;
const Duration kLockout = Duration(minutes: 15);

/// PBKDF2-HMAC-SHA256, written out rather than taken on trust.
///
/// Correctness here is not a matter of taste — the test suite checks it
/// against a published vector, because a subtly wrong KDF still produces
/// convincing-looking hex and would silently make every password equivalent.
Uint8List pbkdf2({
  required String password,
  required Uint8List salt,
  int iterations = kPbkdf2Iterations,
  int length = kHashBytes,
}) {
  final hmac = Hmac(sha256, utf8.encode(password));
  final out = BytesBuilder();
  var block = 1;
  while (out.length < length) {
    // U1 = PRF(password, salt || INT_BE32(block))
    final input = Uint8List(salt.length + 4)
      ..setRange(0, salt.length, salt)
      ..buffer.asByteData().setUint32(salt.length, block, Endian.big);
    var u = Uint8List.fromList(hmac.convert(input).bytes);
    final acc = Uint8List.fromList(u);
    for (var i = 1; i < iterations; i++) {
      u = Uint8List.fromList(hmac.convert(u).bytes);
      for (var j = 0; j < acc.length; j++) {
        acc[j] ^= u[j];
      }
    }
    out.add(acc);
    block++;
  }
  return Uint8List.fromList(out.toBytes().sublist(0, length));
}

String _hex(List<int> bytes) =>
    bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();

/// Decode hex, or give back nothing.
///
/// The salt and the hash come out of a JSON file on the user's own disk. That
/// file can be edited, truncated by a full disk, or written by an older
/// version — and any of those can leave a value that is a perfectly good JSON
/// string and not hex at all. int.parse throws on the first bad pair, and this
/// runs inside sign-in, so a single stray character in that file made the app
/// impossible to open rather than the account impossible to verify. An empty
/// result cannot match any derived key, so verify() answers false, which is
/// the correct answer for a record we cannot read.
Uint8List _unhex(String s) {
  if (s.length.isOdd) return Uint8List(0);
  final out = Uint8List(s.length ~/ 2);
  for (var i = 0; i < out.length; i++) {
    final byte = int.tryParse(s.substring(i * 2, i * 2 + 2), radix: 16);
    if (byte == null) return Uint8List(0);
    out[i] = byte;
  }
  return out;
}

Uint8List randomSalt([int bytes = kSaltBytes]) {
  final rng = Random.secure();
  return Uint8List.fromList(List.generate(bytes, (_) => rng.nextInt(256)));
}

class Account {
  Account({
    required this.name,
    required this.email,
    required this.saltHex,
    required this.hashHex,
    required this.iterations,
    required this.createdAt,
    this.suspended = false,
  });

  final String name;
  final String email;
  final String saltHex;
  final String hashHex;
  final int iterations;
  final DateTime createdAt;
  final bool suspended;

  static Account create({
    required String name,
    required String email,
    required String password,
    DateTime? now,
  }) {
    final salt = randomSalt();
    return Account(
      name: name,
      email: email.trim().toLowerCase(),
      saltHex: _hex(salt),
      hashHex: _hex(pbkdf2(password: password, salt: salt)),
      iterations: kPbkdf2Iterations,
      createdAt: now ?? DateTime.now(),
    );
  }

  /// Constant-time comparison: a length-or-first-difference `==` leaks how much
  /// of a guess was right, one byte at a time.
  bool verify(String password) {
    final got = pbkdf2(
      password: password,
      salt: _unhex(saltHex),
      iterations: iterations,
    );
    final want = _unhex(hashHex);
    if (got.length != want.length) return false;
    var diff = 0;
    for (var i = 0; i < got.length; i++) {
      diff |= got[i] ^ want[i];
    }
    return diff == 0;
  }

  Map<String, dynamic> toJson() => {
        'name': name,
        'email': email,
        'salt': saltHex,
        'hash': hashHex,
        'iter': iterations,
        'createdAt': createdAt.toIso8601String(),
        'suspended': suspended,
      };

  static Account? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final email = (raw['email'] ?? '').toString();
    final salt = (raw['salt'] ?? '').toString();
    final hash = (raw['hash'] ?? '').toString();
    if (email.isEmpty || salt.isEmpty || hash.isEmpty) return null;
    return Account(
      name: (raw['name'] ?? '').toString(),
      email: email,
      saltHex: salt,
      hashHex: hash,
      iterations: (raw['iter'] is int) ? raw['iter'] as int : kPbkdf2Iterations,
      createdAt:
          DateTime.tryParse((raw['createdAt'] ?? '').toString()) ?? DateTime(2026),
      suspended: raw['suspended'] == true,
    );
  }
}

class Session {
  const Session(this.email, this.expires);
  final String email;
  final DateTime expires;

  bool valid(DateTime now) => now.isBefore(expires);

  Map<String, dynamic> toJson() =>
      {'email': email, 'exp': expires.toIso8601String()};

  static Session? fromJson(Object? raw) {
    if (raw is! Map) return null;
    final e = DateTime.tryParse((raw['exp'] ?? '').toString());
    final email = (raw['email'] ?? '').toString();
    if (e == null || email.isEmpty) return null;
    return Session(email, e);
  }
}

/// What a sign-in attempt did, so the screen can say the true thing rather
/// than a single vague "login failed".
enum SignInResult { ok, wrongPassword, noSuchAccount, suspended, lockedOut }

class LockoutState {
  LockoutState({this.failures = 0, this.until});
  int failures;
  DateTime? until;

  bool isLocked(DateTime now) => until != null && now.isBefore(until!);

  Map<String, dynamic> toJson() =>
      {'failures': failures, 'until': until?.toIso8601String()};

  static LockoutState fromJson(Object? raw) {
    if (raw is! Map) return LockoutState();
    return LockoutState(
      failures: raw['failures'] is int ? raw['failures'] as int : 0,
      until: DateTime.tryParse((raw['until'] ?? '').toString()),
    );
  }
}

/// Password rules, stated once so the screen and the check cannot disagree.
String? passwordProblem(String password) {
  if (password.length < 8) return 'كلمة المرور أقصر من 8 أحرف.';
  return null;
}

String? emailProblem(String email) {
  final e = email.trim();
  if (e.isEmpty) return 'البريد مطلوب.';
  // Deliberately permissive: the only authority on whether an address works is
  // the mail server, and a clever regex mostly rejects valid addresses.
  if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(e)) {
    return 'صيغة البريد غير صحيحة.';
  }
  return null;
}
