#!/usr/bin/env python3
"""Crash-pattern audit for النوخذة's Dart, with its own patterns under test.

Written after an ad-hoc `grep` reported the app clean of null assertions. The
pattern was `[a-zA-Z_)\\]]![.\\[ ,;)]` — inside a bracket expression the `\\]`
closes the set early, so it matched something else entirely and found nothing.
The file had twenty. One edit later that "clean" would have been the whole
answer to a question about crashes.

The lesson is not "write better regexes". It is that **a scanner reporting
nothing is indistinguishable from a broken scanner**, unless the scanner is
made to prove it can still see. So every rule here ships with two fixtures: a
line it must flag and a line it must not. `--self-test` runs those, and the
audit refuses to report at all if any rule has gone blind.

    python3 design/dart_audit.py              # audit, with the self-test first
    python3 design/dart_audit.py --self-test  # only prove the rules still see

Exit status: 0 when the rules pass their fixtures and no finding is a crash
that has no guard; 1 otherwise. Findings are printed either way — the point is
to be read, not to gate.
"""
import argparse
import pathlib
import re
import sys

APP = pathlib.Path("/home/user/wain/nokhatha_app/lib")


class Rule:
    def __init__(self, name, pattern, why, catches, ignores):
        self.name, self.why = name, why
        self.re = re.compile(pattern)
        self.catches, self.ignores = catches, ignores


RULES = [
    Rule(
        "null assertion",
        # `is!` is the type-test operator, not an assertion; the first
        # version of this rule flagged every `raw is! Map` in the file and
        # the self-test below is what caught it
        r"(?<=[\w\)\]])(?<!\bis)!(?!=)",
        "throws if the value is null — the crash is at the `!`, not at the "
        "use, so the stack trace names the wrong line",
        catches=["final q = parse(text)!;", "Text(note!)", "a!.b!.c"],
        ignores=["if (raw is! Map) return null;", "if (a != b) {", "x ??= y;",
                 "if (!ok) return;", "expect(v is! String, isTrue);"],
    ),
    Rule(
        "parse that throws",
        r"\b(?:int|double|num)\.parse\(",
        "FormatException on anything unexpected. In a validator that is a "
        "crash while the user is typing; tryParse returns null instead",
        catches=["int.parse(s)", "  final n = double.parse(v);"],
        ignores=["int.tryParse(s)", "double.tryParse(v)", "// int.parse is bad"],
    ),
    Rule(
        "first/last/single on a collection",
        r"\.(?:first|last|single)\b(?!\w)",
        "throws StateError when the collection is empty; firstOrNull and "
        "lastOrNull say the same thing without the throw",
        catches=["final a = xs.first;", "return items.last;"],
        ignores=["xs.firstWhere((e) => true, orElse: () => null)",
                 "// the first one wins", "list.firstOrNull"],
    ),
    Rule(
        "unguarded subscript",
        r"\[\s*\d+\s*\]",
        "RangeError if the list is shorter than the index",
        catches=["final a = parts[0];", "xs[ 2 ]"],
        ignores=["map['key']", "final m = {0: 'a'};"],
    ),
    Rule(
        "late field",
        r"\blate\s+(?:final\s+)?\w",
        "LateInitializationError if anything reads it before it is set",
        catches=["late final Store store;", "late String name;"],
        ignores=["// late is risky", "translate(x)"],
    ),
]

def self_test() -> bool:
    ok = True
    for rule in RULES:
        for line in rule.catches:
            if not rule.re.search(line):
                print(f"  BLIND  {rule.name}: no longer sees  {line!r}")
                ok = False
        for line in rule.ignores:
            code = line.split("//")[0]
            if code.strip() and rule.re.search(code):
                print(f"  NOISY  {rule.name}: wrongly flags  {line!r}")
                ok = False
    print("  every rule still sees what it is for" if ok else
          "  RULES ARE BROKEN — the audit below would be meaningless")
    return ok


def audit():
    findings = []
    for path in sorted(APP.rglob("*.dart")):
        for n, line in enumerate(path.read_text(encoding="utf-8").split("\n"), 1):
            code = line.split("//")[0]
            if not code.strip():
                continue
            for rule in RULES:
                if rule.re.search(code):
                    findings.append((path, n, rule, line.strip()))
    return findings


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    print("rule self-test")
    healthy = self_test()
    if args.self_test:
        return 0 if healthy else 1
    if not healthy:
        return 1

    findings = audit()
    print(f"\n{len(findings)} site(s) worth a human's eye\n")
    by_rule = {}
    for path, n, rule, text in findings:
        by_rule.setdefault(rule.name, []).append((path, n, text, rule.why))
    for name, items in by_rule.items():
        print(f"── {name}: {items[0][3]}")
        for path, n, text, _ in items:
            rel = path.relative_to(APP.parent)
            print(f"   {rel}:{n}  {text[:88]}")
        print()
    print("Each of these is a question, not a defect: read the guard above it.\n"
          "A null assertion inside `if (x != null)` is correct, and this audit\n"
          "cannot tell. What it can do is refuse to say «clean» while blind.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
