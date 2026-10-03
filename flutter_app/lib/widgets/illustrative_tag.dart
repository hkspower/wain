import 'package:flutter/material.dart';

import '../theme/app_theme.dart';
import '../theme/colors.dart';

/// «صورة توضيحية» — the mark every generated picture of a landmark carries, as
/// on the web (IllustrativeTag.tsx).
///
/// A generated picture is a picture OF a place, not a photograph of it, and the
/// app says so wherever one is shown: on the slideshow, on a card and at the
/// top of a place page. The owner picked this style on the 3 October canvas
/// (T1): a solid dark chip with white text, which reads the same over a bright
/// sky and a night scene.
///
/// Out of the semantics tree, because where it appears the picture is
/// decorative (the card or the slide already names the place) or its label
/// already says it in words. Placed by the caller.
class IllustrativeTag extends StatelessWidget {
  const IllustrativeTag({super.key});

  static const String text = 'صورة توضيحية';

  @override
  Widget build(BuildContext context) {
    return ExcludeSemantics(
      child: IgnorePointer(
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: WainColors.ink900,
            borderRadius: BorderRadius.circular(999),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
            child: Text(
              text,
              maxLines: 1,
              softWrap: false,
              style: wainText(
                WainText.s2xs,
                weight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
