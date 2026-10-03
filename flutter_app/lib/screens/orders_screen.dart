/// «طلباتي» — the orders this device sent, and the thread each one lives in.
/// Mirrors the WhatsApp card of `OrderTracker.tsx`: the app has no database,
/// so there is no status to read and none is drawn; the card shows what the
/// device kept and opens the conversation with the shop.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../data/text_kit.dart';
import '../orders/order_kit.dart';
import '../orders/order_panel.dart' show orderLinesSummary;
import '../orders/order_store.dart';
import '../share/share_service.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/layout.dart';
import '../widgets/svg.dart';

class OrdersScreen extends StatelessWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = context.watch<OrderStore>();
    return CustomScrollView(
      slivers: [
        SliverToBoxAdapter(
          child: PageColumn(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'طلباتي',
                  style: wainText(
                    WainText.s4xl,
                    weight: FontWeight.w700,
                    color: WainColors.ink900,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'الطلبات اللي أرسلتها من هذا الجهاز. المكان يرد عليك بالواتساب.',
                  style: wainText(
                    WainText.sm,
                    color: WainColors.ink500,
                    height: 1.6,
                  ),
                ),
                const SizedBox(height: 16),
                if (store.orders.isEmpty)
                  EmptyState(
                    title: 'ما عندك طلبات',
                    body: 'لمّا تطلب مقدّماً من مكان، تلقاه هني.',
                    action: FilledButton(
                      key: const ValueKey('orders-explore'),
                      onPressed: () => context.go('/explore'),
                      style: FilledButton.styleFrom(
                        backgroundColor: WainColors.ink900,
                        foregroundColor: Colors.white,
                        minimumSize: const Size(0, 48),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(WainRadius.xl),
                        ),
                      ),
                      child: Text(
                        'تصفّح الأماكن',
                        style: wainText(
                          WainText.sm,
                          weight: FontWeight.w600,
                          color: Colors.white,
                        ),
                      ),
                    ),
                  )
                else
                  for (final o in store.orders) ...[
                    _OrderCard(order: o),
                    const SizedBox(height: 16),
                  ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// "من ٥ دقايق" — how long ago, in words.
String _agoAr(String? iso, DateTime now) {
  final at = iso == null ? null : DateTime.tryParse(iso);
  if (at == null) return '';
  final mins = now.difference(at).inMinutes;
  if (mins < 0) return '';
  if (mins < 1) return 'الحين';
  if (mins < 60) return 'من ${countAr(mins, kMinutesCount)}';
  return 'من ${countAr(mins ~/ 60, kHoursCount)}';
}

class _OrderCard extends StatelessWidget {
  final TrackedOrder order;
  const _OrderCard({required this.order});

  @override
  Widget build(BuildContext context) {
    final store = context.read<OrderStore>();
    final cancelled = order.cancelledAt != null;
    final digits = order.whatsapp ?? '';
    final thread = Uri.parse('https://wa.me/965$digits');
    final cancelUri = Uri.parse(
      whatsappOrderUrl(digits, cancelOrderMessage(order.reference)),
    );
    final action = TextButton.styleFrom(
      minimumSize: const Size(0, 48),
      padding: const EdgeInsets.symmetric(horizontal: 12),
      foregroundColor: WainColors.ink500,
    );
    final actionText = wainText(
      WainText.sm,
      weight: FontWeight.w600,
      color: WainColors.ink500,
    );

    return Panel(
      key: ValueKey('order-card-${order.id}'),
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          order.reference,
                          textDirection: TextDirection.ltr,
                          style: wainText(
                            WainText.xl,
                            weight: FontWeight.w700,
                            color: WainColors.ink900,
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: cancelled
                                ? WainColors.sand200
                                : WainColors.palm600.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(99),
                          ),
                          child: Text(
                            cancelled ? 'طلبت إلغاءه' : 'أرسلته عبر واتساب',
                            style: wainText(
                              WainText.xs,
                              weight: FontWeight.w600,
                              color: cancelled
                                  ? WainColors.ink600
                                  : WainColors.palm700,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    InkWell(
                      key: ValueKey('order-place-${order.id}'),
                      onTap: () => context.push('/places/${order.placeSlug}'),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            // Flexible: a long name beside the time pill
                            // overflowed the row at 320 in the widget suite.
                            Flexible(
                              child: Text(
                                order.placeNameAr,
                                overflow: TextOverflow.ellipsis,
                                style: wainText(
                                  WainText.sm,
                                  weight: FontWeight.w600,
                                  color: WainColors.ink700,
                                ),
                              ),
                            ),
                            const SizedBox(width: 4),
                            WainSvg.icon(
                              'go',
                              size: 14,
                              color: WainColors.ink700,
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                decoration: BoxDecoration(
                  color: WainColors.sand100,
                  borderRadius: BorderRadius.circular(99),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    WainSvg.icon('clock', size: 16, color: WainColors.sea600),
                    const SizedBox(width: 6),
                    Text(
                      timeAr(order.pickupAt),
                      style: wainText(
                        WainText.sm,
                        weight: FontWeight.w600,
                        color: WainColors.ink700,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: WainColors.sand100,
              borderRadius: BorderRadius.circular(WainRadius.s2xl),
            ),
            child: Text(
              cancelled
                  ? 'طلبت الإلغاء عبر واتساب ${_agoAr(order.cancelledAt, store.clock())}. المكان يرد عليك هناك.'
                  : 'المكان يرد عليك بالواتساب — الحالة ما تنعرض هني.',
              style: wainText(
                WainText.sm,
                weight: FontWeight.w600,
                color: WainColors.ink600,
                height: 1.6,
              ),
            ),
          ),
          if (order.lines.isNotEmpty) ...[
            const SizedBox(height: 12),
            orderLinesSummary(order.lines, order.totalFils),
          ] else ...[
            const SizedBox(height: 12),
            Text(
              'المجموع التقريبي ${formatKwd(order.totalFils)}',
              style: wainText(WainText.sm, color: WainColors.ink600),
            ),
          ],
          if (order.noteAr.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(
              'ملاحظتك: ${order.noteAr}',
              style: wainText(WainText.sm, color: WainColors.ink600),
            ),
          ],
          const SizedBox(height: 12),
          const Divider(height: 1, color: WainColors.line),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  'الدفع عند الاستلام',
                  style: wainText(WainText.sm, color: WainColors.ink500),
                ),
              ),
            ],
          ),
          Wrap(
            alignment: WrapAlignment.end,
            children: [
              TextButton(
                key: ValueKey('order-thread-${order.id}'),
                onPressed: () => shareBackend.openUrl(thread),
                style: action.copyWith(
                  foregroundColor: const WidgetStatePropertyAll(
                    WainColors.palm700,
                  ),
                ),
                child: Text(
                  'افتح المحادثة',
                  style: actionText.copyWith(color: WainColors.palm700),
                ),
              ),
              if (!cancelled)
                TextButton.icon(
                  key: ValueKey('order-cancel-${order.id}'),
                  onPressed: () => _cancel(context, store, cancelUri),
                  style: action,
                  icon: WainSvg.icon(
                    'close',
                    size: 16,
                    color: WainColors.ink500,
                  ),
                  label: Text('ألغِ عبر واتساب', style: actionText),
                ),
              TextButton(
                key: ValueKey('order-forget-${order.id}'),
                onPressed: () {
                  HapticFeedback.selectionClick();
                  store.forget(order.id);
                },
                style: action,
                child: Text('احذفه من القائمة', style: actionText),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Future<void> _cancel(
    BuildContext context,
    OrderStore store,
    Uri cancelUri,
  ) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(
          'تبي تلغي الطلب ${order.reference}؟',
          style: wainText(
            WainText.lg,
            weight: FontWeight.w700,
            color: WainColors.ink900,
          ),
        ),
        content: Text(
          'بنفتح لك واتساب برسالة الإلغاء، والمكان يرد عليك هناك.',
          style: wainText(WainText.sm, color: WainColors.ink600, height: 1.6),
        ),
        actions: [
          TextButton(
            key: const ValueKey('order-cancel-no'),
            onPressed: () => Navigator.of(c).pop(false),
            child: const Text('لا'),
          ),
          FilledButton(
            key: const ValueKey('order-cancel-yes'),
            onPressed: () => Navigator.of(c).pop(true),
            child: const Text('ألغِ'),
          ),
        ],
      ),
    );
    if (yes != true) return;
    // Marked as the customer's own request the moment the thread opens:
    // nothing here can see whether the shop agreed.
    store.markCancelledByMe(order.id);
    HapticFeedback.lightImpact();
    await shareBackend.openUrl(cancelUri);
  }
}
