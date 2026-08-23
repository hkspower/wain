#!/usr/bin/env bash
# Writes scripts/site-manifest.txt: sha256 + path for every fetchable file of
# the website copy in this repo. site-diff.sh compares a live server to it.
#
# PHP files and .htaccess are left out on purpose: PHP is executed rather than
# served, so a fetch can never equal the source, and .htaccess is never served
# at all — site-diff.sh checks that one by its observable effects instead.
set -eu
cd "$(dirname "$0")/../sporta-site/public_html"
if command -v sha256sum >/dev/null 2>&1; then SHA=sha256sum; else SHA="shasum -a 256"; fi
find . -type f ! -name "*.php" ! -name ".htaccess" \
  | sed 's#^\./##' | LC_ALL=C sort \
  | while read -r f; do printf '%s  %s\n' "$($SHA "$f" | cut -d' ' -f1)" "$f"; done \
  > ../../scripts/site-manifest.txt
wc -l < ../../scripts/site-manifest.txt | tr -d ' ' | xargs -I{} echo "{} files -> scripts/site-manifest.txt"
