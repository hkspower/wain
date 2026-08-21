#!/usr/bin/env python3
"""A stand-in for admin.php, so scripts/admin-smoke.mjs can drive the real panel.

   python3 scripts/mock-admin.py 8899 &
   EXPO_PUBLIC_API_BASE=http://127.0.0.1:8899 npx expo export --platform web
   node scripts/admin-smoke.mjs

This exists because the panel deliberately has NO offline fallback — an admin
screen that invents orders is worse than one that says it cannot reach the
shop. That is the right product decision and it makes the panel untestable
without a server, so here is the smallest server that satisfies the contract in
src/lib/admin.ts.

It is a TEST FIXTURE. It is not shipped, it is not a reference implementation,
and the real admin.php is the authority on behaviour. What it does guarantee is
the shape: every route, the 401s, and the status machine.
"""

import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

TOKEN = 'test-token-abc'
EMAIL, PASSWORD = 'manager@sporta.com.kw', 'correct horse'

def _fresh_orders():
    return [
        {
            'id': 1, 'ref': 'SP-2601', 'name': 'Noura A.', 'phone': '55512345',
            'total': 26_250, 'status': 'new', 'payment': 'knet', 'createdAt': '2026-08-21 09:12',
            'governorate': 'Hawalli', 'area': 'Salmiya', 'block': '4', 'street': '12', 'house': '8',
            'notes': 'Call before coming up',
            'subtotal': 26_250, 'delivery': 0,
            'lines': [
                {'name': 'High-rise legging', 'size': 'M', 'qty': 1, 'price': 15_000},
                {'name': 'Core compression tee', 'size': 'L', 'qty': 1, 'price': 11_000},
            ],
        },
        {
            'id': 2, 'ref': 'SP-2602', 'name': 'Faisal K.', 'phone': '99887766',
            'total': 11_250, 'status': 'packing', 'payment': 'cod', 'createdAt': '2026-08-21 10:40',
            'governorate': 'Capital', 'area': 'Shuwaikh', 'block': '2', 'street': '5', 'house': '31',
            'subtotal': 9_750, 'delivery': 1_500,
            'lines': [{'name': 'Desert runner short', 'size': 'M', 'qty': 1, 'price': 9_750}],
        },
        {
            'id': 3, 'ref': 'SP-2603', 'name': 'Dana M.', 'phone': '60011223',
            'total': 8_000, 'status': 'delivered', 'payment': 'knet', 'createdAt': '2026-08-20 18:02',
            'governorate': 'Ahmadi', 'area': 'Mangaf', 'block': '1', 'street': '3', 'house': '7',
            'subtotal': 8_000, 'delivery': 0,
            'lines': [{'name': 'Last-season hoodie', 'size': 'S', 'qty': 1, 'price': 8_000}],
        },
    ]


def _fresh_stock():
    return [
        {'slug': 'core-compression-tee', 'name': 'Core compression tee', 'size': 'M', 'stock': 9},
        {'slug': 'core-compression-tee', 'name': 'Core compression tee', 'size': 'L', 'stock': 8},
        {'slug': 'desert-runner-short', 'name': 'Desert runner short', 'size': 'XL', 'stock': 0},
        {'slug': 'high-rise-legging', 'name': 'High-rise legging', 'size': 'XL', 'stock': 1},
    ]


# Mutable fixture state. The smoke test moves an order along and edits stock, so
# it must be able to put the fixture back — otherwise the second run of the test
# starts from the first run's leftovers and fails on transitions that already
# happened.
ORDERS = _fresh_orders()
STOCK = _fresh_stock()

ALLOWED = {
    'new': {'paid', 'packing', 'cancelled'},
    'paid': {'packing', 'cancelled'},
    'packing': {'shipped', 'cancelled'},
    'shipped': {'delivered', 'cancelled'},
    'delivered': set(),
    'cancelled': set(),
}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        # The exported web build is served from another origin in the test rig.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        return self.headers.get('Authorization') == f'Bearer {TOKEN}'

    def _route(self):
        m = re.search(r'[?&]r=([a-z-]+)', self.path)
        return m.group(1) if m else ''

    def _param(self, name):
        m = re.search(rf'[?&]{name}=([^&]+)', self.path)
        return m.group(1) if m else None

    def do_OPTIONS(self):
        self._send(200, {})

    def do_GET(self):
        route = self._route()
        if not self._authed():
            return self._send(401, {'error': 'unauthorized'})

        if route == 'summary':
            today = [o for o in ORDERS if o['createdAt'].startswith('2026-08-21')]
            return self._send(200, {
                'todayOrders': len(today),
                'todayRevenue': sum(o['total'] for o in today),
                'pending': len([o for o in ORDERS if o['status'] in ('new', 'paid', 'packing')]),
                'lowStock': [s for s in STOCK if s['stock'] <= 1],
            })

        if route == 'orders':
            status = self._param('status')
            rows = [o for o in ORDERS if not status or o['status'] == status]
            keep = ('id', 'ref', 'name', 'phone', 'total', 'status', 'payment', 'createdAt')
            return self._send(200, {'orders': [{k: o[k] for k in keep} for o in rows]})

        if route == 'order':
            oid = int(self._param('id') or 0)
            order = next((o for o in ORDERS if o['id'] == oid), None)
            return self._send(200, {'order': order}) if order else self._send(404, {'error': 'no such order'})

        if route == 'stock':
            return self._send(200, {'items': STOCK})

        return self._send(404, {'error': f'unknown route {route}'})

    def do_POST(self):
        route = self._route()
        length = int(self.headers.get('Content-Length') or 0)
        body = json.loads(self.rfile.read(length) or b'{}')

        if route == 'reset':
            # Fixture-only, and unauthenticated on purpose: it exists so the
            # test can start from a known state. There is no equivalent in the
            # real admin.php and there must never be.
            global ORDERS, STOCK
            ORDERS, STOCK = _fresh_orders(), _fresh_stock()
            return self._send(200, {'ok': True})

        if route == 'login':
            if body.get('email') == EMAIL and body.get('password') == PASSWORD:
                return self._send(200, {'token': TOKEN, 'name': 'Manager'})
            return self._send(401, {'error': 'unauthorized'})

        if not self._authed():
            return self._send(401, {'error': 'unauthorized'})

        if route == 'order-status':
            order = next((o for o in ORDERS if o['id'] == body.get('id')), None)
            if not order:
                return self._send(404, {'error': 'no such order'})
            want = body.get('status')
            # Refused transitions return the CURRENT status rather than an
            # error, which is what the panel is written to trust.
            if want in ALLOWED[order['status']]:
                order['status'] = want
            return self._send(200, {'ok': True, 'status': order['status']})

        if route == 'stock':
            for s in STOCK:
                if s['slug'] == body.get('slug') and s['size'] == body.get('size'):
                    s['stock'] = int(body.get('stock', s['stock']))
                    return self._send(200, {'ok': True})
            return self._send(404, {'error': 'no such variant'})

        return self._send(404, {'error': f'unknown route {route}'})

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    print(f'mock admin.php on http://127.0.0.1:{port}')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
