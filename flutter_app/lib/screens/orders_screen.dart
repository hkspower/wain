/// «طلباتي» — the orders this device sent. Two cards, as in `OrderTracker.tsx`:
/// a «db» order is read back from the shop's board while the screen is open —
/// its status, and a cancel that is a real cancel — and a WhatsApp order shows
/// what the device kept and opens the conversation with the shop, because
/// nothing here can know what the shop did with a message.
library;

import 'dart:async';

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

/// How often an open card asks again. The web's tracker uses 45s; a phone
/// screen that is actually being looked at is the moment the answer is wanted.
const Duration kOrderPollEvery = Duration(seconds: 45);

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    // Ask once as the screen opens, then on a timer while it stays open; the
    // store itself stops caring about an order once its status is final.
    WidgetsBinding.instance.addPostFrameCallback((_) => _refreshAll());
    _timer = Timer.periodic(kOrderPollEvery, (_) => _refreshAll());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refreshAll() async {
    if (!mounted) return;
    final store = context.read<OrderStore>();
    for (final o in store.orders) {
      if (o.channel != 'db') continue;
      final known = store.stateOf(o.id);
      if (known != null && known.isFinal) continue;
      await store.refresh(o.id);
      if (!mounted) return;
    }
  }

  @override
  Widget build(BuildContext context) {
    final store = context.watch<OrderStore>();
    final anyDb = store.orders.any((o) => o.channel == 'db');
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
                  anyDb
                      ? 'الطلبات اللي أرسلتها من هذا الجهاز، وحالة كل واحد عند المكان.'
                      : 'الطلبات اللي أرسلتها من هذا الجهاز. المكان يرد عليك بالواتساب.',
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
                    if (o.channel == 'db')
                      _DbOrderCard(order: o)
                    else
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

/// The web's status words, and the three steps of its ladder.
const _kStatusAr = {
  'placed': 'بانتظار التجهيز',
  'ready': 'جاهز',
  'collected': 'تسلّمته',
  'cancelled': 'ملغي',
};
const _kSteps = ['placed', 'ready', 'collected'];

/// A «db» order: the shop's board holds it, and this card follows it.
class _DbOrderCard extends StatelessWidget {
  final TrackedOrder order;
  const _DbOrderCard({required this.order});

  @override
  Widget build(BuildContext context) {
    final store = context.watch<OrderStore>();
    final state = store.stateOf(order.id);
    final unreachable = store.isUnreachable(order.id);
    // What the device knows outranks a status it never managed to read: an
    // order the customer cancelled here is cancelled even while offline.
    final status = order.cancelledByMe ? 'cancelled' : (state?.status ?? 'placed');
    final cancelled = status == 'cancelled';
    final stepIndex = _kSteps.indexOf(status);
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
                          key: ValueKey('order-status-${order.id}'),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 4,
                          ),
                          decoration: BoxDecoration(
                            color: cancelled
                                ? WainColors.sand200
                                : status == 'ready'
                                ? WainColors.sea50
                                : status == 'collected'
                                ? WainColors.palm600.withValues(alpha: 0.12)
                                : WainColors.sun100,
                            borderRadius: BorderRadius.circular(99),
                          ),
                          child: Text(
                            // «ألغيت الطلب» for one's own act, «المكان ألغى
                            // الطلب» for the shop's — the status alone cannot
                            // say which, the device can.
                            cancelled
                                ? (order.cancelledByMe
                                      ? 'ألغيت الطلب'
                                      : 'المكان ألغى الطلب')
                                : _kStatusAr[status] ?? status,
                            style: wainText(
                              WainText.xs,
                              weight: FontWeight.w600,
                              color: cancelled
                                  ? WainColors.ink600
                                  : status == 'ready'
                                  ? WainColors.sea700
                                  : status == 'collected'
                                  ? WainColors.palm700
                                  : WainColors.sun900,
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
          if (!cancelled) ...[
            const SizedBox(height: 12),
            // The ladder: placed → ready → collected.
            Row(
              children: [
                for (var i = 0; i < _kSteps.length; i++) ...[
                  Expanded(
                    child: Container(
                      height: 6,
                      decoration: BoxDecoration(
                        color: i <= stepIndex
                            ? WainColors.palm600
                            : WainColors.line,
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                  ),
                  if (i < _kSteps.length - 1) const SizedBox(width: 4),
                ],
              ],
            ),
          ],
          const SizedBox(height: 12),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: status == 'ready' ? WainColors.sea50 : WainColors.sand100,
              borderRadius: BorderRadius.circular(WainRadius.s2xl),
            ),
            child: Text(
              cancelled
                  ? (order.cancelledByMe
                        ? 'ألغيت الطلب ${_agoAr(order.cancelledAt ?? state?.cancelledAt, store.clock())}.'
                        : 'المكان ألغى الطلب. اتصل فيهم لو تبي تعرف السبب.')
                  : status == 'ready'
                  ? 'طلبك جاهز — قول رقم ${order.reference} عند الاستلام، والدفع عندهم.'
                  : status == 'collected'
                  ? 'تسلّمته. بالعافية!'
                  : unreachable
                  ? 'ما قدرنا نتأكد من الحالة الحين — الطلب محفوظ، وبنحدّثها أول ما يرجع الاتصال.'
                  : 'المكان يجهّزه. نحدّث الحالة هني.',
              key: ValueKey('order-line-${order.id}'),
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
          Text(
            'الدفع عند الاستلام',
            style: wainText(WainText.sm, color: WainColors.ink500),
          ),
          Wrap(
            alignment: WrapAlignment.end,
            children: [
              // Cancel only while placed: once ready the food exists, and the
              // honest thing is the phone, not a button.
              if (status == 'placed' && !unreachable)
                TextButton.icon(
                  key: ValueKey('order-cancel-${order.id}'),
                  onPressed: () => _cancel(context, store),
                  style: action,
                  icon: WainSvg.icon(
                    'close',
                    size: 16,
                    color: WainColors.ink500,
                  ),
                  label: Text('ألغِ الطلب', style: actionText),
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

  Future<void> _cancel(BuildContext context, OrderStore store) async {
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
          'يوصل الإلغاء للمكان مباشرة. ما ينفع بعد ما يجهّزونه.',
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
    if (yes != true || !context.mounted) return;
    final result = await store.cancelDb(order.id);
    if (!context.mounted) return;
    HapticFeedback.lightImpact();
    if (result == 'cancelled') return;
    final messenger = ScaffoldMessenger.maybeOf(context);
    messenger?.showSnackBar(
      SnackBar(
        content: Text(
          result == 'ready' || result == 'collected'
              ? (result == 'collected'
                    ? 'الطلب متسلّم أصلاً.'
                    : 'المكان بدأ يجهّز طلبك، فما نقدر نلغيه من هني. اتصل فيهم لو تبي تلغي.')
              : result == 'unknown'
              ? 'ما لقينا الطلب. اتصل بالمكان عشان يلغونه.'
              : 'ما وصل الإلغاء. جرّب مرة ثانية.',
        ),
      ),
    );
    // A «too late» answer is news: show it on the card too.
    await store.refresh(order.id);
  }
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
