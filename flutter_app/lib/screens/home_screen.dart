import 'package:flutter/material.dart';

import '../data/categories.g.dart';
import '../data/places.g.dart';
import '../theme/colors.dart';
import '../theme/icons.dart';
import '../widgets/place_card.dart';
import 'explore_screen.dart';
import 'place_detail_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final featured = kPlaces.where((p) => p.featured).toList();
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
          children: [
            Text('وين', style: Theme.of(context).textTheme.headlineMedium),
            const SizedBox(height: 4),
            Text(
              'دليلك في الكويت',
              style: Theme.of(context)
                  .textTheme
                  .bodyMedium
                  ?.copyWith(color: WainColors.ink500),
            ),
            const SizedBox(height: 20),
            _SearchEntry(
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const ExploreScreen()),
              ),
            ),
            const SizedBox(height: 24),
            Text('شنو تدوّر؟', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            SizedBox(
              height: 108,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: kCategories.length,
                separatorBuilder: (_, _) => const SizedBox(width: 10),
                itemBuilder: (context, i) {
                  final c = kCategories[i];
                  final gradient = WainColors.categoryGradients[c.id] ??
                      [WainColors.sand600, WainColors.sand700];
                  return GestureDetector(
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => ExploreScreen(initialCategory: c.id),
                      ),
                    ),
                    child: Container(
                      width: 84,
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        gradient: LinearGradient(
                          colors: gradient,
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(categoryIconData(c.icon), color: Colors.white, size: 22),
                          const SizedBox(height: 6),
                          Text(
                            c.ar,
                            textAlign: TextAlign.center,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                              height: 1.15,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 24),
            Text('أماكن مميزة', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            ...featured.map(
              (place) => Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: SizedBox(
                  height: 108,
                  child: PlaceCard(
                    place: place,
                    onTap: () => Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => PlaceDetailScreen(place: place),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SearchEntry extends StatelessWidget {
  final VoidCallback onTap;
  const _SearchEntry({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: WainColors.sand100,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: const Padding(
          padding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
          child: Row(
            children: [
              Icon(Icons.search, color: WainColors.ink500),
              SizedBox(width: 12),
              Text('دوّر باسم المكان أو الحي...'),
            ],
          ),
        ),
      ),
    );
  }
}
