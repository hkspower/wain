import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';
import '../l10n.dart';
import '../services/api.dart';
import '../state/app_state.dart';
import '../theme.dart';

/// Native checkout: the order is created through our API (server computes the
/// total from stored prices), then the customer completes payment on the bank's
/// hosted KNET page — card entry must stay with the bank (PCI/KNET rule).
class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});
  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  bool busy = false;
  String? trackId;
  String? status;
  String? err;

  Future<void> _pay() async {
    final app = context.read<AppState>();
    setState(() { busy = true; err = null; });
    try {
      final r = await Api.createOrder(app.cart, app.lang);
      trackId = r.trackId;
      final ok = await launchUrl(Uri.parse(r.payUrl),
          mode: LaunchMode.externalApplication);
      if (!ok) throw Exception('cannot open payment page');
    } catch (e) {
      err = e.toString();
    }
    if (mounted) setState(() => busy = false);
  }

  Future<void> _check() async {
    if (trackId == null) return;
    setState(() => busy = true);
    final s = await Api.orderStatus(trackId!);
    if (!mounted) return;
    setState(() { status = s; busy = false; });
    if (s == 'paid') context.read<AppState>().clearCart();
  }

  @override
  Widget build(BuildContext context) {
    final l = L.of(context);
    final app = context.watch<AppState>();

    return Scaffold(
      appBar: AppBar(title: Text(l.checkout)),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(children: [
                ...app.cart.map((i) => Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                              child: Text(
                                  '${i.name[l.lang]} × ${i.qty}${i.size != null ? ' (${i.size})' : ''}',
                                  maxLines: 1, overflow: TextOverflow.ellipsis)),
                          Text(l.kwd(i.lineTotal),
                              style: const TextStyle(fontWeight: FontWeight.w700)),
                        ],
                      ),
                    )),
                const Divider(height: 24),
                Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                  Text(l.total, style: const TextStyle(fontWeight: FontWeight.w800)),
                  Text(l.kwd(app.total),
                      style: const TextStyle(
                          fontWeight: FontWeight.w800, color: Brand.orangeDark)),
                ]),
              ]),
            ),
          ),
          const SizedBox(height: 16),
          Row(children: [
            const Icon(Icons.lock_outline, size: 16, color: Brand.orange),
            const SizedBox(width: 8),
            Expanded(child: Text(l.securePay, style: const TextStyle(fontSize: 12))),
          ]),
          const SizedBox(height: 20),

          if (err != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(l.errorGeneric,
                  style: const TextStyle(color: Colors.redAccent)),
            ),

          if (trackId == null)
            FilledButton(
              onPressed: busy || app.cart.isEmpty ? null : _pay,
              child: busy
                  ? const SizedBox(
                      height: 20, width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : Text(l.payNow),
            )
          else ...[
            Text('${l.orderPlaced}: $trackId',
                style: const TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            if (status != null)
              Text(
                status == 'paid' ? l.paid : status == 'failed' ? l.failed : l.pending,
                style: TextStyle(
                    fontWeight: FontWeight.w800,
                    color: status == 'paid'
                        ? Colors.green
                        : status == 'failed'
                            ? Colors.redAccent
                            : Colors.orange),
              ),
            const SizedBox(height: 12),
            OutlinedButton(
                onPressed: busy ? null : _check, child: Text(l.checkStatus)),
          ],
        ],
      ),
    );
  }
}
