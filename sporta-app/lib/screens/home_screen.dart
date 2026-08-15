import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../l10n.dart';
import '../state/app_state.dart';
import '../theme.dart';
import '../widgets/product_card.dart';
import 'shop_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final app = context.watch<AppState>();

    return ListView(
      padding: EdgeInsets.zero,
      children: [
        // Hero
        Container(
          width: double.infinity,
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              center: Alignment(0, 1.4), radius: 1.2,
              colors: [Brand.orange, Brand.orangeDark, Brand.ink],
              stops: [0, .35, .8],
            ),
          ),
          padding: const EdgeInsets.symmetric(vertical: 64, horizontal: 24),
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 5),
                decoration: BoxDecoration(
                    color: Brand.orange, borderRadius: BorderRadius.circular(999)),
                child: Text(l.heroKicker,
                    style: const TextStyle(
                        color: Colors.white, fontSize: 11, fontWeight: FontWeight.w800)),
              ),
              const SizedBox(height: 16),
              Text('${l.heroLine1}\n${l.heroLine2}',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.displayLarge?.copyWith(
                      color: Colors.white, fontSize: 52, height: 1.05)),
              const SizedBox(height: 12),
              Text(l.heroSub,
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white70)),
              const SizedBox(height: 20),
              FilledButton(
                style: FilledButton.styleFrom(
                    backgroundColor: Colors.white, foregroundColor: Brand.ink),
                onPressed: () => Navigator.push(context,
                    MaterialPageRoute(builder: (_) => const ShopScreen())),
                child: Text(l.shopCollection),
              ),
            ],
          ),
        ),

        // Services
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(children: [
            _service(context, Icons.local_shipping_outlined, l.delivery),
            const SizedBox(width: 12),
            _service(context, Icons.refresh, l.returns),
          ]),
        ),

        // Essentials
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
          child: Text(l.essentials,
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontSize: 22)),
        ),
        if (app.loading)
          const Padding(
              padding: EdgeInsets.all(48),
              child: Center(child: CircularProgressIndicator(color: Brand.orange)))
        else
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 16),
            mainAxisSpacing: 12, crossAxisSpacing: 12, childAspectRatio: .66,
            children: app.products
                .take(4)
                .map((p) => ProductCard(product: p))
                .toList(),
          ),
        const SizedBox(height: 32),
      ],
    );
  }

  Widget _service(BuildContext c, IconData i, String label) => Expanded(
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Theme.of(c).cardTheme.color,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Column(children: [
            Icon(i, color: Brand.orange),
            const SizedBox(height: 6),
            Text(label, textAlign: TextAlign.center, style: const TextStyle(fontSize: 12)),
          ]),
        ),
      );
}
