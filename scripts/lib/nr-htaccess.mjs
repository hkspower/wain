// The .htaccess that ships to the asset host's document root.
//
// nr.mawsoool.com is a Hostinger subdomain whose document root is a
// directory INSIDE the parent site's — public_html/Nr — and on this host
// (LiteSpeed) a subdomain rooted below public_html does not read the
// parent's .htaccess; wainkw.com's own config records exactly that for
// its staging subdomain. So this file is self-contained: everything the
// asset host needs is here, and nothing above it is relied on.
//
// Only directives already proven on this hosting are used — the same
// mod_headers / mod_mime / Options forms wainkw.com ships — and the
// rewrite engine is deliberately not switched on: HTTPS is enforced by
// Hostinger's own Force-HTTPS toggle on the subdomain, one mechanism
// rather than two.
//
// The cache policy mirrors next.config.ts's publicHeaders, because the
// same files answer on both origins and must age the same way:
//
//   build.json   the index that busts the models — never held (no-cache
//                still allows a 304, which is one small round trip).
//   .glb         immutable for a year. Safe because models.ts asks for
//                `car-gtr.glb?v=<fingerprint of build.json>`, so a rebuild
//                changes the URL rather than the bytes behind one.
//   the rest     a day, with stale-while-revalidate so a refetch is never
//                in front of the player.
//
// CORS is `*` on purpose: these are public files served without
// credentials, and the game fetches them from a different origin. Range
// is allowed and exposed because <audio> seeks by byte range.

export const NR_HTACCESS = `# nr.mawsoool.com — Night Racer static assets.
# Written by scripts/lib/nr-htaccess.mjs; deployed by npm run deploy:assets.
# Public files, no credentials, served cross-origin to the game.

Options -Indexes
DirectoryIndex disabled

<IfModule mod_mime.c>
  AddType model/gltf-binary .glb
  AddType image/webp .webp
  AddType audio/mpeg .mp3
  AddType application/json .json
</IfModule>

# Dotfiles are never content here — this file included.
<FilesMatch "^\\.">
  Require all denied
</FilesMatch>

<IfModule mod_headers.c>
  Header always set Access-Control-Allow-Origin "*"
  Header always set Access-Control-Allow-Methods "GET, HEAD, OPTIONS"
  Header always set Access-Control-Allow-Headers "Range"
  Header always set Access-Control-Expose-Headers "Content-Length, Content-Range, Accept-Ranges"
  Header always set Access-Control-Max-Age "86400"
  Header always set X-Content-Type-Options "nosniff"

  # Mirrors next.config.ts publicHeaders.
  Header always set Cache-Control "public, max-age=86400, stale-while-revalidate=604800"
  <FilesMatch "\\.glb$">
    Header always set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <Files "build.json">
    Header always set Cache-Control "public, no-cache"
  </Files>
</IfModule>
`;
