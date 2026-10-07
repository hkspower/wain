#!/usr/bin/env python3
"""npm run test:blender — the Blender version check."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import version  # noqa: E402

fail = []


def check(cond, msg):
    if not cond:
        fail.append(msg)


check(version.require((5, 0, 1)) == (5, 0, 1), "5.0.1 is rejected")
check(version.require((5, 2, 0)) == (5, 2, 0), "5.2.0 is rejected")
try:
    version.require((4, 5, 14))
    fail.append("4.5.14 is accepted")
except RuntimeError as e:
    check("requirements-blender.txt" in str(e), "the error does not say how to install")
try:
    got = version.require()
    print(f"installed bpy {'.'.join(map(str, got))} satisfies {'.'.join(map(str, version.MIN))}")
except Exception as e:  # noqa: BLE001
    fail.append(f"the installed bpy fails the check: {e}")

pinned = open(os.path.join(os.path.dirname(__file__), "..", "..", "requirements-blender.txt")).read()
check("bpy==" in pinned, "requirements-blender.txt does not pin bpy")

if fail:
    print("FAIL\n  " + "\n  ".join(fail))
    sys.exit(1)
print("ok")
