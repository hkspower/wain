/// Hands a message to whatever this device actually has, in order: the native
/// share sheet, then WhatsApp directly, then the clipboard — never a dead end.
/// A dismissed share sheet is a decision, not a fault, and gets its own
/// outcome so the interface stays quiet instead of reporting an error at
/// someone who changed their mind.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

enum ShareOutcome { shared, whatsapp, copied, cancelled, failed }

/// The three things sharing needs, behind an interface so the order of
/// fallbacks is testable without a platform channel.
abstract class ShareBackend {
  /// `null` when the platform has no share sheet; otherwise whether the user
  /// completed it (`true`) or backed out (`false`).
  Future<bool?> nativeShare(String text, String title);
  Future<bool> openWhatsApp(Uri uri);
  Future<bool> copy(String text);
}

class PlatformShareBackend implements ShareBackend {
  const PlatformShareBackend();

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
