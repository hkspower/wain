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
