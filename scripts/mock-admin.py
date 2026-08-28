#!/usr/bin/env python3
"""A stand-in for admin.php, so scripts/admin-smoke.mjs can drive the real panel.

   python3 scripts/mock-admin.py 8899 &
   EXPO_PUBLIC_API_BASE=http://127.0.0.1:8899 npx expo export --platform web
   node scripts/admin-smoke.mjs        # opens http://127.0.0.1:8899/backends

THE FIXTURE MIRRORS admin.php, ROUTE FOR ROUTE, OR IT IS WORSE THAN NOTHING.
The first version of this file invented its own vocabulary — Bearer tokens,
hyphenated route names, a `summary` route — and the panel was then written
against the fixture instead of the server. Every test passed; every request
against production would have failed. So the rules now are:

  * Every route name here exists in admin.php, spelled identically, with the
    same method and the same response shape. scripts/admin-contract-test.mjs
    enforces this mechanically — add a route there is no PHP for and it fails.
  * Auth is what admin.php does: a session COOKIE set by ?r=login, and the
    X-Sporta-Admin: 1 header required on every request (400 without it).
  * Money is KWD decimals in snake_case, exactly as the PHP sends it. The
    adapters live in src/lib/admin.ts, and a fixture that pre-adapted would
    hide their bugs.

It also serves the exported app from dist/ — the same one-origin topology
Apache gives production, which is what lets the browser send the cookie and
the custom header without a CORS preflight standing in for a server that
will never answer one. (Static resolution mirrors scripts/serve-dist.py.)

It is a TEST FIXTURE. It is not shipped, and admin.php is the authority.
The one route with no PHP counterpart is POST ?r=reset, unauthenticated,
which puts the fixture data back — a rig that mutates state needs a way to
start over.
"""

import json
import hashlib
import re
import sys
from http.cookies import SimpleCookie
from urllib.parse import unquote
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

EMAIL, PASSWORD = 'manager@sporta.com.kw', 'correct horse'
SESSION = 'mock-session-1'
COOKIE = 'sporta_admin'
DIST = Path(__file__).resolve().parent.parent / 'dist'


