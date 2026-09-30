import 'package:flutter/material.dart';

import '../data/models.dart';
import '../theme/colors.dart';
import 'layout.dart';
import 'svg.dart';

/// A category filter chip with its icon, as on /explore.
class CategoryChip extends StatelessWidget {
  final Category? category; // null = «الكل»
  final bool active;
  final VoidCallback onTap;
  const CategoryChip({
    super.key,
    this.category,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return WainChip(
      label: category?.ar ?? 'الكل',
      active: active,
      onTap: onTap,
      leading: WainSvg(
        'assets/art/cat-icon/${category?.icon ?? 'all'}.svg',
        size: 16,
        color: active ? Colors.white : WainColors.ink600,
      ),
    );
  }
}
