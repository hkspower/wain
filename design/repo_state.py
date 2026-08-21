#!/usr/bin/env python3
"""Where this checkout actually stands, before anything is built on it.

This container reverts its checkout between turns. It has happened at least
six times in this repository's history, and every time it looked exactly like
a normal working tree — the files are all there, git is happy, nothing warns
you. What it costs is only visible later:

  * work rebuilt from scratch because the tree silently lost it;
  * an audit run against code that is not the code that ships;
  * and once, a commit written on a fifteen-commit-old base, which would have
    reverted all fifteen had the push not been refused.

None of those is caught by a test, because none of them is a defect in the
code. They are defects in knowing which code you are looking at. So: run this
first, read the verdict, and only then start.

    python3 design/repo_state.py

Exit status is 0 when the tree is safe to work on and 1 when it is not, so it
can gate a script as well as inform a person.
"""
import subprocess
import sys


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True,
                          cwd="/home/user/wain").stdout.strip()


def main() -> int:
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    if not branch:
        print("not a git checkout at all")
        return 1

    # Ask the remote rather than trusting the local ref: a stale
    # origin/<branch> is exactly what makes a reverted checkout look current.
    subprocess.run(["git", "fetch", "--quiet", "origin", branch],
                   cwd="/home/user/wain",
                   capture_output=True, text=True, timeout=120)

    head = git("rev-parse", "HEAD")
    remote = git("rev-parse", f"origin/{branch}")
    dirty = git("status", "--porcelain")

    if not remote:
        print(f"branch {branch} has no origin counterpart — nothing to compare")
        return 0

    behind = git("rev-list", "--count", f"{head}..{remote}")
    ahead = git("rev-list", "--count", f"{remote}..{head}")
    behind, ahead = int(behind or 0), int(ahead or 0)

    print(f"branch   {branch}")
    print(f"HEAD     {head[:9]}  {git('log', '-1', '--format=%s')[:64]}")
    print(f"origin   {remote[:9]}")
    print(f"ahead {ahead} · behind {behind} · "
          f"{len(dirty.splitlines())} uncommitted file(s)")

    if behind and not ahead:
        print()
        print("BEHIND. This checkout is missing work that is already pushed.")
        print("Anything written on top of it is written on the wrong base.")
        print()
        print(f"  git checkout -B {branch} origin/{branch}")
        if dirty:
            print("  (stash or copy the uncommitted files first — listed above)")
        return 1

    if behind and ahead:
        print()
        print("DIVERGED. Local commits exist that the remote does not have,")
        print("and vice versa. Rebase rather than merge, then re-run this:")
        print()
        print(f"  git rebase origin/{branch}")
        return 1

    print()
    print("Safe to work on." if not dirty else
          "Safe to work on — with uncommitted changes already in the tree.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
