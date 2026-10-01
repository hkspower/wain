/// The one-time question before a conversation with شوق or سالم starts.
///
/// Her agent records calls and keeps calls and typed chats with no expiry
/// (`AiPrivacyCopy`), and Apple's and Google's rules both ask for a clear
/// disclosure BEFORE personal data goes to a third-party AI service — not a
/// page somebody may never open. So the first call and the first chat each
/// pass through here, and the answer is remembered (`AppState.aiConsent`).
///
/// It runs BEFORE the microphone prompt on purpose: the system's own dialog
/// says nothing about where the audio goes, and asking for the microphone
/// first would have the visitor agree to the less important question.
library;

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../app/app_state.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import 'config.dart';

/// True when the visitor has agreed — now or before. False leaves everything
/// else in the app working; only the conversation does not start.
Future<bool> ensureAiConsent(BuildContext context) async {
  final state = context.read<AppState>();
  if (state.aiConsent) return true;
  final agreed = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: WainColors.sand50,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (_) => const AiConsentSheet(),
  );
  if (agreed != true) return false;
  state.setAiConsent(true);
  return true;
}

class AiConsentSheet extends StatelessWidget {
  const AiConsentSheet({super.key});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(
              header: true,
              child: Text(
                AiPrivacyCopy.consentTitle,
                style: wainText(
                  WainText.lg,
                  weight: FontWeight.w700,
                  color: WainColors.ink900,
                ),
              ),
            ),
            const SizedBox(height: 10),
            Text(
              AiPrivacyCopy.consentBody,
              style: wainText(
                WainText.sm,
                color: WainColors.ink600,
                height: 1.75,
              ),
            ),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton(
                key: const ValueKey('ai-consent-details'),
                onPressed: () {
                  // Close the question first: a details page opened over an
                  // unanswered modal leaves the answer hanging behind it.
                  final router = GoRouter.of(context);
                  Navigator.of(context).pop(false);
                  router.push('/privacy');
                },
                child: Text(
                  AiPrivacyCopy.details,
                  style: wainText(
                    WainText.sm,
                    weight: FontWeight.w600,
                    color: WainColors.sea700,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            FilledButton(
              key: const ValueKey('ai-consent-agree'),
              onPressed: () => Navigator.of(context).pop(true),
              style: FilledButton.styleFrom(
                backgroundColor: WainColors.sea600,
                minimumSize: const Size.fromHeight(48),
              ),
              child: Text(
                AiPrivacyCopy.agree,
                style: wainText(
                  WainText.base,
                  weight: FontWeight.w600,
                  color: Colors.white,
                ),
              ),
            ),
            const SizedBox(height: 4),
            TextButton(
              key: const ValueKey('ai-consent-decline'),
              onPressed: () => Navigator.of(context).pop(false),
              style: TextButton.styleFrom(
                minimumSize: const Size.fromHeight(44),
              ),
              child: Text(
                AiPrivacyCopy.notNow,
                style: wainText(WainText.base, color: WainColors.ink700),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
