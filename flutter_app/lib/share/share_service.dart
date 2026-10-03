/// Hands a message to whatever this device actually has, in order: the native
/// share sheet, then WhatsApp directly, then the clipboard — never a dead end.
/// A dismissed share sheet is a decision, not a fault, and gets its own
/// outcome so the interface stays quiet instead of reporting an error at
/// someone who changed their mind.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import 'hangout_calendar.dart';

enum ShareOutcome { shared, whatsapp, copied, cancelled, failed }

/// What «أضفها للتقويم» ended in: the file went to the share sheet, Google
/// Calendar's page opened, the sheet was backed out of, or nothing took it.
enum CalendarOutcome { file, link, cancelled, failed }

/// The three things sharing needs, behind an interface so the order of
/// fallbacks is testable without a platform channel.
abstract class ShareBackend {
  /// `null` when the platform has no share sheet; otherwise whether the user
  /// completed it (`true`) or backed out (`false`).
  Future<bool?> nativeShare(String text, String title);
  Future<bool> openWhatsApp(Uri uri);
  Future<bool> copy(String text);

  /// A file through the share sheet, same answers as [nativeShare]. Concrete
  /// with a «no sheet» default so the fakes written before it need no change.
  Future<bool?> shareFile(
    List<int> bytes,
    String name,
    String mime,
    String title,
  ) async => null;

  /// Any URL in the browser or the app that claims it.
  Future<bool> openUrl(Uri uri) => openWhatsApp(uri);
}

class PlatformShareBackend implements ShareBackend {
  const PlatformShareBackend();

  @override
  Future<bool?> shareFile(
    List<int> bytes,
    String name,
    String mime,
    String title,
  ) async {
    try {
      // `fileNameOverrides` is required: the io `XFile.fromData` ignores its
      // `name`, and without it the sheet is handed `<uuid>.ics`.
      final result = await SharePlus.instance.share(
        ShareParams(
          files: [XFile.fromData(Uint8List.fromList(bytes), mimeType: mime)],
          fileNameOverrides: [name],
          title: title,
        ),
      );
      return switch (result.status) {
        ShareResultStatus.success => true,
        ShareResultStatus.dismissed => false,
        ShareResultStatus.unavailable => null,
      };
    } catch (_) {
      return null;
    }
  }

  @override
  Future<bool> openUrl(Uri uri) => openWhatsApp(uri);

  @override
  Future<bool?> nativeShare(String text, String title) async {
    try {
      // `url` is deliberately not passed alongside `text`: several Android apps
      // then send only the URL and drop the message, which loses the time —
      // the one thing that makes this a plan rather than a link. The URL is
      // already the last line of the text.
      final result = await SharePlus.instance.share(
        ShareParams(text: text, title: title),
      );
      return switch (result.status) {
        ShareResultStatus.success => true,
        ShareResultStatus.dismissed => false,
        ShareResultStatus.unavailable => null,
      };
    } catch (_) {
      return null;
    }
  }

  @override
  Future<bool> openWhatsApp(Uri uri) async {
    try {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }

  @override
  Future<bool> copy(String text) async {
    try {
      await Clipboard.setData(ClipboardData(text: text));
      return true;
    } catch (_) {
      return false;
    }
  }
}

@visibleForTesting
ShareBackend? debugShareBackend;

/// The backend in use: the platform's, or the fake a test installed. For
/// callers outside this file (the order panel, «طلباتي»), which may not read
/// the test-only field directly.
ShareBackend get shareBackend =>
    debugShareBackend ?? const PlatformShareBackend();

Future<ShareOutcome> shareHangout({
  required String text,
  required String title,
}) async {
  final backend = debugShareBackend ?? const PlatformShareBackend();

  final native = await backend.nativeShare(text, title);
  if (native == true) return ShareOutcome.shared;
  if (native == false) return ShareOutcome.cancelled;

  final wa = Uri.parse('https://wa.me/?text=${Uri.encodeComponent(text)}');
  if (await backend.openWhatsApp(wa)) return ShareOutcome.whatsapp;

  if (await backend.copy(text)) return ShareOutcome.copied;
  return ShareOutcome.failed;
}

/// «أضفها للتقويم». Android opens Google Calendar's own page first, which
/// every phone there has an app for; iOS puts the file on the share sheet
/// first, because Apple's calendar takes a file and knows nothing of that
/// page. Each falls back to the other. Neither has been watched on a phone
/// from here: what the iOS sheet offers for an `.ics` is the thing to look at.
Future<CalendarOutcome> shareCalendar({
  required CalendarEntry entry,
  required String title,
}) async {
  final backend = debugShareBackend ?? const PlatformShareBackend();
  final bytes = utf8.encode(entry.ics);
  final google = Uri.parse(entry.google);
  final androidFirst =
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  if (androidFirst && await backend.openUrl(google))
    return CalendarOutcome.link;
  final sheet = await backend.shareFile(
    bytes,
    entry.filename,
    'text/calendar',
    title,
  );
  if (sheet == true) return CalendarOutcome.file;
  if (sheet == false) return CalendarOutcome.cancelled;
  if (!androidFirst && await backend.openUrl(google))
    return CalendarOutcome.link;
  return CalendarOutcome.failed;
}
