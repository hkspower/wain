// Host side of `flutter drive`: runs on the CI Mac, not on the simulator, and
// writes each `binding.takeScreenshot(name)` from integration_test/ to
// $SHOTS_DIR/<name>.png so the workflow can upload them.
import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  final dir = Directory(Platform.environment['SHOTS_DIR'] ?? 'build/shots');
  await dir.create(recursive: true);
  await integrationDriver(
    onScreenshot: (name, bytes, [args]) async {
      await File('${dir.path}/$name.png').writeAsBytes(bytes);
      return true;
    },
  );
}
