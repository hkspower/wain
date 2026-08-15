import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../l10n.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/product_card.dart';

class ShopScreen extends StatefulWidget {
  const ShopScreen({super.key});
  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen> {
  String cat = 'all';

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final app = context.watch<AppState>();
    final cats = <String, String>{
      'all': l.all,
      'women': l.isAr ? 'نساء' : 'Women',
      'men': l.isAr ? 'رجال' : 'Men',
      'outerwear': l.isAr ? 'هوديز وجواكيت' : 'Hoodies & Jackets',
      'accessories': l.isAr ? 'إكسسوارات' : 'Accessories',
    };
    final list = cat == 'all'
        ? app.products
        : app.products.where((p) => p.category == cat).toList();

    return Scaffold(
      appBar: AppBar(title: Text(l.shop)),
      body: app.loading
          ? const Center(child: CircularProgressIndicator(color: Brand.orange))
          : Column(
              children: [
                SizedBox(
                  height: 56,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    children: cats.entries.map((e) {
                      final on = cat == e.key;
                      return Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 4),
                        child: ChoiceChip(
                          label: Text(e.value),
                          selected: on,
                          onSelected: (_) => setState(() => cat = e.key),
                          selectedColor: Brand.orange,
                          labelStyle: TextStyle(
                              color: on ? Colors.white : null,
                              fontWeight: FontWeight.w600),
                        ),
                      );
                    }).toList(),
                  ),
                ),
                Expanded(
                  child: GridView.count(
                    crossAxisCount: 2,
                    padding: const EdgeInsets.all(16),
                    mainAxisSpacing: 12, crossAxisSpacing: 12, childAspectRatio: .66,
                    children: list.map((p) => ProductCard(product: p)).toList(),
                  ),
                ),
              ],
            ),
    );
  }
}