def _fresh():
    orders = [
        {
            'id': 1, 'track_id': 'SP-2601', 'amount': 26.250,
            'payment_status': 'pending', 'payment_method': 'knet', 'fulfilment_status': 'unfulfilled',
            'created_at': '2026-08-21 09:12', 'customer_name': 'Noura A.', 'customer_phone': '55512345',
            'customer_governorate': 'Hawalli', 'customer_area': 'Salmiya', 'customer_block': '4',
            'customer_street': '12', 'customer_building': '8', 'customer_note': 'Call before coming up',
        },
        {
            'id': 2, 'track_id': 'SP-2602', 'amount': 11.250,
            'payment_status': 'pending', 'payment_method': 'cod', 'fulfilment_status': 'packed',
            'created_at': '2026-08-21 10:40', 'customer_name': 'Faisal K.', 'customer_phone': '99887766',
            'customer_governorate': 'Capital', 'customer_area': 'Shuwaikh', 'customer_block': '2',
            'customer_street': '5', 'customer_building': '31', 'customer_note': None,
        },
        {
            'id': 3, 'track_id': 'SP-2603', 'amount': 8.000,
            'payment_status': 'paid', 'payment_method': 'knet', 'fulfilment_status': 'delivered',
            'created_at': '2026-08-20 18:02', 'customer_name': 'Dana M.', 'customer_phone': '60011223',
            'customer_governorate': 'Ahmadi', 'customer_area': 'Mangaf', 'customer_block': '1',
            'customer_street': '3', 'customer_building': '7', 'customer_note': None,
        },
    ]
    items = {
        1: [
            {'id': 11, 'qty': 1, 'unit_price': 15.000, 'size': 'M', 'fit': None,
             'products': {'slug': 'high-rise-legging', 'name_en': 'High-rise legging', 'name_ar': 'ليقنز عالي الخصر'}},
            {'id': 12, 'qty': 1, 'unit_price': 11.000, 'size': 'L', 'fit': None,
             'products': {'slug': 'core-compression-tee', 'name_en': 'Core compression tee', 'name_ar': 'تيشيرت كور ضاغط'}},
        ],
        2: [
            {'id': 21, 'qty': 1, 'unit_price': 9.750, 'size': 'M', 'fit': None,
             'products': {'slug': 'desert-runner-short', 'name_en': 'Desert runner short', 'name_ar': 'شورت ديزرت للجري'}},
        ],
        3: [
            {'id': 31, 'qty': 1, 'unit_price': 8.000, 'size': 'S', 'fit': None,
             'products': {'slug': 'sculpt-top-grey', 'name_en': 'Sculpt training top', 'name_ar': 'تيشيرت سكالبت للتمرين'}},
        ],
    }
    variants = [
        {'sku': 'A-DRS-XL', 'slug': 'desert-runner-short', 'name_en': 'Desert runner short', 'size': 'XL', 'stock': 0, 'cost_aed': None},
        {'sku': 'A-HRL-XL', 'slug': 'high-rise-legging', 'name_en': 'High-rise legging', 'size': 'XL', 'stock': 1, 'cost_aed': None},
        {'sku': 'A-HRL-M', 'slug': 'high-rise-legging', 'name_en': 'High-rise legging', 'size': 'M', 'stock': 6, 'cost_aed': None},
        {'sku': 'A-CCT-L', 'slug': 'core-compression-tee', 'name_en': 'Core compression tee', 'size': 'L', 'stock': 9, 'cost_aed': None},
    ]
    discounts = [
        {'id': 1, 'kind': 'code', 'code': 'SAVE10', 'label': 'August promo', 'type': 'percent',
         'value': 10.0, 'min_order': 0.0, 'category': None, 'starts_at': None, 'ends_at': None,
         'usage_limit': 0, 'used_count': 4, 'active': True, 'live': True},
        {'id': 2, 'kind': 'auto', 'code': None, 'label': 'Big basket', 'type': 'fixed',
         'value': 2.000, 'min_order': 30.000, 'category': None, 'starts_at': None, 'ends_at': None,
         'usage_limit': 50, 'used_count': 50, 'active': True, 'live': False},
    ]
    # The two settings the panel edits. The contact defaults are the values the
    # built storefront hard-codes, exactly as STORE_SETTING_DEFAULTS has them —
    # a mock that started them empty would let a screen be built against a
    # blank contact card that production never shows.
    settings = {
        'promo_bar': {'enabled': True, 'text_en': 'Delivery within 24 hours in Kuwait',
                      'text_ar': 'التوصيل خلال ٢٤ ساعة داخل الكويت',
                      'href': '', 'starts_at': None, 'ends_at': None},
        'contact': {'phone': '+965 2209 1914', 'whatsapp': '96522091914',
                    'email': 'cs@sporta.com.kw', 'address_ar': '', 'address_en': '',
                    'hours_ar': '', 'hours_en': '', 'instagram': ''},
    }
    # PRODUCTS AS THE UPLOADER NEEDS THEM — ?r=products_all is where brands
    # live; ?r=variants knows sizes and skus and not brands, which is why the
    # panel joins the two. Both shapes have to exist here or the join is only
    # ever exercised against production.
    products = [
        {'slug': v['slug'], 'name_en': v.get('name_en') or v['slug'],
         'brand_slug': 'gymshark' if 'cloudsoft' in v['slug'] else None}
        for v in {x['slug']: x for x in variants}.values()
    ]
    # RETURN AND EXCHANGE REQUESTS, in the shape ?r=returns sends them: the
    # lines come WITH the list, snake_case, KWD decimals. Two rows, so the
    # panel's default 'new' filter has something in it and the 'all' filter
    # has something the filter must exclude.
    returns = [
        {'id': 1, 'ref': 'SPR7K2M9QX4', 'kind': 'exchange', 'status': 'new',
         'reason': 'المقاس كبير', 'lang': 'ar', 'phone': '96555512345',
         'staff_note': None, 'created_at': '2026-08-26 10:12:00', 'decided_at': None,
         'track_id': 'SPMOCK0001', 'customer_name': 'Fatima A.', 'payment_method': 'knet',
         'amount': 18.000, 'ordered_at': '2026-08-19 09:00:00',
         'fulfilled_at': '2026-08-24 14:00:00',
         'items': [{'qty': 1, 'want_size': 'XL', 'size': 'L', 'unit_price': 10.000,
                    'name_en': 'Cloudsoft Jacket — Army Green',
                    'name_ar': 'جاكيت كلاودسوفت — أخضر عسكري',
                    'slug': 'cloudsoft-jacket-army-green', 'image': None}]},
        {'id': 2, 'ref': 'SPR3H8VDNP2', 'kind': 'return', 'status': 'approved',
         'reason': None, 'lang': 'en', 'phone': '96599887766',
         'staff_note': None, 'created_at': '2026-08-25 08:40:00',
         'decided_at': '2026-08-25 11:02:00',
         'track_id': 'SPMOCK0002', 'customer_name': 'Yousef K.', 'payment_method': 'cod',
         'amount': 8.000, 'ordered_at': '2026-08-18 12:00:00',
         'fulfilled_at': '2026-08-22 16:30:00',
         'items': [{'qty': 1, 'want_size': None, 'size': 'M', 'unit_price': 8.000,
                    'name_en': 'Cloudsoft Leggings — Navy',
                    'name_ar': 'ليقنز كلاودسوفت — كحلي',
                    'slug': 'cloudsoft-leggings-navy', 'image': None}]},
    ]
    return {'orders': orders, 'items': items, 'variants': variants, 'discounts': discounts,
            'products': products,
            # FOUR PHOTOGRAPHS ON THE FIRST GARMENT, so the gallery exists
            # for a rig to look at. It used to start empty, and the gallery
            # is three taps in — which is how a 22pt Remove button that
            # deleted a photograph on one tap went unseen by every rig in
            # the repo. admin-mobile.mjs works this fixture.
            'images': [{'id': n, 'slug': products[0]['slug'], 'sort': n - 1,
                        'v': 'aaaa%d' % n, 'width': 900, 'height': 1125} for n in range(1, 5)],
            'next_image': 5,
            'next_discount': 3, 'settings': settings, 'returns': returns,
            'otp_enabled': False, 'otp_code': None}


