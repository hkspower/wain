/// النوخذة — النظام الموحد من المهلب كود.
///
/// Four units over one data core: المركز المالي · صافي · XBRL · التوصيل.
/// Arabic-first and RTL throughout, white on every device, free in full.
library;

import 'package:flutter/material.dart';

import 'core/models.dart';
import 'core/xbrl.dart';
import 'core/money.dart';
import 'store.dart';
import 'ui/brand.dart';

void main() => runApp(const NokhathaApp());

class NokhathaApp extends StatelessWidget {
  const NokhathaApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'النوخذة',
        debugShowCheckedModeBanner: false,
        theme: Brand.theme(),
        locale: const Locale('ar', 'KW'),
        // RTL for the whole tree, not per-widget: the direction is the app's,
        // and leaving it to inherit is how a stray LTR island appears.
        builder: (context, child) => Directionality(
          textDirection: TextDirection.rtl,
          child: child ?? const SizedBox.shrink(),
        ),
        home: const Shell(),
      );
}

class Shell extends StatefulWidget {
  const Shell({super.key});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  final store = Store();
  int tab = 0;

  static const _tabs = [
    (icon: Icons.anchor, label: 'المركز المالي'),
    (icon: Icons.show_chart, label: 'صافي'),
    (icon: Icons.description_outlined, label: 'XBRL'),
    (icon: Icons.delivery_dining, label: 'التوصيل'),
  ];

  @override
  void initState() {
    super.initState();
    store.addListener(_onChange);
    store.load();
  }

  void _onChange() => setState(() {});

  @override
  void dispose() {
    store.removeListener(_onChange);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(
          toolbarHeight: 78,
          title: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const BoumMark(height: 30),
              const SizedBox(height: Brand.s4),
              Text(_tabs[tab].label,
                  style: const TextStyle(
                      fontSize: 16, fontWeight: FontWeight.w800)),
            ],
          ),
        ),
        body: switch (tab) {
          0 => PositionView(store: store),
          1 => SafiView(store: store),
          2 => XbrlView(store: store),
          _ => DeliveryView(store: store),
        },
        bottomNavigationBar: NavigationBar(
          selectedIndex: tab,
          onDestinationSelected: (i) => setState(() => tab = i),
          backgroundColor: Brand.bg,
          indicatorColor: Brand.panel2,
          destinations: [
            for (final t in _tabs)
              NavigationDestination(icon: Icon(t.icon), label: t.label),
          ],
        ),
      );
}

/// A statement figure: label at the reading start, amount at the end. A
/// computed total is a statement total, not another input.
class StatRow extends StatelessWidget {
  const StatRow(this.label, this.value, {super.key, this.strong = false, this.tone});

  final String label;
  final String value;
  final bool strong;
  final Color? tone;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: Brand.s8),
        child: Row(
          children: [
            Expanded(
              child: Text(label,
                  style: TextStyle(
                      color: strong ? Brand.text : Brand.muted,
                      fontWeight: strong ? FontWeight.w700 : FontWeight.w500)),
            ),
            Text(value,
                textDirection: TextDirection.ltr, // figures read left to right
                style: TextStyle(
                    fontWeight: strong ? FontWeight.w800 : FontWeight.w600,
                    fontSize: strong ? 17 : 15,
                    color: tone ?? Brand.text)),
          ],
        ),
      );
}

class Panel extends StatelessWidget {
  const Panel({super.key, required this.title, required this.children, this.note});

  final String title;
  final List<Widget> children;
  final String? note;

  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(bottom: Brand.s16),
        child: Padding(
          padding: const EdgeInsets.all(Brand.s16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(title,
                  style: const TextStyle(
                      fontSize: 18, fontWeight: FontWeight.w800)),
              if (note != null) ...[
                const SizedBox(height: Brand.s4),
                Text(note!,
                    style: const TextStyle(color: Brand.muted, fontSize: 13, height: 1.7)),
              ],
              const SizedBox(height: Brand.s8),
              ...children,
            ],
          ),
        ),
      );
}

/// المركز المالي — the two units seen together, and the linkage stated on
/// screen rather than merely implied.
class PositionView extends StatelessWidget {
  const PositionView({super.key, required this.store});
  final Store store;

  @override
  Widget build(BuildContext context) {
    final p = store.position;
    final profit = p.portfolio.profitFils;
    return ListView(
      padding: const EdgeInsets.all(Brand.s16),
      children: [
        Panel(title: 'المركز المالي الموحد', children: [
          StatRow('قيمة المحفظة (د.ك)', formatKwd(p.portfolio.marketValueFils)),
          StatRow('ربح/خسارة المحفظة (د.ك)', formatKwd(profit, signed: profit > 0),
              tone: profit < 0 ? Brand.danger : Brand.good),
          StatRow('إيراد التوصيل (د.ك)', formatKwd(p.delivery.revenueFils)),
          StatRow('الطلبات قيد التنفيذ', '${p.delivery.inProgress}'),
          const Divider(height: Brand.s24),
          StatRow('إجمالي الموارد (د.ك)',
              formatKwd(p.totalResourcesFils), strong: true),
        ]),
        Panel(
          title: 'كيف تترابط الوحدات',
          note: 'هذه الأرقام تُشتق مباشرة من صافي والتوصيل، وتُغذّي القوائم '
              'المالية في تبويب XBRL. يمكنك دائماً تعديلها يدوياً بعد ذلك.',
          children: [
            StatRow('صافي — القيمة السوقية ← الأصول غير المتداولة',
                formatKwd(p.portfolio.marketValueFils)),
            StatRow('التوصيل — الطلبات المسلَّمة ← الإيرادات',
                formatKwd(p.delivery.revenueFils)),
          ],
        ),
      ],
    );
  }
}

