/// Who made this, and who owns it.
///
/// A person running a downloaded, unsigned binary has one honest question —
/// where did this come from — and until now the app answered it nowhere: the
/// window said النوخذة and nothing said المهلب كود. The same facts are in the
/// installer and in the .exe's file properties, but neither is on screen once
/// the app is open, and on macOS there is no installer at all.
///
/// Every line here is a fact stated elsewhere in the repository: the company's
/// real channels, the licence at the root, and the version in pubspec.yaml
/// (pinned to it by test/about_test.dart — a version printed here that
/// disagrees with the one that was built is worse than none).
library;

import 'package:flutter/material.dart';

import 'brand.dart';

/// Kept in step with `version:` in pubspec.yaml by test/about_test.dart.
const kAppVersion = '1.0.0';

const kOwner = 'المهلب كود — Almuhallab Code';
const kCopyright = 'حقوق النشر © 2026 المهلب كود. جميع الحقوق محفوظة.';
const kSite = 'www.almuhallab-code.com';
const kMail = 'hello@almuhallab-code.com';
const kPhone = '+965 6589 4110';

Future<void> showAboutNokhatha(BuildContext context) => showDialog<void>(
      context: context,
      builder: (context) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: Brand.bg,
          title: Row(
            children: [
              // the mark on its brown tile, as it sits on every other surface
              Container(
                padding: const EdgeInsets.all(Brand.s8),
                decoration: BoxDecoration(
                  color: Brand.tintStrong,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const BoumMark(height: 22),
              ),
              const SizedBox(width: Brand.s12),
              const Expanded(
                child: Text('النوخذة — النظام الموحد',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const _Row('المالك', kOwner),
              // LTR-isolated: a version, an address and a number are Latin runs
              // inside Arabic, and an RTL paragraph reorders them otherwise —
              // «+965 6589 4110» reads back as «4110 6589 965+».
              const _Row('الإصدار', kAppVersion, ltr: true),
              const _Row('الموقع', kSite, ltr: true),
              const _Row('البريد', kMail, ltr: true),
              const _Row('واتساب', kPhone, ltr: true),
              const SizedBox(height: Brand.s16),
              const Text(kCopyright,
                  style: TextStyle(
                      color: Brand.muted, fontSize: 12, height: 1.8)),
              const SizedBox(height: Brand.s8),
              const Text(
                'برنامج خاص — لا يجوز نسخه أو إعادة توزيعه أو اشتقاق عمل منه '
                'دون إذن كتابي. الشروط كاملة في ملف LICENSE المرفق بالتثبيت.',
                style:
                    TextStyle(color: Brand.muted, fontSize: 12, height: 1.8),
              ),
              const SizedBox(height: Brand.s8),
              const Text(
                'صُنع في الكويت. يعمل دون إنترنت، ولا يملك صلاحية شبكة أصلاً.',
                style:
                    TextStyle(color: Brand.muted, fontSize: 12, height: 1.8),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('إغلاق'),
            ),
          ],
        ),
      ),
    );

class _Row extends StatelessWidget {
  const _Row(this.label, this.value, {super.key, this.ltr = false});

  final String label;
  final String value;
  final bool ltr;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: Brand.s8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              width: 64,
              child: Text(label,
                  style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
            ),
            Expanded(
              child: Text(
                value,
                textDirection: ltr ? TextDirection.ltr : null,
                // right is the reading start here, for both: an LTR value
                // still sits where the Arabic ones do, it just reads the
                // other way inside its own box
                textAlign: TextAlign.right,
                style: const TextStyle(
                    fontSize: 13.5, fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      );
}
