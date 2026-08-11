/// Auth and persistence tests.
///
/// A wrong KDF still produces convincing hex, a broken lockout still lets
/// people log in, and a non-atomic write only fails during a power cut. None
/// of these announce themselves — which is precisely why they are tested.
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:nokhatha/core/auth.dart';
import 'package:nokhatha/core/vault.dart';
import 'package:nokhatha/store.dart';

String hex(List<int> b) =>
    b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();

void main() {
  group('PBKDF2-HMAC-SHA256', () {
    test('matches a published vector', () {
      // RFC 7914 §11 states this PBKDF2-HMAC-SHA256 vector:
      //   P = "passwd", S = "salt", c = 1, dkLen = 64
      final out = pbkdf2(
        password: 'passwd',
        salt: Uint8List.fromList(utf8.encode('salt')),
        iterations: 1,
        length: 64,
      );
      expect(
        hex(out),
        '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc'
        '49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
      );
    });

    test('matches a second vector, at a higher iteration count', () {
      // RFC 7914 §11: P = "Password", S = "NaCl", c = 80000, dkLen = 64
      final out = pbkdf2(
        password: 'Password',
        salt: Uint8List.fromList(utf8.encode('NaCl')),
        iterations: 80000,
        length: 64,
      );
      expect(
        hex(out),
        '4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56'
        'a1d425a1225833549adb841b51c9b3176a272bdebba1d078478f62b397f33c8d',
      );
    });

    test('the iteration count is the OWASP figure, not a convenient one', () {
      expect(kPbkdf2Iterations, 310000);
    });
  });

  group('accounts', () {
    test('the password is never stored, in any form', () {
      final a = Account.create(
          name: 'محمد', email: 'A@Example.com ', password: 'correct-horse-2026');
      final blob = jsonEncode(a.toJson());
      expect(blob.contains('correct-horse-2026'), isFalse);
      expect(a.hashHex.length, kHashBytes * 2);
      expect(a.saltHex.length, kSaltBytes * 2);
    });

    test('the email is normalised, so one person is one account', () {
      final a = Account.create(
          name: 'x', email: '  A@Example.COM ', password: 'correct-horse-2026');
      expect(a.email, 'a@example.com');
    });

    test('two accounts with the same password get different hashes', () {
      final a = Account.create(name: 'a', email: 'a@b.c', password: 'same-password-1');
      final b = Account.create(name: 'b', email: 'b@b.c', password: 'same-password-1');
      expect(a.hashHex, isNot(b.hashHex)); // the salt is doing its job
    });

    test('the right password verifies and a wrong one does not', () {
      final a = Account.create(name: 'x', email: 'a@b.c', password: 'correct-horse-2026');
      expect(a.verify('correct-horse-2026'), isTrue);
      expect(a.verify('correct-horse-2025'), isFalse);
      expect(a.verify(''), isFalse);
    });

    test('a stored account survives a round trip', () {
      final a = Account.create(name: 'x', email: 'a@b.c', password: 'correct-horse-2026');
      final b = Account.fromJson(jsonDecode(jsonEncode(a.toJson())))!;
      expect(b.verify('correct-horse-2026'), isTrue);
      expect(b.email, a.email);
      expect(b.iterations, a.iterations);
    });

    test('a tampered record is refused rather than trusted', () {
      expect(Account.fromJson({'email': 'a@b.c'}), isNull); // no hash
      expect(Account.fromJson('not a map'), isNull);
      expect(Account.fromJson({'email': '', 'salt': 'aa', 'hash': 'bb'}), isNull);
    });
  });

  group('sessions and lockout', () {
    test('a session expires on its own, signed out or not', () {
      final now = DateTime(2026, 8, 10, 12);
      final s = Session('a@b.c', now.add(kSessionTtl));
      expect(s.valid(now), isTrue);
      expect(s.valid(now.add(const Duration(hours: 23, minutes: 59))), isTrue);
      expect(s.valid(now.add(const Duration(hours: 24, minutes: 1))), isFalse);
    });

    test('the session TTL is 24 hours, as the web build promises', () {
      expect(kSessionTtl, const Duration(hours: 24));
    });

    test('repeated failures lock the account, and the lock expires', () {
      final now = DateTime(2026, 8, 10, 12);
      final l = LockoutState();
      for (var i = 0; i < kMaxAttempts; i++) {
        l.failures++;
      }
      l.until = now.add(kLockout);
      expect(l.isLocked(now), isTrue);
      expect(l.isLocked(now.add(const Duration(minutes: 14))), isTrue);
      expect(l.isLocked(now.add(const Duration(minutes: 16))), isFalse);
    });

    test('a stored lockout survives a restart — otherwise it is no lockout',
        () {
      final now = DateTime(2026, 8, 10, 12);
      final l = LockoutState(failures: 5, until: now.add(kLockout));
      final back = LockoutState.fromJson(jsonDecode(jsonEncode(l.toJson())));
      expect(back.failures, 5);
      expect(back.isLocked(now), isTrue);
    });
  });

  group('input rules', () {
    test('a short password is refused with a reason', () {
      expect(passwordProblem('short'), isNotNull);
      expect(passwordProblem('12345678'), isNull);
    });

    test('the email check rejects the obviously broken, not the unusual', () {
      expect(emailProblem(''), isNotNull);
      expect(emailProblem('no-at-sign'), isNotNull);
      expect(emailProblem('a@b'), isNotNull);
      expect(emailProblem('a@b.c'), isNull);
      // Valid but unusual addresses must still be accepted.
      expect(emailProblem("o'brien+tag@sub.domain.co.uk"), isNull);
    });
  });

  group('the vault', () {
    late Directory tmp;
    setUp(() => tmp = Directory.systemTemp.createTempSync('nokhatha-test'));
    tearDown(() => tmp.deleteSync(recursive: true));

    test('records survive a write and a read', () async {
      final v = Vault(overridePath: tmp.path);
      await v.write({'holdings': [{'ticker': 'NBK'}], 'n': 3});
      expect((await v.read())['n'], 3);
      expect(((await v.read())['holdings'] as List).length, 1);
    });

    test('an empty vault reads as empty, not as an error', () async {
      expect(await Vault(overridePath: tmp.path).read(), isEmpty);
    });

    test('a corrupt file does not take the app down, and is kept', () async {
      final v = Vault(overridePath: tmp.path);
      await v.write({'a': 1});
      File(await v.location()).writeAsStringSync('{not json at all');
      expect(await v.read(), isEmpty); // starts clean instead of crashing
      expect(File('${await v.location()}.corrupt').existsSync(), isTrue,
          reason: 'the damaged copy must be kept, not silently destroyed');
    });

    test('no half-written file is left behind', () async {
      final v = Vault(overridePath: tmp.path);
      await v.write({'a': 1});
      final leftovers = tmp
          .listSync()
          .where((f) => f.path.endsWith('.tmp'))
          .toList();
      expect(leftovers, isEmpty, reason: 'the temp file must be renamed, not left');
    });
  });

  group('a restart', () {
    late Directory tmp;
    setUp(() => tmp = Directory.systemTemp.createTempSync('nokhatha-restart'));
    tearDown(() => tmp.deleteSync(recursive: true));

    // These live here rather than in the widget tests on purpose: real dart:io
    // never completes inside testWidgets' fake-async zone, so a disk assertion
    // there would hang rather than fail.
    test('records typed in survive closing and reopening the app', () async {
      final a = Store(vault: Vault(overridePath: tmp.path));
      await a.load();
      await a.register(name: 'م', email: 'a@b.c', password: 'correct-horse-2026');
      await a.addOrder(customer: 'خالد', phone: '65894110', amountFils: 12500);

      final b = Store(vault: Vault(overridePath: tmp.path));
      await b.load();
      expect(b.orders.length, 1);
      expect(b.orders.first.customer, 'خالد');
      expect(b.orders.first.amountFils, 12500);
      expect(b.orders.first.id, 'ORD-0001');
      // the session came back too, so a restart is not a re-login
      expect(b.signedIn, isTrue);
    });

    test('signing out ends the session on disk, not just on screen', () async {
      final a = Store(vault: Vault(overridePath: tmp.path));
      await a.load();
      await a.register(name: 'م', email: 'a@b.c', password: 'correct-horse-2026');
      await a.signOut();

      final b = Store(vault: Vault(overridePath: tmp.path));
      await b.load();
      expect(b.signedIn, isFalse);
      // but the account is still there to sign back into
      expect(await b.signIn(email: 'a@b.c', password: 'correct-horse-2026'),
          SignInResult.ok);
      expect(b.signedIn, isTrue);
    });

    test('the lockout survives a restart — otherwise closing the app clears it',
        () async {
      final a = Store(vault: Vault(overridePath: tmp.path));
      await a.load();
      await a.register(name: 'م', email: 'a@b.c', password: 'correct-horse-2026');
      await a.signOut();
      for (var i = 0; i < kMaxAttempts; i++) {
        await a.signIn(email: 'a@b.c', password: 'wrong-password-x');
      }

      final b = Store(vault: Vault(overridePath: tmp.path));
      await b.load();
      expect(await b.signIn(email: 'a@b.c', password: 'correct-horse-2026'),
          SignInResult.lockedOut,
          reason: 'a lockout a restart clears is not a lockout');
    });
  });
}