class SafiView extends StatelessWidget {
  const SafiView({super.key, required this.store});
  final Store store;

  @override
  Widget build(BuildContext context) {
    final t = store.portfolio;
    return ListView(
      padding: const EdgeInsets.all(Brand.s16),
      children: [
        Panel(title: 'المحفظة', children: [
          StatRow('التكلفة (د.ك)', formatKwd(t.costFils)),
          StatRow('القيمة السوقية (د.ك)', formatKwd(t.marketValueFils)),
          StatRow('ربح/خسارة (د.ك)', formatKwd(t.profitFils, signed: t.profitFils > 0),
              strong: true,
              tone: t.profitFils < 0 ? Brand.danger : Brand.good),
        ]),
        for (final h in store.holdings)
          Card(
            margin: const EdgeInsets.only(bottom: Brand.s12),
            child: ListTile(
              title: Text(h.ticker,
                  textDirection: TextDirection.ltr,
                  style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text('${h.name} · ${h.quantity} سهم',
                  style: const TextStyle(color: Brand.muted)),
              trailing: Text(
                formatKwd(h.profitFils, signed: h.profitFils > 0),
                textDirection: TextDirection.ltr,
                style: TextStyle(
                    fontWeight: FontWeight.w800,
                    color: h.profitFils < 0 ? Brand.danger : Brand.good),
              ),
            ),
          ),
      ],
    );
  }
}

class XbrlView extends StatelessWidget {
  const XbrlView({super.key, required this.store});
  final Store store;

  @override
  Widget build(BuildContext context) {
    final f = store.filing;
    return ListView(
      padding: const EdgeInsets.all(Brand.s16),
      children: [
        Panel(
          title: 'الميزانية السنوية',
          note: 'كل مجموع فرعي يُحسب من البنود، ولا يُكتب يدوياً. الاعتماد '
              'النهائي يتم عبر بوابة وزارة التجارة والصناعة.',
          children: [
            StatRow('الأصول المتداولة', formatKwd(f.currentAssets)),
            StatRow('الأصول غير المتداولة', formatKwd(f.nonCurrentAssets)),
            StatRow('إجمالي الأصول', formatKwd(f.totalAssets), strong: true),
            const Divider(height: Brand.s24),
            StatRow('إجمالي الالتزامات', formatKwd(f.totalLiabilities)),
            StatRow('حقوق الملكية', formatKwd(f.equity), strong: true),
            const Divider(height: Brand.s24),
            StatRow('صافي الربح', formatKwd(f.netIncome),
                strong: true,
                tone: f.netIncome < 0 ? Brand.danger : Brand.good),
          ],
        ),
        Panel(
          title: f.balances ? 'الميزانية متوازنة ✔' : 'الميزانية غير متوازنة',
          children: [
            for (final finding in f.audit())
              Padding(
                padding: const EdgeInsets.symmetric(vertical: Brand.s4),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      switch (finding.level) {
                        FindingLevel.error => Icons.error_outline,
                        FindingLevel.warning => Icons.warning_amber_outlined,
                        FindingLevel.suggestion => Icons.lightbulb_outline,
                      },
                      size: 18,
                      color: switch (finding.level) {
                        FindingLevel.error => Brand.danger,
                        FindingLevel.warning => Brand.sandVivid,
                        FindingLevel.suggestion => Brand.tint,
                      },
                    ),
                    const SizedBox(width: Brand.s8),
                    Expanded(child: Text(finding.message, style: const TextStyle(height: 1.7))),
                    if (finding.amountFils != null)
                      Text(formatKwd(finding.amountFils!.abs()),
                          textDirection: TextDirection.ltr,
                          style: const TextStyle(fontWeight: FontWeight.w700)),
                  ],
                ),
              ),
          ],
        ),
      ],
    );
  }
}

class DeliveryView extends StatelessWidget {
  const DeliveryView({super.key, required this.store});
  final Store store;

  @override
  Widget build(BuildContext context) {
    final t = store.delivery;
    return ListView(
      padding: const EdgeInsets.all(Brand.s16),
      children: [
        Panel(title: 'الطلبات', children: [
          StatRow('إجمالي الطلبات', '${t.total}'),
          StatRow('قيد التنفيذ', '${t.inProgress}'),
          StatRow('تم التسليم', '${t.delivered}'),
          StatRow('الإيراد المسلَّم (د.ك)', formatKwd(t.revenueFils), strong: true),
        ]),
        for (final o in store.orders)
          Card(
            margin: const EdgeInsets.only(bottom: Brand.s12),
            child: ListTile(
              title: Text(o.id, textDirection: TextDirection.ltr,
                  style: const TextStyle(fontWeight: FontWeight.w800)),
              subtitle: Text('${o.customer} · ${o.status.arabic}',
                  style: const TextStyle(color: Brand.muted)),
              trailing: o.status.next == null
                  ? Text(formatKwd(o.amountFils), textDirection: TextDirection.ltr)
                  : FilledButton(
                      onPressed: () => store.advance(o.id),
                      child: Text(o.status.next!.arabic),
                    ),
            ),
          ),
      ],
    );
  }
}
