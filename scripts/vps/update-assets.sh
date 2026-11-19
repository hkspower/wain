#!/bin/sh
# Put this repository's static assets (scripts/vps/assets.manifest: brand/,
# find/, home/ without the landmark stand-ins, og/, og.jpg, icon.svg,
# apple-icon.png) into www.wainkw.com's public_html on the VPS, then rebuild
# only the `wain` container. Run as root on the VPS, or from a container with
# /docker/apache and the Docker socket mounted:
#
#   sh update-assets.sh               # look only: compare, change nothing
#   CONFIRM=yes sh update-assets.sh   # back up, write, rebuild wain, check
#
# It only adds or replaces the files the manifest names. It never deletes:
# a file of the owner's that the manifest does not name is listed, not touched.
# www runs the owner's own source (1 November), so read the «changed» list
# before CONFIRM=yes: each of those overwrites a file the owner put there.
#
# It stops, changing nothing, when the site folder or its Dockerfile is
# missing, a download does not match its sha256, or public_html/ holds other
# changes the running site does not serve (a rebuild would publish them too).
set -eu
SITE=${SITE:-/docker/apache/sites/wainkw.com}
COMPOSE=${COMPOSE:-/docker/apache/docker-compose.yml}
REF=a00e5edbc4f55e79851d321669a6e79fd131064f
RAW=https://raw.githubusercontent.com/hkspower/wain/$REF
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
die() { echo "STOP: $*" >&2; exit 1; }

[ -d "$SITE/public_html" ] || die "$SITE/public_html not found"
grep -q "^COPY public_html/ " "$SITE/Dockerfile" || die "the Dockerfile no longer copies public_html/"

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
curl -fsS -o "$WORK/manifest" "$RAW/scripts/vps/assets.manifest" || die "could not download the manifest"

new=0; same=0; changed=0
: >"$WORK/changed"; : >"$WORK/new"
while read -r sum src dest; do
  live="$SITE/public_html/$dest"
  if [ ! -f "$live" ]; then new=$((new + 1)); echo "$dest" >>"$WORK/new"
  elif [ "$(sha256sum "$live" | cut -c1-64)" = "$sum" ]; then same=$((same + 1))
  else changed=$((changed + 1)); echo "$dest" >>"$WORK/changed"; fi
done <"$WORK/manifest"
echo "== assets: $same already the same, $new new, $changed would replace a different file"
[ "$changed" -eq 0 ] || { echo "== would replace:"; sed 's/^/   /' "$WORK/changed"; }
[ "$new" -eq 0 ] || { echo "== new:"; head -40 "$WORK/new" | sed 's/^/   /'; }

# Files of the owner's in the same folders that the manifest does not name.
cut -d' ' -f3 "$WORK/manifest" | sort >"$WORK/named"
(cd "$SITE/public_html" && for d in brand find home og; do [ -d "$d" ] && find "$d" -type f; done) \
  | sort | comm -23 - "$WORK/named" >"$WORK/owner" || true
echo "== owner files in those folders, left alone: $(grep -c . "$WORK/owner" || true)"
head -20 "$WORK/owner" | sed 's/^/   /'

# A rebuild publishes the whole folder: compare it with the running site,
# the manifest's paths excepted.
running=$(docker ps -q -f label=com.docker.compose.project=apache -f label=com.docker.compose.service=wain | head -1)
[ -n "$running" ] || die "no running wain container to compare the folder with"
docker exec "$running" sh -c 'cd /var/www/html && find . -type f -exec sha256sum {} + 2>/dev/null' \
  | sed 's#  \./#  #' | awk 'NR==FNR{n[$0]=1;next} !($2 in n)' "$WORK/named" - | sort -k2 >"$WORK/image.sums"
(cd "$SITE/public_html" && find . -type f -exec sha256sum {} +) \
  | sed 's#  \./#  #' | awk 'NR==FNR{n[$0]=1;next} !($2 in n)' "$WORK/named" - | sort -k2 >"$WORK/folder.sums"
if cmp -s "$WORK/image.sums" "$WORK/folder.sums"; then
  echo "== public_html/ matches the running site apart from these assets"
else
  echo "== public_html/ differs from the running site elsewhere:"
  diff "$WORK/image.sums" "$WORK/folder.sums" | grep -E '^[<>]' | awk '{print $3}' | sort -u | head -40
  [ "${FORCE_REBUILD:-}" = "yes" ] || die "a rebuild would publish those too"
fi

[ $((new + changed)) -gt 0 ] || { echo "== nothing to update"; exit 0; }
[ "${CONFIRM:-}" = "yes" ] || { echo; echo "Looked only. To write: CONFIRM=yes sh $0"; exit 0; }

# Download and check every file before writing any of them.
mkdir -p "$WORK/files"
while read -r sum src dest; do
  cat "$WORK/new" "$WORK/changed" | grep -qxF "$dest" || continue
  mkdir -p "$WORK/files/$(dirname "$dest")"
  curl -fsS -o "$WORK/files/$dest" "$RAW/$src" || die "could not download $src"
  [ "$(sha256sum "$WORK/files/$dest" | cut -c1-64)" = "$sum" ] || die "$src does not match its sha256"
done <"$WORK/manifest"

BAK="$SITE/storage/asset-backups/$STAMP"
while read -r dest; do
  mkdir -p "$BAK/$(dirname "$dest")"
  cp -p "$SITE/public_html/$dest" "$BAK/$dest"
done <"$WORK/changed"
[ ! -s "$WORK/changed" ] || { chmod -R go-rwx "$SITE/storage/asset-backups"; echo "== backups in storage/asset-backups/$STAMP"; }
(cd "$WORK/files" && find . -type f) | while read -r f; do
  mkdir -p "$SITE/public_html/$(dirname "$f")"
  cp "$WORK/files/$f" "$SITE/public_html/$f"
done
echo "== wrote $((new + changed)) file(s)"

image=$(docker compose -f "$COMPOSE" config --images wain 2>/dev/null | head -1)
image=${image:-apache-wain}
docker build -q -t "$image" "$SITE"
docker compose -f "$COMPOSE" up -d --no-deps --force-recreate wain
W=$(docker ps -q -f label=com.docker.compose.project=apache -f label=com.docker.compose.service=wain | head -1)
i=0
until [ "$(docker inspect -f '{{.State.Health.Status}}' "$W")" = healthy ] || [ $i -ge 30 ]; do i=$((i + 1)); sleep 3; done
echo "== wain health: $(docker inspect -f '{{.State.Health.Status}}' "$W")"
bad=0
while read -r sum src dest; do
  got=$(docker exec "$W" sha256sum "/var/www/html/$dest" 2>/dev/null | cut -c1-64)
  [ "$got" = "$sum" ] || { bad=$((bad + 1)); echo "   not in the image as expected: $dest"; }
done <"$WORK/manifest"
echo "== in the image: $(( $(grep -c . "$WORK/manifest") - bad )) of $(grep -c . "$WORK/manifest") manifest files match"
echo "== og.jpg over the web: HTTP $(curl -s -o /dev/null -w '%{http_code}' https://www.wainkw.com/og.jpg)"
echo "Undo: copy storage/asset-backups/$STAMP/* back into public_html/, delete the new files listed above, rebuild wain."
