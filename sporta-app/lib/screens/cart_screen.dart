import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../l10n.dart';
import '../state/app_state.dart';
import '../theme.dart';
import 'checkout_screen.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final app = context.watch<AppState>();

    return Scaffold(
      appBar: AppBar(title: Text(l.bag)),
      body: app.cart.isEmpty
          ? Center(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Icon(Icons.shopping_bag_outlined, size: 64, color: Theme.of(context).hintColor),
                const SizedBox(height: 12),
                Text(l.emptyBag, style: TextStyle(color: Theme.of(context).hintColor)),
                const SizedBox(height: 16),
                FilledButton(
                    onPressed: () => Navigator.pop(context), child: Text(l.backToShop)),
              ]),
            )
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: app.cart.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (_, idx) {
                final i = app.cart[idx];
                return Card(
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Image.network(i.image,
                            width: 64, height: 64, fit: BoxFit.cover,
                            errorBuilder: (_, __, ___) =>
                                Container(width: 64, height: 64, color: Brand.inkSoft)),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(i.name[l.lang] ?? '',
                                maxLines: 1, overflow: TextOverflow.ellipsis,
                                style: const TextStyle(fontWeight: FontWeight.w700)),
                            Text(
                                '${l.kwd(i.price)}${i.size != null ? ' · ${i.size}' : ''}',
                                style: TextStyle(
                                    fontSize: 12, color: Theme.of(context).hintColor)),
                            const SizedBox(height: 6),
                            Row(children: [
                              _step(context, Icons.remove,
                                  () => app.setQty(i.key, i.qty - 1)),
                              Padding(
                                padding: const EdgeInsets.symmetric(horizontal: 10),
                                child: Text('${i.qty}',
                                    style: const TextStyle(fontWeight: FontWeight.w700)),
                              ),
                              _step(context, Icons.add, () => app.setQty(i.key, i.qty + 1)),
                            ]),
                          ],
                        ),
                      ),
                      Text(l.kwd(i.lineTotal),
                          style: const TextStyle(
                              fontWeight: FontWeight.w800, color: Brand.orangeDark)),
                    ]),
                  ),
                );
              },
            ),
      bottomNavigationBar: app.cart.isEmpty
          ? null
          : SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    Text(l.total,
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                    Text(l.kwd(app.total),
                        style: const TextStyle(
                            fontSize: 18, fontWeight: FontWeight.w800, color: Brand.orangeDark)),
                  ]),
                  const SizedBox(height: 12),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton(
                      onPressed: () => Navigator.push(context,
                          MaterialPageRoute(builder: (_) => const CheckoutScreen())),
                      child: Text(l.checkout),
                    ),
                  ),
                ]),
              ),
            ),
    );
  }

  Widget _step(BuildContext c, IconData i, VoidCallback f) => InkWell(
        onTap: f,
        child: Container(
          padding: const EdgeInsets.all(4),
          decoration: BoxDecoration(
              border: Border.all(color: Theme.of(c).dividerColor),
              borderRadius: BorderRadius.circular(999)),
          child: Icon(i, size: 14),
        ),
      );
}
