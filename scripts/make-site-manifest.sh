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

# AND A COMPLETE ONE, for api/file-audit.php.
#
# The manifest above is deliberately fetchable-only, because site-diff.sh works
# by downloading each file over HTTP and PHP can never be downloaded. A file
# audit running ON the server has no such limit — it reads the disk — and PHP
# is exactly what it most needs to check: a tampered admin.php is the finding
# worth having, and the fetchable manifest cannot see it.
#
# Written into the docroot because that is where file-audit.php looks for it,
# and it has to be uploaded anyway. It is denied over HTTP by NAME in
# api/.htaccess: a complete map of the server is not a thing to serve, and
# neither the root rule (whose extension list has no .txt) nor api's own list
# covered it — measured, it answered 200 until the name was added.
#
# It EXCLUDES config.php by name: a hash of the live credentials file would
# change every time a password rotates and report as damage, and this file is
# handed around.
find . -type f ! -name "config.php" ! -name "site-manifest.txt" ! -name "file-audit.php" \
  | sed 's#^\./##' | LC_ALL=C sort \
  | while read -r f; do printf '%s  %s\n' "$($SHA "$f" | cut -d' ' -f1)" "$f"; done \
  > api/site-manifest.txt
wc -l < api/site-manifest.txt | tr -d ' ' | xargs -I{} echo "{} files -> api/site-manifest.txt (complete, for file-audit.php)"
