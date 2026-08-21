#!/usr/bin/env python3
"""Serves `dist/` the way a real host serves it, for scripts/smoke.mjs.

   npx expo export --platform web
   python3 scripts/serve-dist.py &
   node scripts/smoke.mjs

Python's own http.server is not enough: `expo export` writes /shop as shop.html,
and a plain static server answers 404 for the URL the router actually links to.
Every host this app would be deployed to rewrites extensionless paths; this does
the same, and falls back to index.html so client-side routes still resolve.
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
                return str(DIST / 'index.html')
        return str(local)

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    os.chdir(DIST)
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), functools.partial(Handler, directory=str(DIST))) as srv:
        print(f'serving {DIST} on http://127.0.0.1:{PORT}')
        srv.serve_forever()
