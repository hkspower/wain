/// The forms that put records in.
///
/// Amounts are typed in dinars and stored in fils. The conversion happens once,
/// here, at the boundary — a screen that passes a decimal inward is how the
/// float creeps back into a balance sheet.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/models.dart';
import '../core/money.dart';
import '../core/xbrl.dart';
import '../store.dart';
import 'brand.dart';

/// A money field that refuses what it cannot store, rather than accepting it
/// and rounding silently.
class MoneyField extends StatelessWidget {
  const MoneyField({
    super.key,
    required this.controller,
    required this.label,
    this.autofocus = false,
  });

  final TextEditingController controller;
  final String label;
  final bool autofocus;

  @override
  Widget build(BuildContext context) => TextFormField(
        controller: controller,
        autofocus: autofocus,
        textDirection: TextDirection.ltr,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        inputFormatters: [
          // Arabic-Indic digits are allowed through: an Arabic keyboard emits
          // them, and parseKwdToFils understands them.
          FilteringTextInputFormatter.allow(RegExp(r'[0-9٠-٩.,٫]')),
        ],
        decoration: InputDecoration(
            labelText: label, border: const OutlineInputBorder()),
        validator: (v) {
          final fils = parseKwdToFils(v ?? '');
          if (fils == null) return 'أدخل مبلغاً صحيحاً (مثال 12.500)';
          if (fils < 0) return 'المبلغ لا يكون سالباً';
          return null;
        },
      );
}

Future<void> showAddHolding(BuildContext context, Store store) async {
  final formKey = GlobalKey<FormState>();
  final ticker = TextEditingController();
  final name = TextEditingController();
  final qty = TextEditingController();
  final cost = TextEditingController();
  final price = TextEditingController();

  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) => Padding(
      padding: EdgeInsets.only(
        left: Brand.s20, right: Brand.s20, top: Brand.s20,
        bottom: MediaQuery.viewInsetsOf(sheetContext).bottom + Brand.s20,
      ),
      child: Form(
        key: formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('إضافة سهم',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: Brand.s16),
            TextFormField(
              controller: ticker,
              autofocus: true,
              textDirection: TextDirection.ltr,
              textCapitalization: TextCapitalization.characters,
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9]')),
                LengthLimitingTextInputFormatter(12),
              ],
              decoration: const InputDecoration(
                  labelText: 'الرمز', border: OutlineInputBorder()),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'الرمز مطلوب' : null,
            ),
            const SizedBox(height: Brand.s12),
            TextFormField(
              controller: name,
              decoration: const InputDecoration(
                  labelText: 'اسم الشركة', border: OutlineInputBorder()),
            ),
            const SizedBox(height: Brand.s12),
            TextFormField(
              controller: qty,
              textDirection: TextDirection.ltr,
              keyboardType: TextInputType.number,
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9٠-٩]'))],
              decoration: const InputDecoration(
                  labelText: 'الكمية', border: OutlineInputBorder()),
              validator: (v) {
                final n = parseKwdToFils(v ?? '');
                if (n == null || n <= 0) return 'أدخل كمية أكبر من صفر';
                return null;
              },
            ),
            const SizedBox(height: Brand.s12),
            MoneyField(controller: cost, label: 'متوسط التكلفة للسهم (د.ك)'),
            const SizedBox(height: Brand.s12),
            MoneyField(controller: price, label: 'السعر الحالي للسهم (د.ك)'),
            const SizedBox(height: Brand.s20),
            FilledButton(
              style: FilledButton.styleFrom(
                  backgroundColor: Brand.tintStrong,
                  padding: const EdgeInsets.symmetric(vertical: Brand.s16)),
              onPressed: () async {
                if (!formKey.currentState!.validate()) return;
                // Quantity is a count, so its "fils" value divided back down
                // is the whole number the person typed.
                final q = parseKwdToFils(qty.text)! ~/ filsPerKwd;
                await store.addHolding(Holding(
                  ticker: ticker.text.trim().toUpperCase(),
                  name: name.text.trim(),
                  quantity: q,
                  avgCostFils: parseKwdToFils(cost.text)!,
                  priceFils: parseKwdToFils(price.text)!,
                ));
                if (sheetContext.mounted) Navigator.pop(sheetContext);
              },
              child: const Text('حفظ'),
            ),
          ],
        ),
      ),
    ),
  );
}

