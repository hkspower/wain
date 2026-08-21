/// Kuwaiti money, in fils.
///
/// The web build learned this the hard way: a portfolio held in floating point
/// drifts, and a balance sheet that is out by 0.001 د.ك is a balance sheet that
/// cannot be filed. Everything here is integer fils (1 KWD = 1000 fils) and
/// only becomes a decimal at the moment it is printed.
library;

/// One Kuwaiti dinar in fils.
const int filsPerKwd = 1000;

/// The largest whole dinar figure this app will accept. It exists to keep
/// `whole * filsPerKwd` inside a 64-bit int — above it the amount wraps and
/// becomes a negative number, which is worse than a refusal because it is
/// silent. A trillion dinars is several times Kuwait's money supply, so no
/// real entry is lost.
const int kMaxKwd = 1000000000000;

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
  var frac = parts.length > 1 ? parts[1] : '';
  if (frac.length > 3) return null; // more precision than a fils exists
  frac = frac.padRight(3, '0');

  // A digits-only string still breaks int.parse once it passes 2^63: it throws
  // FormatException, and this runs inside a TextFormField validator, so the
  // exception surfaces as a crash while the person is still typing. Nothing
  // stops them — the field's formatter allows digits, and twenty of them is
  // not a strange thing to hit by leaning on a key. tryParse returns null
  // instead of throwing, and the caller already treats null as "not a number".
  final whole = parts[0].isEmpty ? 0 : int.tryParse(parts[0]);
  final fracValue = frac.isEmpty ? 0 : int.tryParse(frac);
  if (whole == null || fracValue == null) return null;
  // and the multiplication has to stay inside 64 bits, or the amount silently
  // wraps to a negative one. A dinar figure this large is not a typo worth
  // accommodating: it is more than every bank in Kuwait.
  if (whole > kMaxKwd) return null;
  final fils = whole * filsPerKwd + fracValue;
  return negative ? -fils : fils;
}
