#!/bin/sh
# A stand-in for sendmail, for test servers only.
#
#   php -d sendmail_path="sh scripts/fake-mta.sh /path/to/maildir" -S ...
#
# PHP's mail() pipes the whole message (headers included) into this command,
# with any extra parameters (-f sender) appended after the maildir. Each
# message becomes one <nanoseconds>.eml file there, written under a temporary
# name and renamed, so a test counting *.eml never reads half a message.
#
# MTA_DELAY (seconds, may be fractional) stands in for a slow SMTP relay, for
# the checks that compare response times with and without a mail being sent.
set -eu
dir=$1
sleep "${MTA_DELAY:-0}"
f="$dir/$(date +%s%N).$$"
cat > "$f.tmp"
mv "$f.tmp" "$f.eml"
