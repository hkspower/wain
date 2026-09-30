import 'package:flutter/material.dart';

import '../data/categories.g.dart';
import '../data/models.dart';
import '../data/places.g.dart';
import '../data/search.dart';
import '../data/text_kit.dart';
import '../theme/colors.dart';
import '../widgets/category_chip.dart';
import '../widgets/place_card.dart';
import 'place_detail_screen.dart';

/// The single search/browse surface, mirroring /search's own reasoning: one
/// place to filter by category and free text, rather than a category rail
/// on one screen and a search box on another that can silently disagree.
class ExploreScreen extends StatefulWidget {
  final String? initialCategory;

  const ExploreScreen({super.key, this.initialCategory});

  @override
  State<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends State<ExploreScreen> {
  String? _category;
  String _query = '';
  final _controller = TextEditingController();

  @override
  void initState() {
    super.initState();
    _category = widget.initialCategory;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final results = filterPlaces(kPlaces, category: _category, query: _query);
    return Scaffold(
      appBar: AppBar(title: const Text('دوّر')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              controller: _controller,
              onChanged: (v) => setState(() => _query = v),
              textDirection: TextDirection.rtl,
              decoration: InputDecoration(
                hintText: 'دوّر باسم المكان أو الحي...',
                prefixIcon: const Icon(Icons.search),
                filled: true,
                fillColor: WainColors.sand100,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
          ),
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: CategoryChip(
                    category: const Category(
                      id: '',
                      ar: 'الكل',
                      en: 'All',
                      icon: 'bag',
                      blurbAr: '',
                    ),
                    selected: _category == null,
                    onTap: () => setState(() => _category = null),
                  ),
                ),
                for (final c in kCategories)
                  Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: CategoryChip(
                      category: c,
                      selected: _category == c.id,
                      onTap: () => setState(
                        () => _category = _category == c.id ? null : c.id,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
            child: Align(
              alignment: Alignment.centerRight,
              child: Text(
                countAr(results.length, kResultsCount),
                style: Theme.of(context)
                    .textTheme
                    .labelMedium
                    ?.copyWith(color: WainColors.ink500),
              ),
            ),
          ),
          Expanded(
            child: results.isEmpty
                ? const Center(child: Text('ما لقينا شي.'))
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
                    itemCount: results.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (context, i) {
                      final place = results[i];
                      return SizedBox(
                        height: 108,
                        child: PlaceCard(
                          place: place,
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => PlaceDetailScreen(place: place),
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}
