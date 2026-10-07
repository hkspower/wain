import 'package:flutter/material.dart';

import '../data/catalogue.dart';
import '../data/categories.g.dart';
import '../data/places.g.dart';
import '../data/text_kit.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/category_chip.dart';
import '../widgets/layout.dart';
import '../widgets/place_card.dart';
import '../widgets/svg.dart';

/// Browse: a filter box, the category chips, and a two-up grid of cards.
class ExploreScreen extends StatefulWidget {
  final String? initialCategory;
  final String initialQuery;
  const ExploreScreen({
    super.key,
    this.initialCategory,
    this.initialQuery = '',
  });

  @override
  State<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends State<ExploreScreen> {
  late final _controller = TextEditingController(text: widget.initialQuery);
  late String? _category =
      kCategories.any((c) => c.id == widget.initialCategory)
      ? widget.initialCategory
      : null;

  /// The tab keeps its state now, so a new `?category=` (a category row on
  /// /search, a breadcrumb) arrives as new widget props on the SAME state —
  /// read it, or the link lands on whatever filter was there before.
  @override
  void didUpdateWidget(ExploreScreen old) {
    super.didUpdateWidget(old);
    if (widget.initialCategory != old.initialCategory) {
      _category = kCategories.any((c) => c.id == widget.initialCategory)
          ? widget.initialCategory
          : null;
    }
    if (widget.initialQuery != old.initialQuery) {
      _controller.text = widget.initialQuery;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final filtered = filterPlaces(
      kPlaces,
      category: _category,
      query: _controller.text,
    );
    final width = MediaQuery.sizeOf(context).width;
    final columns = width >= 1000 ? 4 : (width >= 640 ? 3 : 2);

    return CustomScrollView(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      slivers: [
        SliverToBoxAdapter(
          child: PageColumn(
            maxWidth: 1152,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'استكشف الكويت',
                  style: wainText(
                    WainText.s4xl,
                    weight: FontWeight.w700,
                    color: WainColors.ink900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  '${countAr(kPlaces.length, kPlacesCount)}، وما عاد فيه «ما أدري، اختر أنت».',
                  style: wainText(WainText.xs, color: WainColors.ink500),
                ),
                const SizedBox(height: 12),
                TextField(
                  onTapOutside: (_) =>
                      FocusManager.instance.primaryFocus?.unfocus(),
                  controller: _controller,
                  onChanged: (_) => setState(() {}),
                  textInputAction: TextInputAction.search,
                  style: wainText(WainText.base, color: WainColors.ink800),
                  decoration: InputDecoration(
                    hintText: 'دوّر على مكان أو منطقة…',
                    prefixIcon: Padding(
                      padding: const EdgeInsets.all(12),
                      child: WainSvg.icon(
                        'search',
                        size: 20,
                        color: WainColors.ink500,
                      ),
                    ),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(WainRadius.s2xl),
                      borderSide: const BorderSide(
                        color: WainColors.lineControl,
                      ),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(WainRadius.s2xl),
                      borderSide: const BorderSide(
                        color: WainColors.lineControl,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    CategoryChip(
                      active: _category == null,
                      onTap: () => setState(() => _category = null),
                    ),
                    for (final c in kCategories)
                      CategoryChip(
                        category: c,
                        active: _category == c.id,
                        onTap: () => setState(() => _category = c.id),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                if (filtered.isNotEmpty)
                  Text(
                    countAr(filtered.length, kResultsCount),
                    style: wainText(
                      WainText.xs,
                      weight: FontWeight.w600,
                      color: WainColors.ink500,
                    ),
                  ),
              ],
            ),
          ),
        ),
        if (filtered.isNotEmpty)
          SliverPadding(
            padding: EdgeInsets.symmetric(
              horizontal: width >= 640 ? 16 : 10,
              vertical: 6,
            ),
            sliver: SliverGrid.builder(
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: columns,
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                mainAxisExtent: placeCardExtent(context),
              ),
              itemCount: filtered.length,
              itemBuilder: (_, i) =>
                  PlaceCard(place: filtered[i], shareable: true),
            ),
          )
        else
          SliverToBoxAdapter(
            child: PageColumn(
              child: EmptyState(
                title: 'ما لقينا شي',
                body: 'جرّب بحث ثاني أو تصنيف ثاني — الكويت فيها وايد.',
                action: FilledButton(
                  onPressed: () => setState(() {
                    _controller.clear();
                    _category = null;
                  }),
                  style: FilledButton.styleFrom(
                    backgroundColor: WainColors.ink900,
                  ),
                  child: const Text('امسح الفلاتر'),
                ),
              ),
            ),
          ),
        const SliverToBoxAdapter(child: SizedBox(height: 24)),
      ],
    );
  }
}
