/// Kuwaiti money, in fils.
///
/// The web build learned this the hard way: a portfolio held in floating point
/// drifts, and a balance sheet that is out by 0.001 د.ك is a balance sheet that
/// cannot be filed. Everything here is integer fils (1 KWD = 1000 fils) and
/// only becomes a decimal at the moment it is printed.
library;

/// One Kuwaiti dinar in fils.
const int filsPerKwd = 1000;

/// Format fils as KWD with the three decimals Kuwait uses.
///
/// The locale is pinned to en-US style grouping on purpose: a bare
/// `toStringAsFixed` under an Arabic locale prints Arabic-Indic digits, and the
/// web build once showed ١٢٬٠٠٠ next to 850 in the same table.
String formatKwd(int fils, {bool signed = false}) {
  final negative = fils < 0;
  final abs = fils.abs();
  final whole = abs ~/ filsPerKwd;
  final part = abs % filsPerKwd;
  final grouped = _group(whole);
  final sign = negative ? '−' : (signed ? '+' : '');
  return '$sign$grouped.${part.toString().padLeft(3, '0')}';
}

String _group(int n) {
  final s = n.toString();
  final out = StringBuffer();
  for (var i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 == 0) out.write(',');
    out.write(s[i]);
  }
  return out.toString();
}

/// Parse a typed amount ("12.500", "12", "١٢") into fils.
///
/// Accepts Arabic-Indic digits because a phone keyboard set to Arabic produces
/// them, and refusing the customer's own numerals is not a validation rule, it
/// is a bug.
int? parseKwdToFils(String raw) {
  var s = raw.trim();
  if (s.isEmpty) return null;
  const arabicIndic = '٠١٢٣٤٥٦٧٨٩';
  final buf = StringBuffer();
  for (final rune in s.runes) {
    final ch = String.fromCharCode(rune);
    final ai = arabicIndic.indexOf(ch);
    buf.write(ai >= 0 ? ai.toString() : ch);
  }
  s = buf.toString().replaceAll(',', '').replaceAll('٫', '.');
  final negative = s.startsWith('-');
  if (negative) s = s.substring(1);
  if (!RegExp(r'^\d*\.?\d*$').hasMatch(s) || s == '.' || s.isEmpty) return null;
  final parts = s.split('.');
  final whole = parts[0].isEmpty ? 0 : int.parse(parts[0]);
  var frac = parts.length > 1 ? parts[1] : '';
  if (frac.length > 3) return null; // more precision than a fils exists
  frac = frac.padRight(3, '0');
  final fils = whole * filsPerKwd + (frac.isEmpty ? 0 : int.parse(frac));
  return negative ? -fils : fils;
}