STATE = _fresh()


class Handler(BaseHTTPRequestHandler):
    # ---- plumbing --------------------------------------------------------
    def _json(self, code, payload, set_cookie=None, clear_cookie=False):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        if set_cookie:
            self.send_header('Set-Cookie', f'{COOKIE}={set_cookie}; Path=/; HttpOnly; SameSite=Strict')
        if clear_cookie:
            self.send_header('Set-Cookie', f'{COOKIE}=; Path=/; Max-Age=0')
        self.end_headers()
        self.wfile.write(body)

    def _route(self):
        # Underscores INCLUDED — the first version's regex was [a-z-]+, which
        # structurally could not match a single real admin.php route name.
        m = re.search(r'[?&]r=([a-z_]+)', self.path)
        return m.group(1) if m else None

    def _body(self):
        n = int(self.headers.get('Content-Length') or 0)
        return json.loads(self.rfile.read(n) or b'{}')

    def _signed_in(self):
        c = SimpleCookie(self.headers.get('Cookie') or '')
        return COOKIE in c and c[COOKIE].value == SESSION

    def _gate(self):
        """store_require_admin(), in miniature — and in its ORDER: the session
        first (401 not_signed_in), the header second (400). The first cut of
        this fixture checked the header first, and the live test caught the
        difference on its first run, which is the whole reason it exists."""
        if not self._signed_in():
            self._json(401, {'error': 'not_signed_in'})
            return False
        if self.headers.get('X-Sporta-Admin') != '1':
            self._json(400, {'error': 'bad_request'})
            return False
        return True

    def log_message(self, *a):
        pass

    # ---- static: the exported app, same-origin like production ------------
    def _serve_static(self):
        local = (DIST / self.path.lstrip('/').split('?')[0]).resolve()
        if local.is_dir():
            local = local / 'index.html'
        if not local.exists():
            html = local.with_suffix('.html')
            if html.exists():
                local = html
            elif '.' not in local.name:
                # Dynamic segments, as serve-dist.py resolves them.
                dyn = sorted(local.parent.glob('[[]*[]].html')) if local.parent.is_dir() else []
                local = dyn[0] if dyn else DIST / 'index.html'
        try:
            data = local.read_bytes()
        except OSError:
            self.send_response(404)
            self.end_headers()
            return
        ctype = {
            '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
            '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
            '.ttf': 'font/ttf', '.ico': 'image/x-icon', '.json': 'application/json',
        }.get(local.suffix, 'application/octet-stream')
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ---- GET -------------------------------------------------------------
    def do_GET(self):
        if '/admin.php' not in self.path:
            return self._serve_static()
        r = self._route()

        if r == 'me':
            # No header check: admin.php's ?r=me sits above the gate and asks
            # only the session, so a fresh app can probe before it knows
            # anything.
            if not self._signed_in():
                return self._json(200, None)
            return self._json(200, {'email': EMAIL, 'phone': None, 'totp': False})

        if not self._gate():
            return

        if r == 'stats':
            orders = STATE['orders']
            paid = [o for o in orders if o['payment_status'] == 'paid']
            return self._json(200, {
                'paid_count': len(paid),
                'paid_revenue': sum(o['amount'] for o in paid),
                'pending_count': sum(1 for o in orders if o['payment_status'] == 'pending'),
                'review_count': 0, 'failed_count': 0,
                'unfulfilled_count': sum(
                    1 for o in orders
                    if o['payment_status'] == 'paid' and o['fulfilment_status'] == 'unfulfilled'),
                # The fixture's "today" is simply everything, which keeps the
                # dashboard's tiles deterministic for the smoke test.
                'paid_today': len(paid),
                'revenue_today': sum(o['amount'] for o in paid),
                'paid_7d': len(paid), 'revenue_7d': sum(o['amount'] for o in paid),
                'cod_awaiting_count': sum(
                    1 for o in orders
                    if o['payment_method'] == 'cod' and o['payment_status'] == 'pending'),
                'cod_awaiting_amount': sum(
                    o['amount'] for o in orders
                    if o['payment_method'] == 'cod' and o['payment_status'] == 'pending'),
            })

        if r == 'orders':
            rows = list(STATE['orders'])
            m = re.search(r'[?&]payment=([a-z]+)', self.path)
            if m and m.group(1) != 'all':
                rows = [o for o in rows if o['payment_status'] == m.group(1)]
            m = re.search(r'[?&]fulfilment=([a-z]+)', self.path)
            if m and m.group(1) != 'all':
                rows = [o for o in rows if o['fulfilment_status'] == m.group(1)]
            return self._json(200, rows)

        if r == 'items':
            m = re.search(r'[?&]order=(\d+)', self.path)
            return self._json(200, STATE['items'].get(int(m.group(1)) if m else 0, []))

        if r == 'variants':
            return self._json(200, STATE['variants'])

        if r == 'products_all':
            return self._json(200, STATE['products'])

        if r == 'product_images':
            # Same shape as ?r=items above — a small regex rather than a
            # urlparse import, so the file keeps one way of reading a param.
            m = re.search(r'[?&]slug=([^&]+)', self.path)
            slug = unquote(m.group(1)) if m else ''
            rows = sorted([i for i in STATE['images'] if i['slug'] == slug],
                          key=lambda i: (i['sort'], i['id']))
            return self._json(200, {'images': [
                {'id': i['id'], 'sort': i['sort'],
                 'url': f"api.php?r=product_image&id={i['id']}&v={i['v']}",
                 'width': i['width'], 'height': i['height']} for i in rows]})

        if r == 'discounts':
            return self._json(200, STATE['discounts'])

        if r == 'returns':
            rows = STATE['returns']
            # Same optional &status= filter admin.php takes, and the same
            # counts — over EVERYTHING, not over the filtered page, because a
            # count that changed with the filter would be a lie on the chips.
            m = re.search(r'[?&]status=([a-z_]+)', self.path)
            if m:
                rows = [x for x in rows if x['status'] == m.group(1)]
            counts = {}
            for x in STATE['returns']:
                counts[x['status']] = counts.get(x['status'], 0) + 1
            return self._json(200, {'returns': rows, 'counts': counts})

        self._json(404, {'error': 'not_found'})

    # ---- POST ------------------------------------------------------------
    def do_POST(self):
        if '/admin.php' not in self.path:
            self.send_response(404)
            self.end_headers()
            return
        r = self._route()

        if r == 'reset':  # fixture-only, unauthenticated
            global STATE
            STATE = _fresh()
            return self._json(200, {'ok': True})

        if r == 'login':
            if self.headers.get('X-Sporta-Admin') != '1':
                return self._json(400, {'error': 'bad_request'})
            b = self._body()
            if b.get('email') == EMAIL and b.get('password') == PASSWORD:
                return self._json(200, {'email': EMAIL, 'need_code': False}, set_cookie=SESSION)
            return self._json(401, {'error': 'bad_credentials'})

        if r == 'login_code':
            # The fixture account has no second factor enrolled, so there is
            # never a pending marker for a code to complete — which is exactly
            # what admin.php answers in that state.
            return self._json(401, {'error': 'bad_credentials'})

        if r == 'login_code_resend':
            # Same state as login_code above: the fixture account has no second
            # factor, so there is no pending marker to resend against.
            return self._json(401, {'error': 'code_expired'})

        if r == 'logout':
            return self._json(200, {'ok': True}, clear_cookie=True)

        if not self._gate():
            return
        b = self._body()

        # ---- the emailed one-time code, as a second factor ------------------
        #
        # THE MOCK NEVER SENDS MAIL and says so: `sent` is False, exactly as the
        # real routes answer on a host with no MTA. The panel has to handle that
        # answer — it is what an owner with a misconfigured mail server sees —
        # so the fixture must not pretend otherwise.
        #
        # The code is the fixed '424242'. A mock that generated a random one
        # would be untestable from the outside, and a fixture is allowed to be
        # predictable in a way the server must not be.
        if r == 'otp_begin':
            if b.get('password') != 'correct horse':
                return self._json(401, {'error': 'bad_password'})
            if STATE['otp_enabled']:
                return self._json(409, {'error': 'already_enrolled'})
            STATE['otp_code'] = '424242'
            return self._json(200, {'sent': False, 'to': 'm*******@sporta.com.kw'})

        if r == 'otp_enable':
            if not STATE.get('otp_code'):
                return self._json(409, {'error': 'not_started'})
            if b.get('code') != STATE['otp_code']:
                return self._json(401, {'error': 'bad_code'})
            STATE['otp_enabled'] = True
            STATE['otp_code'] = None          # used once, as the server does
            return self._json(200, {'ok': True, 'email_otp': True})

        if r == 'otp_send':
            if not STATE['otp_enabled']:
                return self._json(409, {'error': 'not_enrolled'})
            STATE['otp_code'] = '424242'
            return self._json(200, {'sent': False, 'to': 'm*******@sporta.com.kw'})

        if r == 'otp_disable':
            if not STATE['otp_enabled']:
                return self._json(409, {'error': 'not_enrolled'})
            if b.get('password') != 'correct horse':
                return self._json(401, {'error': 'bad_password'})
            if b.get('code') != STATE.get('otp_code'):
                return self._json(401, {'error': 'bad_code'})
            STATE['otp_enabled'] = False
            STATE['otp_code'] = None
            return self._json(200, {'ok': True, 'email_otp': False})

        if r == 'fulfilment':
            status = b.get('status')
            if status not in ('unfulfilled', 'packed', 'shipped', 'delivered', 'cancelled'):
                return self._json(400, {'error': 'invalid_status'})
            for o in STATE['orders']:
                if o['id'] == int(b.get('order_id') or 0):
                    o['fulfilment_status'] = status
                    return self._json(200, {'ok': True})
            return self._json(400, {'error': 'order_not_found'})

        if r == 'cod_paid':
            for o in STATE['orders']:
                if o['id'] == int(b.get('order_id') or 0):
                    if o['payment_method'] != 'cod':
                        return self._json(400, {'error': 'not_a_cash_order'})
                    want = bool(b.get('paid', True))
                    if want and o['payment_status'] != 'pending':
                        return self._json(400, {'error': 'order_not_pending'})
                    o['payment_status'] = 'paid' if want else 'pending'
                    return self._json(200, {'ok': True})
            return self._json(400, {'error': 'order_not_found'})

        if r == 'set_stock':
            stock = int(b.get('stock', -1))
            if stock < 0:
                return self._json(400, {'error': 'stock_cannot_be_negative'})
            for v in STATE['variants']:
                if v['sku'] == b.get('sku'):
                    v['stock'] = stock
                    return self._json(200, {'sku': v['sku'], 'slug': v['slug'], 'size': v['size'], 'stock': stock})
            return self._json(400, {'error': 'sku_not_found'})

        # settings_save mirrors admin.php's: two named settings, each with its
        # own validation, and an unknown name is refused rather than stored.
        # The refusals are the part worth having here — the panel's error
        # messages are written against these exact codes, and a mock that
        # accepted everything would let a screen ship with a message for a
        # failure the real server produces and this one never did.
        # THE CAP AND THE FORMAT GATE ARE BOTH HERE, because the panel's error
        # messages are written against these exact codes. A mock that accepted
        # any string would let a screen ship with a message for a refusal it
        # had never once produced.
        if r == 'product_image_add':
            slug = b.get('slug')
            if not any(p['slug'] == slug for p in STATE['products']):
                return self._json(400, {'error': 'product_not_found'})
            if len([i for i in STATE['images'] if i['slug'] == slug]) >= 24:
                return self._json(400, {'error': 'too_many_images'})
            img = str(b.get('image') or '')
            if not img:
                return self._json(400, {'error': 'image_required'})
            if not re.match(r'^data:image/(png|jpeg|webp);base64,', img):
                return self._json(400, {'error': 'logo_bad_format'})
            # store.php's STORE_PRODUCT_IMAGE_MAX. Mirrored so an oversized
            # upload is refused here too — otherwise the shrinking in
            # lib/shrink-image would only ever be tested against production.
            if len(img) > 900000:
                return self._json(400, {'error': 'logo_too_large'})
            row = {'id': STATE['next_image'], 'slug': slug,
                   'sort': len([i for i in STATE['images'] if i['slug'] == slug]),
                   'v': hashlib.sha256(img.encode()).hexdigest()[:12],
                   'width': int(b.get('width') or 0), 'height': int(b.get('height') or 0)}
            STATE['next_image'] += 1
            STATE['images'].append(row)
            return self._json(200, {'id': row['id'],
                                    'url': f"api.php?r=product_image&id={row['id']}&v={row['v']}"})

        if r == 'product_image_delete':
            before = len(STATE['images'])
            STATE['images'][:] = [i for i in STATE['images'] if i['id'] != int(b.get('id') or 0)]
            return self._json(200, {'ok': before != len(STATE['images'])})

        if r == 'product_image_reorder':
            slug = b.get('slug')
            ids = b.get('ids')
            if not slug or not isinstance(ids, list):
                return self._json(400, {'error': 'bad_request'})
            # `and slug` is not decoration here either — admin.php scopes the
            # update so a crafted list cannot renumber another garment's shoot.
            for n, i in enumerate(ids):
                for row in STATE['images']:
                    if row['id'] == int(i) and row['slug'] == slug:
                        row['sort'] = n
            return self._json(200, {'ok': True})

        if r == 'settings_save':
            name = b.get('name')
            v = b.get('value') if isinstance(b.get('value'), dict) else {}
            if name == 'promo_bar':
                STATE['settings']['promo_bar'] = {
                    'enabled': bool(v.get('enabled')),
                    'text_en': str(v.get('text_en') or '')[:160],
                    'text_ar': str(v.get('text_ar') or '')[:160],
                    # An EXTERNAL href is blanked, not refused — same as
                    # store_internal_href(), which returns null for anything
                    # that is not a path on this site.
                    'href': str(v.get('href') or '') if str(v.get('href') or '').startswith('/') else '',
                    'starts_at': v.get('starts_at') or None,
                    'ends_at': v.get('ends_at') or None,
                }
                return self._json(200, STATE['settings']['promo_bar'])
            if name == 'contact':
                email = str(v.get('email') or '').strip()
                if email and '@' not in email:
                    return self._json(400, {'error': 'invalid_email'})
                wa = re.sub(r'[^0-9]', '', str(v.get('whatsapp') or ''))
                if wa:
                    wa = re.sub(r'^(00965|965)?', '965', wa[-8:])
                    if len(wa) != 11:
                        return self._json(400, {'error': 'invalid_whatsapp'})
                STATE['settings']['contact'] = {
                    'phone': str(v.get('phone') or '')[:32],
                    'whatsapp': wa,
                    'email': email,
                    'address_ar': str(v.get('address_ar') or '')[:160],
                    'address_en': str(v.get('address_en') or '')[:160],
                    'hours_ar': str(v.get('hours_ar') or '')[:120],
                    'hours_en': str(v.get('hours_en') or '')[:120],
                    'instagram': re.sub(r'[^A-Za-z0-9._]', '', str(v.get('instagram') or '')[:40]),
                }
                return self._json(200, STATE['settings']['contact'])
            return self._json(400, {'error': 'unknown_setting'})

        if r == 'discount_save':
            code = b.get('code')
            if b.get('kind') == 'code':
                code = re.sub(r'[^A-Za-z0-9]', '', str(code or '')).upper()
                if not (3 <= len(code) <= 24):
                    return self._json(400, {'error': 'invalid_code'})
            value = float(b.get('value') or 0)
            if b.get('type') == 'percent' and not (1 <= value <= 90):
                return self._json(400, {'error': 'invalid_percent'})
            row = {
                'id': int(b['id']) if b.get('id') else STATE['next_discount'],
                'kind': b.get('kind', 'code'), 'code': code if b.get('kind') == 'code' else None,
                'label': b.get('label', ''), 'type': b.get('type', 'percent'), 'value': value,
                'min_order': float(b.get('min_order') or 0), 'category': b.get('category'),
                'starts_at': b.get('starts_at'), 'ends_at': b.get('ends_at'),
                'usage_limit': int(b.get('usage_limit') or 0), 'used_count': 0,
                'active': bool(b.get('active', True)), 'live': bool(b.get('active', True)),
            }
            existing = next((d for d in STATE['discounts'] if d['id'] == row['id']), None)
            if existing:
                row['used_count'] = existing['used_count']
                STATE['discounts'][STATE['discounts'].index(existing)] = row
            else:
                STATE['next_discount'] += 1
                STATE['discounts'].append(row)
            return self._json(200, {'id': row['id']})

        if r == 'discount_active':
            for d in STATE['discounts']:
                if d['id'] == int(b.get('id') or 0):
                    d['active'] = bool(b.get('active'))
                    return self._json(200, {'ok': True})
            return self._json(400, {'error': 'not_found'})

        if r == 'discount_delete':
            target = next((d for d in STATE['discounts'] if d['id'] == int(b.get('id') or 0)), None)
            if not target:
                return self._json(400, {'error': 'not_found'})
            # Mirrors admin.php: a discount an order was placed with is
            # history, not clutter — the server answers 409 discount_in_use
            # (it counts orders carrying the code; used_count is the
            # fixture's stand-in for that).
            if target['used_count'] > 0:
                return self._json(409, {'error': 'discount_in_use'})
            STATE['discounts'].remove(target)
            return self._json(200, {'ok': True})

        if r == 'return_status':
            target = next((x for x in STATE['returns'] if x['id'] == int(b.get('id') or 0)), None)
            if not target:
                return self._json(404, {'error': 'not_found'})
            to = b.get('status')
            if to not in ('new', 'approved', 'picked_up', 'refunded', 'rejected', 'cancelled'):
                return self._json(422, {'error': 'bad_status'})
            note = (b.get('note') or '').strip() or None
            # Mirrors admin.php: a rejection without a reason is refused. The
            # customer is told why, and "no reason given" is not something the
            # shop should be able to send.
            if to == 'rejected' and not note:
                return self._json(422, {'error': 'reason_required'})
            target['status'] = to
            if note:
                target['staff_note'] = note
            # decided_at is set once, the first time it leaves 'new', and never
            # moved again — same as the SQL.
            if target['decided_at'] is None and to != 'new':
                target['decided_at'] = '2026-08-28 12:00:00'
            return self._json(200, {'ok': True})

        self._json(404, {'error': 'not_found'})


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    print(f'mock admin.php + dist on http://127.0.0.1:{port}')
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
