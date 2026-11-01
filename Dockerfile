# Static export of wain, served by Apache so the export's own .htaccess
# (headers, cache rules, apex -> www redirect) applies unchanged.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM php:8.3-apache
# The export's .htaccess uses rewrite, headers, expires and deflate.
RUN a2enmod rewrite headers expires deflate mime setenvif \
 && sed -ri 's!AllowOverride None!AllowOverride All!' /etc/apache2/apache2.conf
COPY --from=build /app/out/ /var/www/html/
# The PHP bridges: صوت وين (tts) and the business-photo upload (media). Both find
# their storage by walking up from api/ to the first sibling "storage/", which
# here is /var/www/storage — a volume, so the audio cache, the rate counters and
# elevenlabs.key survive a rebuild. Without a key tts answers 503 and the site
# falls back to the browser voice, same as the shared host today.
COPY scripts/publish/tts-endpoint.php /var/www/html/api/tts.php
COPY scripts/publish/media-endpoint.php /var/www/html/api/media.php
RUN mkdir -p /var/www/storage && chown -R www-data:www-data /var/www/storage
VOLUME /var/www/storage
