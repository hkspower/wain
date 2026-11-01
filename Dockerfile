# Static export of wain, served by Apache so the export's own .htaccess
# (security headers, cache rules, the Host-keyed noindex for staging) applies
# unchanged. There is NO apex -> www redirect in public/.htaccess; on the VPS
# that is Traefik's job (see the `apache` project's wain-apex router).
#
# Build from a pinned commit, never a branch:
#   docker build "https://github.com/hkspower/wain.git#<sha>"
# or through deploy/vps/docker-compose.yml, which does exactly that.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM php:8.3-apache
# The export's .htaccess uses rewrite, headers, expires and deflate; remoteip is
# for the proxy block below.
RUN a2enmod rewrite headers expires deflate mime setenvif remoteip \
 && sed -ri 's!AllowOverride None!AllowOverride All!' /etc/apache2/apache2.conf

# The bridges need these three. All ship with the official image today; asserting
# it makes a base-image change fail the BUILD instead of failing a visitor.
RUN php -r 'foreach (["curl","fileinfo","mbstring"] as $e) { if (!extension_loaded($e)) { fwrite(STDERR, "missing php extension: $e\n"); exit(1); } }'

# php.ini. The stock image ships none, so PHP runs on built-in defaults:
# upload_max_filesize 2M and post_max_size 8M, both UNDER media.php's 12M
# MAX_BYTES, which made every photo over 2 MB fail as file_too_large; and
# display_errors left on, which prints warnings into HTTP responses. The shared
# host ran 256M limits and display_errors Off, so this restores that, not more.
RUN cp "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \
 && printf '%s\n' \
      'upload_max_filesize = 16M' \
      'post_max_size = 20M' \
      'expose_php = Off' \
      'date.timezone = Asia/Kuwait' \
      > "$PHP_INI_DIR/conf.d/zz-wain.ini"

# Behind Traefik, REMOTE_ADDR is the docker gateway, so tts.php and media.php —
# which key their per-visitor rate limit and the ip= hash in their log on
# REMOTE_ADDR alone — saw ONE visitor. Trust X-Forwarded-For only from private
# ranges (Traefik runs on the host network, so it arrives from the bridge
# gateway); a client-supplied header from anywhere else is ignored, which is
# what stops a visitor choosing their own rate-limit key.
RUN printf '%s\n' \
      'RemoteIPHeader X-Forwarded-For' \
      'RemoteIPInternalProxy 172.16.0.0/12 10.0.0.0/8 192.168.0.0/16 127.0.0.1' \
      > /etc/apache2/conf-available/wain-remoteip.conf \
 && printf '%s\n' 'ServerTokens Prod' 'ServerSignature Off' \
      > /etc/apache2/conf-available/wain-hardening.conf \
 && a2enconf wain-remoteip wain-hardening

COPY --from=build /app/out/ /var/www/html/

# The PHP bridges: صوت وين (tts) and the business-photo upload (media). Both find
# their storage by walking up from api/ to the first sibling "storage/", which
# here is /var/www/storage — a volume, so the audio cache, the rate counters and
# elevenlabs.key survive a rebuild. Without a key tts answers 503 and the site
# falls back to the browser voice. media.php is an anonymous public WRITE
# endpoint; CLAUDE.md records that installing it is a decision, so remove the
# second COPY line if it is not wanted on a host that is open to the public.
COPY scripts/publish/tts-endpoint.php /var/www/html/api/tts.php
COPY scripts/publish/media-endpoint.php /var/www/html/api/media.php

# A named volume is only copied-up from the image on its FIRST mount, and a key
# created by `docker exec` as root is unreadable to www-data — which the bridge
# reports as "no key", indistinguishable from never having set one. So ownership
# is reasserted on every start, then control passes to the image's own entrypoint.
RUN mkdir -p /var/www/storage \
 && printf '%s\n' \
      '#!/bin/sh' \
      'set -e' \
      'mkdir -p /var/www/storage' \
      'chown -R www-data:www-data /var/www/storage' \
      'chmod 0700 /var/www/storage' \
      'exec docker-php-entrypoint "$@"' \
      > /usr/local/bin/wain-entrypoint \
 && chmod 0755 /usr/local/bin/wain-entrypoint
VOLUME /var/www/storage
ENTRYPOINT ["wain-entrypoint"]
CMD ["apache2-foreground"]
