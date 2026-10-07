/// «اطلب مقدّماً» — order ahead, collect and pay at the place. Mirrors
/// `OrderPanel.tsx` in both its modes: with the back end on («db», the
/// default) the order is sent to the shop's board and asks for a phone, so the
/// shop can call; with it off («whatsapp») it opens in WhatsApp as a message
/// to the shop's number (`buildOrderMessage`, byte for byte the web's). Which
/// mode is `OrderStore.channelFor` — one per build, never both.
///
/// Everything the customer is told here has to survive the moment they walk
/// in and hand over money wain never saw: «الدفع عند الاستلام», never «مدفوع»,
/// and the total is «التقريبي» because the shop's till is the authority.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';

import '../data/models.dart';
import '../data/text_kit.dart';
import '../share/hangout_panel.dart' show kInviteOrigin;
import '../share/share_service.dart';
import '../theme/app_theme.dart';
import '../theme/colors.dart';
import '../widgets/layout.dart';
import '../widgets/svg.dart';
import 'order_kit.dart';
import 'order_store.dart';

class OrderPanel extends StatefulWidget {
  final Place place;

  /// Injected clock for tests: the slots are read once, when the panel
  /// opens, so a slot the customer is looking at cannot expire under them.
  final DateTime Function() clock;
  const OrderPanel({super.key, required this.place, this.clock = _now});
  static DateTime _now() => DateTime.now();

  @override
  State<OrderPanel> createState() => _OrderPanelState();
}

class _OrderPanelState extends State<OrderPanel> {
  final _qty = <String, int>{};
  String? _pickupAt;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _note = TextEditingController();
  List<String> _errors = const [];
  WhatsAppOrderResult? _placed;
  TrackedOrder? _placedDb;
  bool _copied = false;
  bool _busy = false;
  late final List<PickupSlot> _slots = pickupSlots(
    widget.clock(),
    prepMinutes: widget.place.orderPrepMinutes,
  );

