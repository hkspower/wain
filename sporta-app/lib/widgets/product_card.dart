import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../l10n.dart';
import '../models/product.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../screens/product_screen.dart';

class ProductCard extends StatelessWidget {
  final Product product;
  const ProductCard({super.key, required this.product});

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final app = context.watch<AppState>();
    final fav = app.wishlist.contains(product.slug);

    return Card(
      child: InkWell(
        onTap: () => Navigator.push(context,
            MaterialPageRoute(builder: (_) => ProductScreen(product: product))),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Stack(
              children: [
                AspectRatio(
                  aspectRatio: 1,
                  child: Image.network(product.image, fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) =>
                          Container(color: Brand.inkSoft)),
                ),
                if (product.badge != null)
                  Positioned(
                    top: 10, left: 10,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                          color: Brand.orange,
                          borderRadius: BorderRadius.circular(999)),
                      child: Text(product.badge![l.lang] ?? '',
                          style: const TextStyle(
                              color: Colors.white, fontSize: 10,
                              fontWeight: FontWeight.w800)),
                    ),
                  ),
                Positioned(
                  top: 6, right: 6,
                  child: IconButton(
                    icon: Icon(fav ? Icons.favorite : Icons.favorite_border,
                        color: fav ? Brand.orange : Colors.white70, size: 20),
                    onPressed: () => context.read<AppState>().toggleWish(product.slug),
                    tooltip: 'Wishlist',
                  ),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(product.nameIn(l.lang),
                      maxLines: 1, overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 2),
                  Text(product.descIn(l.lang),
                      maxLines: 1, overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 12,
                          color: Theme.of(context).hintColor)),
                  const SizedBox(height: 10),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Flexible(
                        child: Text(l.kwd(product.price),
                            maxLines: 1, overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                                fontWeight: FontWeight.w800,
                                color: Brand.orangeDark)),
                      ),
                      if (product.sizes == null)
                        FilledButton(
                          style: FilledButton.styleFrom(
                              minimumSize: const Size(0, 34),
                              padding: const EdgeInsets.symmetric(horizontal: 14)),
                          onPressed: () => context.read<AppState>().add(product),
                          child: Text(l.add, style: const TextStyle(fontSize: 12)),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