Future<void> showAddOrder(BuildContext context, Store store) async {
  final formKey = GlobalKey<FormState>();
  final customer = TextEditingController();
  final phone = TextEditingController();
  final amount = TextEditingController();

  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    builder: (sheetContext) => Padding(
      padding: EdgeInsets.only(
        left: Brand.s20, right: Brand.s20, top: Brand.s20,
        bottom: MediaQuery.viewInsetsOf(sheetContext).bottom + Brand.s20,
      ),
      child: Form(
        key: formKey,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('طلب جديد',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: Brand.s16),
            TextFormField(
              controller: customer,
              autofocus: true,
              decoration: const InputDecoration(
                  labelText: 'اسم العميل', border: OutlineInputBorder()),
              validator: (v) =>
                  (v == null || v.trim().isEmpty) ? 'الاسم مطلوب' : null,
            ),
            const SizedBox(height: Brand.s12),
            TextFormField(
              controller: phone,
              textDirection: TextDirection.ltr,
              keyboardType: TextInputType.phone,
              decoration: const InputDecoration(
                  labelText: 'الهاتف', border: OutlineInputBorder()),
              validator: (v) => (v == null || v.trim().length < 6)
                  ? 'رقم الهاتف قصير'
                  : null,
            ),
            const SizedBox(height: Brand.s12),
            MoneyField(controller: amount, label: 'المبلغ (د.ك)'),
            const SizedBox(height: Brand.s20),
            FilledButton(
              style: FilledButton.styleFrom(
                  backgroundColor: Brand.tintStrong,
                  padding: const EdgeInsets.symmetric(vertical: Brand.s16)),
              onPressed: () async {
                if (!formKey.currentState!.validate()) return;
                await store.addOrder(
                  customer: customer.text.trim(),
                  phone: phone.text.trim(),
                  amountFils: parseKwdToFils(amount.text)!,
                );
                if (sheetContext.mounted) Navigator.pop(sheetContext);
              },
              child: const Text('إنشاء الطلب'),
            ),
          ],
        ),
      ),
    ),
  );
}

