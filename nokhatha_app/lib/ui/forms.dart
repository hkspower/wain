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
