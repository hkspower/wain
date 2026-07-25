import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../l10n.dart';
import '../models/product.dart';
import '../state/app_state.dart';
import '../theme.dart';
import 'cart_screen.dart';

class ProductScreen extends StatefulWidget {
  final Product product;
  const ProductScreen({super.key, required this.product});
  @override
  State<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends State<ProductScreen> {
  String? size;
  bool sizeErr = false;
  int qty = 1;

  bool _ensureSize() {
    if (widget.product.sizes != null && size == null) {
      setState(() => sizeErr = true);
      return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final p = widget.product;

    return Scaffold(
      appBar: AppBar(title: Text(p.nameIn(l.lang), maxLines: 1)),
      body: ListView(
        children: [
          AspectRatio(
            aspectRatio: 1,
            child: Image.network(p.image, fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Container(color: Brand.inkSoft)),
          ),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(p.nameIn(l.lang),
                    style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontSize: 24)),
                const SizedBox(height: 8),
                Text(p.descIn(l.lang), style: TextStyle(color: Theme.of(context).hintColor)),
                const SizedBox(height: 16),
                Text(l.kwd(p.price),
                    style: const TextStyle(
                        fontSize: 22, fontWeight: FontWeight.w800, color: Brand.orangeDark)),

                if (p.sizes != null) ...[
                  const SizedBox(height: 20),
                  Text(l.size, style: const TextStyle(fontWeight: FontWeight.w700)),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    children: p.sizes!.map((s) {
                      final on = size == s;
                      return ChoiceChip(
                        label: Text(s),
                        selected: on,
                        onSelected: (_) => setState(() { size = s; sizeErr = false; }),
                        selectedColor: Brand.orange,
                        labelStyle: TextStyle(
                            color: on ? Colors.white : null, fontWeight: FontWeight.w700),
                      );
                    }).toList(),
                  ),
                  if (sizeErr)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(l.pickSize,
                          style: const TextStyle(color: Colors.redAccent, fontSize: 13)),
                    ),
                ],

                const SizedBox(height: 20),
                Row(children: [
                  IconButton.outlined(
                      onPressed: () => setState(() => qty = qty > 1 ? qty - 1 : 1),
                      icon: const Icon(Icons.remove)),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    child: Text('$qty',
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                  ),
                  IconButton.outlined(
                      onPressed: () => setState(() => qty++),
                      icon: const Icon(Icons.add)),
                ]),

                const SizedBox(height: 20),
                Row(children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () {
                        if (!_ensureSize()) return;
                        context.read<AppState>().add(p, size: size, qty: qty);
                        ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(l.add), duration: const Duration(seconds: 1)));
                      },
                      child: Text(l.add),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: () {
                        if (!_ensureSize()) return;
                        context.read<AppState>().add(p, size: size, qty: qty);
                        Navigator.push(context,
                            MaterialPageRoute(builder: (_) => const CartScreen()));
                      },
                      child: Text(l.buyNow),
                    ),
                  ),
                ]),

                const SizedBox(height: 24),
                _trust(context, Icons.local_shipping_outlined, l.delivery),
                _trust(context, Icons.lock_outline, l.securePay),
                _trust(context, Icons.refresh, l.returns),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _trust(BuildContext c, IconData i, String s) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(children: [
          Icon(i, size: 18, color: Brand.orange),
          const SizedBox(width: 10),
          Expanded(child: Text(s, style: TextStyle(color: Theme.of(c).hintColor, fontSize: 13))),
        ]),
      );
}
