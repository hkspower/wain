/// Registration and sign-in.
///
/// Every failure says what actually went wrong — wrong password, no such
/// account, locked out, and how many tries remain before the lock. A single
/// "login failed" for all of them is not security, it is just unhelpful: the
/// lockout is what defends the account, and it works whether or not the
/// message is vague.
library;

import 'package:flutter/material.dart';

import '../core/auth.dart';
import '../store.dart';
import 'about.dart';
import 'brand.dart';

class AuthGate extends StatefulWidget {
  const AuthGate({super.key, required this.store});
  final Store store;

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  bool registering = false;
  bool busy = false;
  String? error;

  final name = TextEditingController();
  final email = TextEditingController();
  final password = TextEditingController();

  @override
  void dispose() {
    name.dispose();
    email.dispose();
    password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      busy = true;
      error = null;
    });
    String? problem;
    if (registering) {
      problem = await widget.store.register(
        name: name.text,
        email: email.text,
        password: password.text,
      );
    } else {
      final r = await widget.store
          .signIn(email: email.text, password: password.text);
      problem = switch (r) {
        SignInResult.ok => null,
        SignInResult.wrongPassword => _withAttempts('كلمة المرور غير صحيحة.'),
        SignInResult.noSuchAccount => _withAttempts('لا يوجد حساب بهذا البريد.'),
        SignInResult.suspended => 'هذا الحساب موقوف — تواصل مع الدعم.',
        SignInResult.lockedOut => _lockMessage(),
      };
    }
    if (!mounted) return;
    setState(() {
      busy = false;
      error = problem;
    });
  }

  String _withAttempts(String base) {
    final left = widget.store.attemptsLeft(email.text);
    if (left <= 0) return _lockMessage();
    // Warn before the lock, not after it — being locked out with no warning
    // reads as the app breaking.
    return '$base بقيت $left محاولات قبل الإيقاف المؤقت.';
  }

  String _lockMessage() {
    final d = widget.store.lockedFor(email.text);
    final mins = ((d?.inSeconds ?? 0) / 60).ceil();
    return 'تم إيقاف المحاولات مؤقتاً — أعد المحاولة بعد $mins دقيقة.';
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Brand.bg,
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(Brand.s24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Center(child: BoumMark(height: 56, color: Brand.tintStrong)),
                  const SizedBox(height: Brand.s16),
                  const Center(
                    child: Text('النوخذة',
                        style: TextStyle(fontSize: 30, fontWeight: FontWeight.w800)),
                  ),
                  const Center(
                    child: Text('النظام الموحد من المهلب كود',
                        style: TextStyle(color: Brand.muted)),
                  ),
                  const SizedBox(height: Brand.s32),
                  if (registering)
                    Padding(
                      padding: const EdgeInsets.only(bottom: Brand.s12),
                      child: TextField(
                        controller: name,
                        decoration: const InputDecoration(
                            labelText: 'الاسم', border: OutlineInputBorder()),
                        textInputAction: TextInputAction.next,
                      ),
                    ),
                  TextField(
                    controller: email,
                    decoration: const InputDecoration(
                        labelText: 'البريد الإلكتروني',
                        border: OutlineInputBorder()),
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    textDirection: TextDirection.ltr,
                    textInputAction: TextInputAction.next,
                  ),
                  const SizedBox(height: Brand.s12),
                  TextField(
                    controller: password,
                    obscureText: true,
                    decoration: const InputDecoration(
                        labelText: 'كلمة المرور (8 أحرف فأكثر)',
                        border: OutlineInputBorder()),
                    textDirection: TextDirection.ltr,
                    onSubmitted: (_) => busy ? null : _submit(),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: Brand.s12),
                    Text(error!,
                        style: const TextStyle(color: Brand.danger, height: 1.6)),
                  ],
                  const SizedBox(height: Brand.s20),
                  FilledButton(
                    onPressed: busy ? null : _submit,
                    style: FilledButton.styleFrom(
                      backgroundColor: Brand.tintStrong,
                      padding: const EdgeInsets.symmetric(vertical: Brand.s16),
                    ),
                    child: busy
                        ? const SizedBox(
                            height: 18, width: 18,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
                        : Text(registering ? 'إنشاء الحساب' : 'تسجيل الدخول'),
                  ),
                  const SizedBox(height: Brand.s8),
                  TextButton(
                    onPressed: busy
                        ? null
                        : () => setState(() {
                              registering = !registering;
                              error = null;
                            }),
                    child: Text(registering
                        ? 'لديك حساب؟ سجّل الدخول'
                        : 'ليس لديك حساب؟ أنشئ واحداً'),
                  ),
                  const SizedBox(height: Brand.s16),
                  // Where the records sit, said plainly. A person deciding
                  // whether to type their portfolio into this deserves to know
                  // before they start, not after.
                  Text(
                    'تُحفظ سجلاتك في ملف على هذا الجهاز وحده — لا خادم ولا حساب '
                    'سحابي. كلمات المرور محفوظة كبصمة PBKDF2 ولا تُخزَّن نصاً، '
                    'أما السجلات نفسها فغير مشفَّرة: من يصل إلى القرص يقرؤها.',
                    style: const TextStyle(
                        color: Brand.muted, fontSize: 12, height: 1.8),
                  ),
                  const SizedBox(height: Brand.s16),
                  // Who made it, on the first screen — before anyone types a
                  // password into a binary they downloaded. The About dialog
                  // says the same thing, but it lives behind this gate.
                  const Text(
                    '$kOwner\n$kCopyright',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        color: Brand.muted, fontSize: 11.5, height: 1.9),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
}
