#!/usr/bin/env bash
# One-time setup of the Hostinger VPS as wain's staging builder.
#
# Run as root in the Hostinger browser terminal. Safe to run again: each step
# checks what is already there.
#
#   1. Set CERT_EMAIL below (Let's Encrypt needs a real address).
#   2. bash setup-vps.sh            → installs tools, makes a deploy key, prints it
#   3. Add the printed public key to GitHub: repo hkspower/wain → Settings →
#      Deploy keys → Add (read-only is enough).
#   4. bash setup-vps.sh            → clones the repo and sets up the release host
#
# The VPS is not a secret store. The staging deploy secret is added by hand in
# step 5 of docs/vps.md and is never pasted into a chat or a commit.

set -euo pipefail

CERT_EMAIL="${CERT_EMAIL:-REPLACE_WITH_YOUR_EMAIL}"
DOMAIN="srv2058651.hstgr.cloud"
REPO_SSH="git@github.com:hkspower/wain.git"
REPO_DIR=/root/wain-deploy/src
RELEASE_DIR=/var/www/wain-releases

if [ "$CERT_EMAIL" = "REPLACE_WITH_YOUR_EMAIL" ]; then
  echo "Set CERT_EMAIL first: CERT_EMAIL=you@example.com bash setup-vps.sh" >&2
  exit 1
fi

echo "== 1. packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git zip unzip curl ca-certificates nginx certbot \
  python3-certbot-nginx php-cli php-zip php-curl openssl

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "node $(node -v), npm $(npm -v), php $(php -r 'echo PHP_VERSION;')"

echo "== 2. deploy key (read-only access to the repo)"
mkdir -p /root/.ssh /root/wain-deploy "$RELEASE_DIR"
chmod 700 /root/.ssh
if [ ! -f /root/.ssh/wain_deploy ]; then
  ssh-keygen -t ed25519 -N "" -C "wain-vps" -f /root/.ssh/wain_deploy
fi
if ! grep -q "IdentityFile /root/.ssh/wain_deploy" /root/.ssh/config 2>/dev/null; then
  cat >> /root/.ssh/config <<'EOF'
Host github.com
  IdentityFile /root/.ssh/wain_deploy
  IdentitiesOnly yes
EOF
fi
chmod 600 /root/.ssh/config
ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null
sort -u -o /root/.ssh/known_hosts /root/.ssh/known_hosts

echo "== 3. clone the repo (needs the deploy key added to GitHub first)"
if [ ! -d "$REPO_DIR/.git" ]; then
  if git ls-remote "$REPO_SSH" HEAD >/dev/null 2>&1; then
    git clone --quiet "$REPO_SSH" "$REPO_DIR"
    echo "cloned into $REPO_DIR"
  else
    echo "GitHub does not accept the key yet. Public key to add:"
    echo
    cat /root/.ssh/wain_deploy.pub
    echo
    echo "Add it as a read-only deploy key, then run this script again."
  fi
else
  echo "repo already at $REPO_DIR"
fi

echo "== 4. release host: $RELEASE_DIR served at https://$DOMAIN/releases/"
cat > /etc/nginx/sites-available/wain-releases <<EOF
server {
  listen 80;
  server_name $DOMAIN;

  location /releases/ {
    alias $RELEASE_DIR/;
    autoindex off;
    default_type application/zip;
  }
}
EOF
ln -sf /etc/nginx/sites-available/wain-releases /etc/nginx/sites-enabled/wain-releases
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERT_EMAIL" --redirect
else
  echo "certificate for $DOMAIN already present"
fi

echo
echo "Setup done. Next: put the staging deploy secret in /root/wain-deploy/staging.secret"
echo "(chmod 600), then run scripts/vps/deploy-staging.sh. See docs/vps.md."