/// The balance sheet's own inputs.
///
/// Until this existed the XBRL unit could only *display* a filing derived from
/// صافي and التوصيل: there was no way to enter capital, cash, payables or the
/// financial year end, so the one thing the unit is for — producing a filing —
/// could not be reached. Only the typed lines appear here. Every subtotal is
/// computed by [Filing] and is not on this form, because a computed total is a
/// statement total, not another input.
Future<void> showFilingForm(BuildContext context, Store store) async {
  final f = store.filing.input;
  final form = GlobalKey<FormState>();
  final entity = TextEditingController(text: f.entityName);
  final cr = TextEditingController(text: f.commercialRegistration);
  var end = f.periodEndOrNull;
  var kind = f.kind;

  TextEditingController money(int fils) =>
      TextEditingController(text: fils == 0 ? '' : formatKwd(fils));
  final fields = <String, TextEditingController>{
    'النقد وما في حكمه': money(f.cashFils),
    'ذمم مدينة تجارية': money(f.receivablesFils),
    'المخزون': money(f.inventoryFils),
    'ممتلكات ومعدات': money(f.ppeFils),
    'دائنون وذمم دائنة': money(f.payablesFils),
    'قروض قصيرة الأجل': money(f.shortBorrowingsFils),
    'قروض طويلة الأجل': money(f.longBorrowingsFils),
    'مخصص مكافأة نهاية الخدمة': money(f.endOfServiceFils),
    'رأس المال المدفوع': money(f.capitalFils),
    'الاحتياطي القانوني': money(f.statutoryReserveFils),
    'أرباح (خسائر) مرحّلة': money(f.retainedEarningsFils),
    'تكلفة الإيرادات': money(f.costOfSalesFils),
    'مصاريف إدارية وعمومية': money(f.expensesFils),
  };

  await showDialog<void>(
    context: context,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setLocal) => AlertDialog(
        title: const Text('بيانات الميزانية'),
        content: SizedBox(
          width: 460,
          child: Form(
            key: form,
            child: SingleChildScrollView(
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                TextFormField(
                  controller: entity,
                  decoration: const InputDecoration(
                      labelText: 'اسم الشركة كما في السجل',
                      border: OutlineInputBorder()),
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'الاسم مطلوب' : null,
                ),
                const SizedBox(height: Brand.s12),
                TextFormField(
                  controller: cr,
                  textDirection: TextDirection.ltr,
                  inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                  decoration: const InputDecoration(
                      labelText: 'رقم السجل التجاري',
                      border: OutlineInputBorder()),
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'رقم السجل مطلوب' : null,
                ),
                const SizedBox(height: Brand.s12),
                // A filing with no period is not a filing, and today's date is
                // not a financial year end — so this stays empty until set.
                InputDecorator(
                  decoration: InputDecoration(
                    labelText: 'نهاية السنة المالية',
                    border: const OutlineInputBorder(),
                    errorText: end == null ? 'التاريخ مطلوب للإيداع' : null,
                  ),
                  child: Row(children: [
                    Expanded(
                      child: Text(end == null
                          ? '—'
                          : '${end!.year}-${end!.month.toString().padLeft(2, '0')}'
                              '-${end!.day.toString().padLeft(2, '0')}'),
                    ),
                    TextButton(
                      onPressed: () async {
                        final now = DateTime.now();
                        final picked = await showDatePicker(
                          context: ctx,
                          initialDate: end ?? DateTime.utc(now.year - 1, 12, 31),
                          firstDate: DateTime.utc(2015, 1, 1),
                          lastDate: DateTime.utc(now.year + 1, 12, 31),
                        );
                        if (picked != null) {
                          // UTC throughout: local midnight shifts the date east
                          // of Greenwich and files the wrong year end.
                          setLocal(() => end = DateTime.utc(
                              picked.year, picked.month, picked.day));
                        }
                      },
                      child: const Text('اختر'),
                    ),
                  ]),
                ),
                const SizedBox(height: Brand.s12),
                DropdownButtonFormField<EntityKind>(
                  initialValue: kind,
                  decoration: const InputDecoration(
                      labelText: 'الكيان القانوني',
                      border: OutlineInputBorder()),
                  items: const [
                    DropdownMenuItem(
                        value: EntityKind.wll,
                        child: Text('ذات مسؤولية محدودة (ذ.م.م)')),
                    DropdownMenuItem(
                        value: EntityKind.kscc,
                        child: Text('مساهمة مقفلة (ك.م.م)')),
                    DropdownMenuItem(
                        value: EntityKind.listed,
                        child: Text('مساهمة مدرجة (ش.م.ك.ع)')),
                  ],
                  onChanged: (v) => setLocal(() => kind = v ?? kind),
                ),
                for (final e in fields.entries) ...[
                  const SizedBox(height: Brand.s12),
                  MoneyField(controller: e.value, label: '${e.key} (د.ك)'),
                ],
              ]),
            ),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx), child: const Text('إلغاء')),
          FilledButton(
            onPressed: () async {
              if (!form.currentState!.validate() || end == null) return;
              int v(String k) => parseKwdToFils(fields[k]!.text) ?? 0;
              await store.updateFiling(FilingInput(
                entityName: entity.text.trim(),
                commercialRegistration: cr.text.trim(),
                periodEnd: end,
                kind: kind,
                cashFils: v('النقد وما في حكمه'),
                receivablesFils: v('ذمم مدينة تجارية'),
                inventoryFils: v('المخزون'),
                ppeFils: v('ممتلكات ومعدات'),
                // صافي feeds this line; the form never types over it
                investmentsFils: store.position.portfolio.marketValueFils,
                payablesFils: v('دائنون وذمم دائنة'),
                shortBorrowingsFils: v('قروض قصيرة الأجل'),
                longBorrowingsFils: v('قروض طويلة الأجل'),
                endOfServiceFils: v('مخصص مكافأة نهاية الخدمة'),
                capitalFils: v('رأس المال المدفوع'),
                statutoryReserveFils: v('الاحتياطي القانوني'),
                retainedEarningsFils: v('أرباح (خسائر) مرحّلة'),
                // التوصيل feeds revenue, the same way
                revenueFils: store.position.delivery.revenueFils,
                costOfSalesFils: v('تكلفة الإيرادات'),
                expensesFils: v('مصاريف إدارية وعمومية'),
              ));
              if (ctx.mounted) Navigator.pop(ctx);
            },
            child: const Text('حفظ'),
          ),
        ],
      ),
    ),
  );
}

/// Ask before destroying a record. Returns true only on a deliberate yes.
Future<bool> confirmDestructive(
    BuildContext context, String title, String body) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(title),
      content: Text(body),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('تراجع')),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: Brand.danger),
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('تأكيد'),
        ),
      ],
    ),
  );
  return ok ?? false;
}
