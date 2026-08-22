#!/usr/bin/env python3
"""Serves `dist/` the way a real host serves it, for scripts/smoke.mjs.

   npx expo export --platform web
   python3 scripts/serve-dist.py &
   node scripts/smoke.mjs

Python's own http.server is not enough: `expo export` writes /shop as shop.html,
and a plain static server answers 404 for the URL the router actually links to.
Every host this app would be deployed to rewrites extensionless paths; this does
the same.

IT ALSO RESOLVES DYNAMIC ROUTES, which is not a detail. The export writes
/product/[slug] as product/[slug].html — the literal brackets are in the
filename — and a server that does not know that answers /product/desert-runner
-short with index.html instead. The page then LOOKS right, because the client
router corrects it, and the only trace is a React hydration error on every
product a customer opens. That was reported as an app bug and was this file.

A real host needs the same rule. On Apache it is a RewriteRule per dynamic
segment; the point either way is that the fallback must be the route's own
prerendered file, not the home page.
"""

import functools
import http.server
import os
import sys
from pathlib import Path

DIST = Path(__file__).resolve().parent.parent / 'dist'
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4173


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        local = Path(super().translate_path(path))
        if local.is_dir() and (local / 'index.html').exists():
            return str(local / 'index.html')
        if not local.exists():
            html = local.with_suffix('.html')
            if html.exists():
                return str(html)
            if '.' not in local.name:
                dynamic = self._dynamic_route(local)
                if dynamic:
                    return str(dynamic)
                return str(DIST / 'index.html')
        return str(local)

    @staticmethod
    def _dynamic_route(local: Path):
        """/product/desert-runner-short -> dist/product/[slug].html

        Matched on the PARENT directory, one segment deep, which is every
        dynamic route this app has. A deeper or catch-all route would need
        more; there is no point writing it until one exists.
        """
        parent = local.parent
        if not parent.is_dir():
            return None
        for candidate in sorted(parent.glob('[[]*[]].html')):
            return candidate
        return None

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    os.chdir(DIST)
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=str(DIST))) as srv:
        print(f'serving {DIST} on http://127.0.0.1:{PORT}')
        srv.serve_forever()
