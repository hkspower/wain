/// Where النوخذة's records actually live on this machine.
///
/// One JSON file in the app's own support directory — on Windows that is
/// %APPDATA%\com.almuhallab\nokhatha\nokhatha.json. Two decisions worth
/// stating, because they are the ones a customer would want to know:
///
///   * it is a plain, readable file, not an opaque database. A person can open
///     it, copy it to another machine, or delete it, without asking us;
///   * it is NOT encrypted. Password hashes are (PBKDF2), but the records are
///     not, so anyone with the disk can read the holdings. The app says so on
///     screen rather than letting a customer assume otherwise.
///
/// Writes are atomic: a temporary file, then a rename. A half-written JSON
/// file after a power cut is indistinguishable from corruption, and would take
/// the whole account with it.
library;

import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// The storage contract. A widget test cannot use the real one: `testWidgets`
/// runs inside a fake-async zone, and awaiting a genuine dart:io write there
/// never completes — the test simply hangs. Tests substitute an in-memory
/// implementation; the disk behaviour is covered by the plain `test()` suite,
/// where real async actually runs.
abstract class VaultStore {
  Future<Map<String, dynamic>> read();
  Future<void> write(Map<String, dynamic> data);
  Future<String> location();
}

class Vault implements VaultStore {
  Vault({this.overridePath});

  /// Tests pass a temp path; the app leaves it null and uses the OS location.
  final String? overridePath;

  File? _file;

  Future<File> _open() async {
    if (_file != null) return _file!;
    final dir = overridePath != null
        ? Directory(overridePath!)
        : await getApplicationSupportDirectory();
    if (!dir.existsSync()) dir.createSync(recursive: true);
    return _file = File('${dir.path}${Platform.pathSeparator}nokhatha.json');
  }

  /// The file's own location, so the app can show a person where their records
  /// are instead of making them guess.
  @override
  Future<String> location() async => (await _open()).path;

  @override
  Future<Map<String, dynamic>> read() async {
    final f = await _open();
    if (!f.existsSync()) return {};
    try {
      final decoded = jsonDecode(await f.readAsString());
      return decoded is Map<String, dynamic> ? decoded : {};
    } on FormatException {
      // A corrupt file must not take the app down with it. Keep the damaged
      // copy beside the original — deleting the only trace of someone's
      // records is not ours to do — and start clean.
      final broken = File('${f.path}.corrupt');
      try {
        await f.copy(broken.path);
      } on FileSystemException {
        // If even that fails there is nothing further to try; still start.
      }
      return {};
    } on FileSystemException {
      return {};
    }
  }

  @override
  Future<void> write(Map<String, dynamic> data) async {
    final f = await _open();
    final tmp = File('${f.path}.tmp');
    await tmp.writeAsString(const JsonEncoder.withIndent('  ').convert(data),
        flush: true);
    await tmp.rename(f.path); // atomic on the same volume
  }
}
