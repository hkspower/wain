/// One place that knows how drawings are loaded, so every caller gets the same
/// `currentColor` behaviour: an icon takes the colour of the widget around it,
/// exactly as inline SVG does on the site.
library;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/colors.dart';

class WainSvg extends StatelessWidget {
  final String asset;
  final double? size;
  final double? width;
  final double? height;
  final Color color;
  final BoxFit fit;
  final AlignmentGeometry alignment;

  const WainSvg(
    this.asset, {
    super.key,
    this.size,
    this.width,
    this.height,
    this.color = WainColors.ink700,
    this.fit = BoxFit.contain,
    this.alignment = Alignment.center,
  });

  /// `icon/star` → `assets/art/icon/star.svg`.
  factory WainSvg.icon(
    String name, {
    Key? key,
    double size = 20,
    Color color = WainColors.ink700,
  }) =>
      WainSvg('assets/art/icon/$name.svg', key: key, size: size, color: color);

  @override
  Widget build(BuildContext context) {
    return SvgPicture.asset(
      asset,
      width: width ?? size,
      height: height ?? size,
      fit: fit,
      alignment: alignment,
      excludeFromSemantics: true,
      theme: SvgTheme(currentColor: color),
      placeholderBuilder: (_) =>
          SizedBox(width: width ?? size, height: height ?? size),
    );
  }
}
