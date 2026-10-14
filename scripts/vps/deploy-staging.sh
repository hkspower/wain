#!/usr/bin/env bash
# Build wain on the VPS and send it to staging.wainkw.com.
#
#   bash deploy-staging.sh            # builds the branch head and deploys to staging
#   bash deploy-staging.sh --build    # builds and prints the zip, sends nothing
#
# Production (www.wainkw.com) is NOT reachable from this script. Promoting a
# staged build is a separate, deliberate step, so this only ever talks to staging.
#
# What it does, in order:
#   fetch the branch → build with `npm run release` → zip → copy into the release
#   directory → sign the request with the staging secret → POST to the site's
#   own endpoint. The endpoint downloads the zip from this VPS, checks its
#   sha256 before writing anything, and publishes it atomically.

set -euo pipefail

BRANCH="claude/wainkw-design-issues-2bggdi"
REPO_DIR=/root/wain-deploy/src
SECRET_FILE=/root/wain-deploy/staging.secret
RELEASE_DIR=/var/www/wain-releases
RELEASE_BASE="https://srv2058651.hstgr.cloud/releases"
ENDPOINT="https://staging.wainkw.com/api/deploy.php"

BUILD_ONLY=0
[ "${1:-}" = "--build" ] && BUILD_ONLY=1

if [ ! -d "$REPO_DIR/.git" ]; then
  echo "No repo at $REPO_DIR. Run setup-vps.sh first." >&2
  exit 1
fi
if [ "$BUILD_ONLY" -eq 0 ]; then
  if [ ! -f "$SECRET_FILE" ]; then
    echo "Missing $SECRET_FILE (the staging deploy secret). See docs/vps.md." >&2
    exit 1
  fi
  mode=$(stat -c '%a' "$SECRET_FILE")
  if [ "$mode" != "600" ]; then
    echo "$SECRET_FILE must be mode 600 (it is $mode)." >&2
    exit 1
  fi
fi

echo "== fetch $BRANCH"
cd "$REPO_DIR"
git fetch --quiet origin "$BRANCH"
git checkout --quiet -B "$BRANCH" "origin/$BRANCH"
git reset --quiet --hard "origin/$BRANCH"
git clean -fdq
SHA=$(git rev-parse HEAD)
SHORT=${SHA:0:7}
echo "commit $SHA"

echo "== install and build"
npm ci --silent
npm run release

VERSION=$(node -p 'require("./package.json").version')
ZIP_SRC="$REPO_DIR/wain-$VERSION.zip"
if [ ! -f "$ZIP_SRC" ]; then
  echo "expected $ZIP_SRC after the build" >&2
  exit 1
fi

# The zip name in the URL carries the commit, so two builds of one version never
# share a URL and a cached copy cannot be served for the wrong build.
NAME="wain-$VERSION-$SHORT.zip"
cp "$ZIP_SRC" "$RELEASE_DIR/$NAME"
URL="$RELEASE_BASE/$NAME"
SHA256=$(sha256sum "$RELEASE_DIR/$NAME" | cut -d' ' -f1)
echo "artifact $URL"
echo "sha256   $SHA256"

if [ "$BUILD_ONLY" -eq 1 ]; then
  echo "build only: nothing sent"
  exit 0
fi

echo "== send to staging"
TS=$(date +%s)
# The signed body is the exact bytes that get sent. Signing and sending from one
# variable is what keeps the HMAC honest.
BODY=$(printf '{"url":"%s","sha256":"%s","version":"%s","ts":%s}' "$URL" "$SHA256" "$VERSION" "$TS")
SECRET=$(tr -d '\n' < "$SECRET_FILE")
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
unset SECRET

RESPONSE=$(curl -sS --max-time 300 -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "X-Deploy-Signature: sha256=$SIG" \
  --data-binary "$BODY")
echo "$RESPONSE"

case "$RESPONSE" in
  *'"ok":true'*) echo "== staged $SHORT on staging.wainkw.com" ;;
  *) echo "== staging did not accept the deploy" >&2; exit 1 ;;
esac
