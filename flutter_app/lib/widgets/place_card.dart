import 'package:flutter/material.dart';

import '../data/models.dart';
import '../data/text_kit.dart';
import '../theme/colors.dart';

/// The card used everywhere a place is listed — explore results, "أماكن
/// مشابهة" on a place page (once that exists). One shape, matching
/// `PlaceCard.tsx`'s reason for existing on the web: a second ad-hoc card is
/// how the same information drifts to look different in two places.
class PlaceCard extends StatelessWidget {
  final Place place;
  final VoidCallback onTap;

  const PlaceCard({super.key, required this.place, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final gradient = WainColors.categoryGradients[place.category] ??
        [WainColors.sand600, WainColors.sand700];
    return Card(
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              width: 84,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: gradient,
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              alignment: Alignment.center,
              child: Text(place.emoji, style: const TextStyle(fontSize: 32)),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      place.nameAr,
                      style: Theme.of(context).textTheme.titleMedium,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      place.taglineAr,
                      style: Theme.of(context).textTheme.bodySmall,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Text(place.areaAr, style: Theme.of(context).textTheme.labelSmall),
                        if (place.rating != null) ...[
                          const SizedBox(width: 8),
                          const Icon(Icons.star, size: 14, color: WainColors.sun500),
                          const SizedBox(width: 2),
                          Text(
                            toArabicDigits(place.rating!.toStringAsFixed(1)).replaceAll('.', '٫'),
                            style: Theme.of(context).textTheme.labelSmall,
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
