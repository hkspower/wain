import 'package:flutter/material.dart';

import '../data/models.dart';
import '../theme/colors.dart';
import '../theme/icons.dart';

class CategoryChip extends StatelessWidget {
  final Category category;
  final bool selected;
  final VoidCallback onTap;

  const CategoryChip({
    super.key,
    required this.category,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final gradient = WainColors.categoryGradients[category.id] ??
        [WainColors.sand600, WainColors.sand700];
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          gradient: selected
              ? LinearGradient(colors: gradient)
              : null,
          color: selected ? null : WainColors.sand100,
          border: Border.all(
            color: selected ? Colors.transparent : WainColors.sand200,
          ),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              categoryIconData(category.icon),
              size: 16,
              color: selected ? Colors.white : WainColors.ink600,
            ),
            const SizedBox(width: 6),
            Text(
              category.ar,
              style: TextStyle(
                color: selected ? Colors.white : WainColors.ink700,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