  /// One identity per basket: the same lines at the same time, sent twice
  /// because the first chat was lost, is one order with one reference.
  String _signature = '';
  OrderAttempt _attempt = OrderAttempt();

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _note.dispose();
    super.dispose();
  }

  List<OrderLine> get _lines => [
    for (final m in widget.place.menuAr)
      if (!m.soldOut && (_qty[m.id] ?? 0) > 0)
        OrderLine(
          id: m.id,
          nameAr: m.nameAr,
          priceFils: m.priceFils,
          qty: _qty[m.id]!,
        ),
  ];

  void _bump(String id, int by) {
    final was = _qty[id] ?? 0;
    final next = (was + by).clamp(0, kMaxQtyPerItem);
    if (next == was) {
      HapticFeedback.heavyImpact();
      return;
    }
    HapticFeedback.selectionClick();
    setState(() => _qty[id] = next);
  }

  Future<void> _send() async {
    final lines = _lines;
    final sig = '${lines.map((l) => '${l.id}:${l.qty}').join(',')}@$_pickupAt';
    if (sig != _signature) {
      _signature = sig;
      _attempt = OrderAttempt();
    }
    final input = OrderInput(
      placeSlug: widget.place.slug,
      placeNameAr: widget.place.nameAr,
      lines: lines,
      pickupAt: _pickupAt ?? '',
      customerName: _name.text,
      customerPhone: _phone.text,
      noteAr: _note.text,
    );
    final store = context.read<OrderStore>();
    setState(() => _busy = true);
    if (store.channelFor(widget.place) == 'db') {
      final r = await store.sendDb(input, attempt: _attempt);
      if (!mounted) return;
      setState(() {
        _busy = false;
        if (!r.ok) {
          _errors = [r.problem!];
          return;
        }
        _errors = const [];
        _placedDb = r.tracked;
      });
      if (r.ok) {
        HapticFeedback.lightImpact();
      } else {
        HapticFeedback.heavyImpact();
      }
      return;
    }
    final result = await store.send(
      input,
      digits: widget.place.orderWhatsApp!,
      attempt: _attempt,
      pageUrl: '$kInviteOrigin/places/${widget.place.slug}/',
    );
    if (!mounted) return;
    setState(() {
      _busy = false;
      if (!result.ok) {
        _errors = [result.problem!];
        return;
      }
      _errors = const [];
      _placed = result;
    });
    if (result.ok) {
      if (result.opened) {
        HapticFeedback.lightImpact();
      } else {
        HapticFeedback.heavyImpact();
      }
    } else {
      HapticFeedback.heavyImpact();
    }
  }

  @override
  Widget build(BuildContext context) {
    final channel = context.read<OrderStore>().channelFor(widget.place);
    if (channel == null) return const SizedBox.shrink();
    final db = channel == 'db';
    final placedDb = _placedDb;
    if (placedDb != null) return _placedDbView(context, placedDb);
    final placed = _placed;
    if (placed != null) return _placedView(context, placed);

    final lines = _lines;
    final total = orderTotal(lines);
    final count = lines.fold(0, (n, l) => n + l.qty);
    final label = wainText(
      WainText.xs,
      weight: FontWeight.w600,
      color: WainColors.ink600,
    );

    return Container(
      key: const ValueKey('order-panel'),
      margin: const EdgeInsets.only(top: 20),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(WainRadius.s3xl),
        border: Border.all(color: WainColors.line),
        boxShadow: WainShadows.xs,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  'اطلب مقدّماً',
                  style: wainText(
                    WainText.s2xl,
                    weight: FontWeight.w700,
                    color: WainColors.ink900,
                  ),
                ),
              ),
              _Pill('الدفع عند الاستلام'),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            db
                ? 'اختر اللي تبيه ووقت الاستلام، ويوصل طلبك للمكان مباشرة. '
                      'ما ندفع ولا نمسك فلوسك — تدفع لهم وقت الاستلام.'
                : 'اختر اللي تبيه ووقت الاستلام، ويوصل طلبك للمكان على واتساب وهم يردون عليك هناك. '
                      'ما ندفع ولا نمسك فلوسك — تدفع لهم مباشرة.',
            style: wainText(WainText.sm, color: WainColors.ink500, height: 1.6),
          ),
          const SizedBox(height: 12),
          for (final item in widget.place.menuAr) _menuRow(item),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: WainColors.sand100,
              borderRadius: BorderRadius.circular(WainRadius.s2xl),
            ),
            child: Row(
              children: [
                WainSvg.icon('coins', size: 16, color: WainColors.sand600),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    count > 0
                        ? 'المجموع التقريبي (${toArabicDigits(count)} صنف)'
                        : 'المجموع التقريبي',
                    style: wainText(
                      WainText.sm,
                      weight: FontWeight.w600,
                      color: WainColors.ink700,
                    ),
                  ),
                ),
                Text(
                  formatKwd(total),
                  key: const ValueKey('order-total'),
                  style: wainText(
                    WainText.lg,
                    weight: FontWeight.w700,
                    color: WainColors.ink900,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              WainSvg.icon('clock', size: 16, color: WainColors.sea600),
              const SizedBox(width: 6),
              Text('وقت الاستلام', style: label),
            ],
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final s in _slots)
                WainChip(
                  key: ValueKey('order-slot-${s.value}'),
                  label: s.labelAr,
                  active: s.value == _pickupAt,
                  onTap: () {
                    HapticFeedback.selectionClick();
                    setState(() => _pickupAt = s.value);
                  },
                ),
            ],
          ),
          const SizedBox(height: 16),
          Text('اسمك', style: label),
          const SizedBox(height: 6),
          _field(_name, key: 'order-name', hint: 'عشان ينادونك', maxLength: 80),
          if (db) ...[
            const SizedBox(height: 12),
            Text('رقمك', style: label),
            const SizedBox(height: 6),
            // The shop calls when the order is ready, or if something ran out;
            // in WhatsApp mode the thread is the number, so none is asked.
            _field(
              _phone,
              key: 'order-phone',
              hint: '٥XXXXXXX',
              maxLength: 20,
              keyboard: TextInputType.phone,
              ltr: true,
            ),
          ],
          const SizedBox(height: 12),
          Text('ملاحظة (اختياري)', style: label),
          const SizedBox(height: 6),
          _field(
            _note,
            key: 'order-note',
            hint: 'بدون سكر، مثلاً',
            maxLength: kMaxNoteChars,
          ),
          if (_errors.isNotEmpty) ...[
            const SizedBox(height: 12),
            Container(
              key: const ValueKey('order-errors'),
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: WainColors.coral50,
                borderRadius: BorderRadius.circular(WainRadius.s2xl),
              ),
              child: Semantics(
                liveRegion: true,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final e in _errors)
                      Text(
                        e,
                        style: wainText(
                          WainText.sm,
                          weight: FontWeight.w600,
                          color: WainColors.coral700,
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ],
          const SizedBox(height: 20),
          FilledButton(
            key: const ValueKey('order-send'),
            onPressed: _busy || count == 0 ? null : _send,
            style: FilledButton.styleFrom(
              backgroundColor: WainColors.palm600,
              foregroundColor: Colors.white,
              minimumSize: const Size(double.infinity, 48),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(WainRadius.s2xl),
              ),
            ),
            child: Text(
              db ? 'أرسل الطلب' : 'أرسل عبر واتساب',
              style: wainText(
                WainText.base,
                weight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'ما تدفع شي هنا. الطلب يوصل للمكان وتدفع لهم وقت الاستلام.'
            '${widget.place.orderNoteAr != null ? ' ${widget.place.orderNoteAr}' : ''}',
            textAlign: TextAlign.center,
            style: wainText(
              WainText.s2xs,
              color: WainColors.ink500,
              height: 1.6,
            ),
          ),
        ],
      ),
    );
  }

  Widget _field(
    TextEditingController c, {
    required String key,
    required String hint,
    required int maxLength,
    TextInputType? keyboard,
    bool ltr = false,
  }) => TextField(
    key: ValueKey(key),
    controller: c,
    maxLength: maxLength,
    keyboardType: keyboard,
    textDirection: ltr ? TextDirection.ltr : null,
    onTapOutside: (_) => FocusManager.instance.primaryFocus?.unfocus(),
    style: wainText(WainText.base, color: WainColors.ink800),
    decoration: InputDecoration(
      hintText: hint,
      counterText: '',
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(WainRadius.xl),
        borderSide: const BorderSide(color: WainColors.lineControl),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(WainRadius.xl),
        borderSide: const BorderSide(color: WainColors.lineControl),
      ),
    ),
  );

  Widget _menuRow(MenuItem item) {
    final n = _qty[item.id] ?? 0;
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 10),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: WainColors.line)),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.nameAr,
                  style:
                      wainText(
                        WainText.base,
                        weight: FontWeight.w600,
                        color: item.soldOut
                            ? WainColors.ink500
                            : WainColors.ink900,
                      ).copyWith(
                        decoration: item.soldOut
                            ? TextDecoration.lineThrough
                            : null,
                      ),
                ),
                if (item.noteAr != null)
                  Text(
                    item.noteAr!,
                    style: wainText(WainText.xs, color: WainColors.ink500),
                  ),
                Text(
                  formatKwd(item.priceFils),
                  style: wainText(WainText.sm, color: WainColors.ink600),
                ),
              ],
            ),
          ),
          if (item.soldOut)
            _Pill('خلصت', color: WainColors.sand200)
          else ...[
            _Stepper(
              key: ValueKey('order-minus-${item.id}'),
              glyph: '−',
              label: 'أنقص ${item.nameAr}',
              enabled: n > 0,
              onTap: () => _bump(item.id, -1),
            ),
            SizedBox(
              width: 32,
              child: Semantics(
                liveRegion: true,
                label: 'الكمية ${toArabicDigits(n)}',
                child: Text(
                  toArabicDigits(n),
                  key: ValueKey('order-qty-${item.id}'),
                  textAlign: TextAlign.center,
                  style: wainText(
                    WainText.base,
                    weight: FontWeight.w700,
                    color: WainColors.ink900,
                  ),
                ),
              ),
            ),
            _Stepper(
              key: ValueKey('order-plus-${item.id}'),
              glyph: '+',
              label: 'زد ${item.nameAr}',
              enabled: n < kMaxQtyPerItem,
              onTap: () => _bump(item.id, 1),
            ),
          ],
        ],
      ),
    );
  }

  /// «وصل طلبك» — the shop's board has it. OrderPanel.tsx's confirmation in
  /// db mode: the reference to say at the counter, the lines, a way to
  /// «طلباتي» where the status is followed.
  Widget _placedDbView(BuildContext context, TrackedOrder tracked) {
    final slot = _slots.where((s) => s.value == _pickupAt).firstOrNull;
    return Container(
      key: const ValueKey('order-placed'),
      margin: const EdgeInsets.only(top: 20),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: WainColors.palm600.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(WainRadius.s3xl),
        border: Border.all(color: WainColors.palm600.withValues(alpha: 0.3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              WainSvg.icon('check', size: 20, color: WainColors.palm600),
              const SizedBox(width: 8),
              Text(
                'وصل طلبك',
                style: wainText(
                  WainText.xl,
                  weight: FontWeight.w700,
                  color: WainColors.ink900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text.rich(
            TextSpan(
              children: [
                const TextSpan(text: 'رقم طلبك '),
                TextSpan(
                  text: tracked.reference,
                  style: wainText(
                    WainText.lg,
                    weight: FontWeight.w700,
                    color: WainColors.ink900,
                  ),
                ),
                const TextSpan(text: ' — قوله لهم عند الاستلام.'),
              ],
            ),
            style: wainText(WainText.sm, color: WainColors.ink600, height: 1.6),
          ),
          const SizedBox(height: 4),
          Text(
            'الدفع عند الاستلام في ${widget.place.nameAr}'
            '${slot != null ? ' الساعة ${slot.labelAr}' : ''}.',
            style: wainText(
              WainText.sm,
              weight: FontWeight.w600,
              color: WainColors.ink700,
            ),
          ),
          if (widget.place.orderNoteAr != null)
            Text(
              widget.place.orderNoteAr!,
              style: wainText(WainText.xs, color: WainColors.ink500),
            ),
          const SizedBox(height: 12),
          _Lines(lines: tracked.lines, totalFils: tracked.totalFils),
          const SizedBox(height: 12),
          FilledButton.icon(
            key: const ValueKey('order-track'),
            onPressed: () => context.push('/orders'),
            style: FilledButton.styleFrom(
              backgroundColor: WainColors.ink900,
              foregroundColor: Colors.white,
              minimumSize: const Size(0, 48),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(WainRadius.xl),
              ),
            ),
            icon: WainSvg.icon('go', size: 16, color: Colors.white),
            label: Text(
              'تابع طلبك',
              style: wainText(
                WainText.sm,
                weight: FontWeight.w600,
                color: Colors.white,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text(
            'تلقاه في «طلباتي» على هذا الجهاز، وتشوف حالته لمّا يجهّزونه.',
            style: wainText(WainText.xs, color: WainColors.ink500),
          ),
        ],
      ),
    );
  }

  Widget _placedView(BuildContext context, WhatsAppOrderResult placed) {
    final blocked = !placed.opened;
    final slot = _slots.where((s) => s.value == _pickupAt).firstOrNull;
    final strong = wainText(
      WainText.sm,
      weight: FontWeight.w600,
      color: WainColors.ink700,
    );
    return Container(
      key: ValueKey(blocked ? 'order-blocked' : 'order-placed'),
      margin: const EdgeInsets.only(top: 20),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: blocked
            ? WainColors.sun50
            : WainColors.palm600.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(WainRadius.s3xl),
        border: Border.all(
          color: blocked
              ? WainColors.sun500.withValues(alpha: 0.4)
              : WainColors.palm600.withValues(alpha: 0.3),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              WainSvg.icon('check', size: 20, color: WainColors.palm600),
              const SizedBox(width: 8),
              Text(
                blocked ? 'جهّزنا رسالتك' : 'فتحنا لك واتساب',
                style: wainText(
                  WainText.xl,
                  weight: FontWeight.w700,
                  color: WainColors.ink900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text.rich(
            TextSpan(
              children: [
                if (!blocked)
                  const TextSpan(text: 'اضغط «إرسال» هناك عشان توصل للمكان. '),
                const TextSpan(text: 'رقم طلبك '),
                TextSpan(
                  text: placed.tracked!.reference,
                  style: wainText(
                    WainText.lg,
                    weight: FontWeight.w700,
                    color: WainColors.ink900,
                  ),
                ),
                const TextSpan(text: ' — قوله لهم عند الاستلام.'),
              ],
            ),
            style: wainText(WainText.sm, color: WainColors.ink600, height: 1.6),
          ),
          const SizedBox(height: 4),
          Text(
            'الدفع عند الاستلام في ${widget.place.nameAr}'
            '${slot != null ? ' الساعة ${slot.labelAr}' : ''}.',
            style: strong,
          ),
          if (widget.place.orderNoteAr != null)
            Text(
              widget.place.orderNoteAr!,
              style: wainText(WainText.xs, color: WainColors.ink500),
            ),
          if (blocked) ...[
            const SizedBox(height: 12),
            Text(
              'ما انفتح واتساب من هني — افتحه بالزر، أو انسخ الطلب والصقه برسالة للمكان.',
              style: strong,
            ),
            const SizedBox(height: 8),
            Container(
              key: const ValueKey('order-failed-text'),
              width: double.infinity,
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(WainRadius.s2xl),
                border: Border.all(color: WainColors.line),
              ),
              child: SelectableText(
                placed.text!,
                style: wainText(
                  WainText.sm,
                  color: WainColors.ink800,
                  height: 1.6,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton(
                  key: const ValueKey('order-open-wa'),
                  onPressed: () => shareBackend.openWhatsApp(placed.url!),
                  style: FilledButton.styleFrom(
                    backgroundColor: WainColors.palm600,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(0, 48),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(WainRadius.xl),
                    ),
                  ),
                  child: Text(
                    'افتح واتساب',
                    style: wainText(
                      WainText.sm,
                      weight: FontWeight.w600,
                      color: Colors.white,
                    ),
                  ),
                ),
                OutlinedButton(
                  key: const ValueKey('order-copy'),
                  onPressed: () async {
                    final ok = await shareBackend.copy(placed.text!);
                    HapticFeedback.lightImpact();
                    if (mounted) setState(() => _copied = ok);
                  },
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 48),
                    side: const BorderSide(color: WainColors.lineControl),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(WainRadius.xl),
                    ),
                  ),
                  child: Text(
                    _copied ? 'انتسخ ✓' : 'انسخ',
                    style: wainText(
                      WainText.sm,
                      weight: FontWeight.w600,
                      color: WainColors.ink700,
                    ),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          _Lines(
            lines: placed.tracked!.lines,
            totalFils: placed.tracked!.totalFils,
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              FilledButton.icon(
                key: const ValueKey('order-track'),
                onPressed: () => context.push('/orders'),
                style: FilledButton.styleFrom(
                  backgroundColor: WainColors.ink900,
                  foregroundColor: Colors.white,
                  minimumSize: const Size(0, 48),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(WainRadius.xl),
                  ),
                ),
                icon: WainSvg.icon('go', size: 16, color: Colors.white),
                label: Text(
                  'تابع طلبك',
                  style: wainText(
                    WainText.sm,
                    weight: FontWeight.w600,
                    color: Colors.white,
                  ),
                ),
              ),
              if (!blocked)
                TextButton(
                  key: const ValueKey('order-open-wa'),
                  onPressed: () => shareBackend.openWhatsApp(placed.url!),
                  style: TextButton.styleFrom(minimumSize: const Size(0, 48)),
                  child: Text(
                    'ما انفتح؟ افتح واتساب',
                    style: wainText(
                      WainText.sm,
                      weight: FontWeight.w600,
                      color: WainColors.ink600,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            'تلقاه في «طلباتي» على هذا الجهاز. المكان يرد عليك بالواتساب.',
            style: wainText(WainText.xs, color: WainColors.ink500),
          ),
        ],
      ),
    );
  }
}

/// What is in the order, and its total — `OrderLines` in OrderSummary.tsx.
class _Lines extends StatelessWidget {
  final List<OrderLine> lines;
  final int totalFils;
  const _Lines({required this.lines, required this.totalFils});

  @override
  Widget build(BuildContext context) {
    if (lines.isEmpty) return const SizedBox.shrink();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: WainColors.sand100,
        borderRadius: BorderRadius.circular(WainRadius.s2xl),
      ),
      child: Column(
        children: [
          for (final l in lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                children: [
                  Expanded(
                    child: Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(
                            text: l.nameAr,
                            style: wainText(
                              WainText.sm,
                              weight: FontWeight.w600,
                              color: WainColors.ink800,
                            ),
                          ),
                          if (l.qty > 1)
                            TextSpan(
                              text: '  ×${toArabicDigits(l.qty)}',
                              style: wainText(
                                WainText.sm,
                                color: WainColors.ink500,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  Text(
                    formatKwd(lineTotal(l)),
                    style: wainText(WainText.sm, color: WainColors.ink600),
                  ),
                ],
              ),
            ),
          const Divider(height: 12, color: WainColors.line),
          Row(
            children: [
              Expanded(
                child: Text(
                  'المجموع التقريبي',
                  style: wainText(
                    WainText.sm,
                    weight: FontWeight.w600,
                    color: WainColors.ink700,
                  ),
                ),
              ),
              Text(
                formatKwd(totalFils),
                style: wainText(
                  WainText.base,
                  weight: FontWeight.w700,
                  color: WainColors.ink900,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The lines summary, shared with «طلباتي».
Widget orderLinesSummary(List<OrderLine> lines, int totalFils) =>
    _Lines(lines: lines, totalFils: totalFils);

class _Pill extends StatelessWidget {
  final String text;
  final Color color;
  const _Pill(this.text, {this.color = WainColors.sand100});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
    decoration: BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(99),
    ),
    child: Text(
      text,
      style: wainText(
        WainText.xs,
        weight: FontWeight.w600,
        color: WainColors.ink600,
      ),
    ),
  );
}

/// −/+ on a menu row: a 32px drawing inside a 48dp target (HitArea), named
/// for a screen reader.
class _Stepper extends StatelessWidget {
  final String glyph;
  final String label;
  final bool enabled;
  final VoidCallback onTap;
  const _Stepper({
    super.key,
    required this.glyph,
    required this.label,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    enabled: enabled,
    label: label,
    child: Opacity(
      opacity: enabled ? 1 : 0.35,
      child: HitArea(
        onTap: enabled ? onTap : null,
        child: Container(
          width: 32,
          height: 32,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(WainRadius.xl),
            border: Border.all(color: WainColors.lineStrong),
          ),
          child: Text(
            glyph,
            style: wainText(
              WainText.lg,
              weight: FontWeight.w700,
              color: WainColors.ink700,
            ),
          ),
        ),
      ),
    ),
  );
}
