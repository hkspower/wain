import 'package:flutter/material.dart';

import '../data/models.dart';
import '../data/text_kit.dart';
import '../theme/colors.dart';

class PlaceDetailScreen extends StatelessWidget {
  final Place place;

  const PlaceDetailScreen({super.key, required this.place});

  @override
  Widget build(BuildContext context) {
    final gradient = WainColors.categoryGradients[place.category] ??
        [WainColors.sand600, WainColors.sand700];
    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            expandedHeight: 200,
            pinned: true,
            flexibleSpace: FlexibleSpaceBar(
              background: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: gradient,
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
                alignment: Alignment.center,
                child: Text(place.emoji, style: const TextStyle(fontSize: 64)),
              ),
            ),
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(place.nameAr, style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(Icons.place, size: 16, color: WainColors.ink500),
                      const SizedBox(width: 4),
                      Text(place.areaAr, style: Theme.of(context).textTheme.bodyMedium),
                      if (place.rating != null) ...[
                        const SizedBox(width: 16),
                        const Icon(Icons.star, size: 16, color: WainColors.sun500),
                        const SizedBox(width: 4),
                        Text(
                          toArabicDigits(place.rating!.toStringAsFixed(1)).replaceAll('.', '٫'),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 16),
                  Text(place.taglineAr, style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 12),
                  Text(place.descriptionAr, style: Theme.of(context).textTheme.bodyLarge),
                  const SizedBox(height: 20),
                  if (place.highlightsAr.isNotEmpty) ...[
                    Text('أبرز الأشياء', style: Theme.of(context).textTheme.titleSmall),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: place.highlightsAr
                          .map((h) => Chip(label: Text(h)))
                          .toList(),
                    ),
                    const SizedBox(height: 20),
                  ],
                  Text('أحسن وقت', style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: 4),
                  Text(place.bestTimeAr),
                  const SizedBox(height: 16),
                  Text('الموسم', style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: 4),
                  Text(place.seasonAr),
                  if (place.tagsAr.isNotEmpty) ...[
                    const SizedBox(height: 20),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: place.tagsAr
                          .map((t) => Chip(
                                label: Text(t, style: const TextStyle(fontSize: 11)),
                                backgroundColor: WainColors.sand100,
                                padding: EdgeInsets.zero,
                                visualDensity: VisualDensity.compact,
                              ))
                          .toList(),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
