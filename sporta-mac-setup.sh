#!/usr/bin/env bash
# Sporta — set up this project on your Mac, so Claude Code runs ON the machine
# that can actually reach Hostinger.
#
#   bash ~/Downloads/sporta-mac-setup.sh
#
# WHY THIS EXISTS
# Claude's session runs in a sandbox with no network route to your server —
# not FTP, not the live site, nothing. It builds and verifies, and you upload.
# Running Claude Code on your Mac removes that split: the same conversation can
# then publish, read the live site, and check the server for itself.
#
# This script only installs the PROJECT's own dependencies. It does not install
# Node, Homebrew or Claude Code, and it never touches system settings — it
# checks for them and tells you the one command to run if something is missing.
# Nothing here asks for a password or writes a credential.

set -uo pipefail

REPO_SSH="git@github.com:hkspower/wain.git"
REPO_HTTPS="https://github.com/hkspower/wain.git"
BRANCH="claude/sporta-integration-tveo8b"
DIR="${SPORTA_DIR:-$HOME/sporta}"

g() { printf '\033[32m%s\033[0m\n' "$*"; }
y() { printf '\033[33m%s\033[0m\n' "$*"; }
r() { printf '\033[31m%s\033[0m\n' "$*"; }
b() { printf '\n\033[1m%s\033[0m\n' "$*"; }

missing=0
need() {                      # need <command> <what to run to get it>
  if command -v "$1" >/dev/null 2>&1; then
    g "  ok    $1  ($(command -v "$1"))"
  else
    r "  MISSING  $1"
    y "           $2"
    missing=1
  fi
}

b "1. Tools this needs"
need git    "Install Xcode command line tools:  xcode-select --install"
need node   "Install Node 24 LTS from https://nodejs.org  (or: brew install node@24)"
need npm    "Comes with Node — install Node first."

if command -v node >/dev/null 2>&1; then
  major=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
  # Vite 8 will not run on older Node. Saying so now beats a confusing build
  # error twenty minutes from now.
  if [ "$major" -ge 22 ]; then
    g "  ok    node $(node -v) is new enough (needs 22.12+, 24 LTS is what this is tested on)"
  else
    r "  node $(node -v) is too old — Vite 8 needs 22.12 or newer"
    y "        Install Node 24 LTS from https://nodejs.org"
    missing=1
  fi
fi

b "2. Claude Code"
if command -v claude >/dev/null 2>&1; then
  g "  ok    claude  ($(command -v claude))"
else
  y "  not installed — this is the part that gives you a full-time connection."
  y "  Install it with:"
  y "        npm install -g @anthropic-ai/claude-code"
  y "  or use the desktop app from https://claude.com/claude-code"
fi

[ "$missing" -eq 1 ] && { r $'\nInstall what is marked MISSING above, then run this again.'; exit 1; }

b "3. The project"
if [ -d "$DIR/.git" ]; then
  g "  found $DIR — updating"
  git -C "$DIR" fetch origin "$BRANCH" --quiet && \
  git -C "$DIR" checkout "$BRANCH" --quiet 2>/dev/null && \
  git -C "$DIR" pull --ff-only origin "$BRANCH" --quiet && g "  up to date on $BRANCH" \
    || y "  could not fast-forward — you may have local changes. Run: git -C $DIR status"
else
  g "  cloning into $DIR"
  git clone --branch "$BRANCH" "$REPO_SSH" "$DIR" --quiet 2>/dev/null \
    || git clone --branch "$BRANCH" "$REPO_HTTPS" "$DIR" --quiet \
    || { r "  clone failed — check you have access to hkspower/wain"; exit 1; }
fi

b "4. Dependencies"
( cd "$DIR/sporta-web" && npm install --silent ) && g "  installed" || { r "  npm install failed"; exit 1; }

b "5. Publish credentials"
ENVF="$DIR/sporta-web/.env.deploy"
if [ -f "$ENVF" ]; then
  g "  $ENVF exists"
else
  cp "$DIR/sporta-web/.env.deploy.example" "$ENVF"
  y "  created $ENVF from the template."
  y "  Open it and paste FTP_HOST, FTP_USER and FTP_PASSWORD from"
  y "  hPanel -> Files -> FTP Accounts. It is git-ignored; it never leaves your Mac."
fi

b "6. Which FTP host works"
if grep -q '^FTP_USER=.\+' "$ENVF" 2>/dev/null; then
  ( cd "$DIR/sporta-web" && node scripts/ftp-doctor.mjs ) || true
else
  y "  skipped — fill in $ENVF first, then run:"
  y "        cd $DIR/sporta-web && npm run ftp:doctor -- --write"
fi

b "Done"
cat <<EOF
  The project is at:   $DIR

  Start Claude Code there, and it can do the whole job in one place —
  build, publish, and check the live site:

      cd $DIR
      claude

  Or publish by hand, without Claude:

      cd $DIR/sporta-web
      npm run publish:dry     # shows what would change, uploads nothing
      npm run publish

  The database is separate: product and price changes go in through the
  admin at /backends, or phpMyAdmin in hPanel — not over FTP.
EOF
