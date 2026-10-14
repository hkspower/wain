"""Before/after crops for the alignment pass (owner's «make full aligment», 2026-10-14).

  python3 design/alignment_shots.py shoot before <almuhallab-dir>   # e.g. a git-archive of HEAD
  python3 design/alignment_shots.py shoot after                     # this checkout
  python3 design/alignment_shots.py pairs                           # before | after, side by side

`shoot` writes design/out/alignment/<label>/<name>.png (full-page clips, the
element and a margin around it, at the six sizes the pass was verified at).
`pairs` writes design/out/alignment/pairs/<name>.png, each a before panel
beside an after panel, so a change is judged by looking at both.
"""
import functools, http.server, io, pathlib, socketserver, sys, threading, time
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parent.parent
OUT = REPO / "design" / "out" / "alignment"
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
PORT = 8763

SEED_DEL = """() => {
  const o = (id, cust, amt, st, cr) => ({ id, customer: cust, phone: '99887766', address: 'السالمية',
    items: 'طلب', amount: amt, courier: cr, status: st, createdAt: '2026-10-01T10:00:00.000Z' });
  localStorage.setItem('nokhatha-delivery-couriers-v1', JSON.stringify([
    { name: 'سالم', phone: '99012345' }, { name: 'خالد', phone: '99001122' }]));
  localStorage.setItem('nokhatha-delivery-orders-v1', JSON.stringify([
    o('ORD-0001', 'عميل ١', 7.5, 3, 'سالم'), o('ORD-0002', 'عميل ٢', 12.25, 4, ''),
    o('ORD-0003', 'عميل ٣', 3, 3, 'خالد'), o('ORD-0004', 'عميل ٤', 9, 0, ''),
    o('ORD-0005', 'عميل ٥', 15.5, 1, 'سالم'), o('ORD-0006', 'عميل ٦', 4.25, 2, '')]));
}"""
SEED_SAFI = """() => {
  localStorage.setItem('nokhatha-safi-v1', JSON.stringify([
    { ticker: 'NBK', name: 'بنك الكويت الوطني', qty: 100, cost: 850, price: 900 },
    { ticker: 'ZAIN', name: 'زين', qty: 200, cost: 500, price: 480 },
    { ticker: 'AGILITY', name: 'أجيليتي', qty: 150, cost: 620, price: 700 },
    { ticker: 'KFH', name: 'بيت التمويل', qty: 300, cost: 300, price: 310 }]));
}"""
SEED_USERS = """() => {
  const u = (name, st) => ({ name, status: st, createdAt: '2026-10-01T10:00:00.000Z' });
  localStorage.setItem('nokhatha-users-v1', JSON.stringify({
    'ali@example.com': u('علي', 'active'), 'sara@example.com': u('سارة', 'active'),
    'omar@example.com': u('عمر', 'suspended'), 'mona@example.com': u('منى', 'active') }));
}"""

# (name, page, (width, height), setup, selectors whose union is cropped)
#   setup: 'del' / 'safi' seed the records and reload; 'validate' runs the statement's
#   check; 'admin' signs in to the console; 'admin:<tab>' also opens a tab
SHOTS = [
    ("c1-product-1440", "index.html", (1440, 900), None, [".product.lead"]),
    ("c1-product-390", "index.html", (390, 844), None, [".product.lead"]),
    ("c2-tabs-1440", "index.html", (1440, 900), None, ["svg.scene.wide"]),
    ("c3-footer-768", "index.html", (768, 1024), None, [".fcols"]),
    ("c4-flowmap-1440", "index.html", (1440, 900), None, [".flowmap"]),
    ("c5-channels-768", "index.html", (768, 1024), None, [".channels"]),
    ("c6-stats-320", "index.html", (320, 640), None, [".hero .stats"]),
    ("c7-steps-390", "index.html", (390, 844), None, ["ol.flow"]),
    ("c8-kicker-1440", "index.html", (1440, 900), None, [".hero .kicker"]),
    ("c8-masthead-1440", "index.html", (1440, 900), None, ["header .brand"]),
    ("p1-register-1440", "nokhatha.html#/register", (1440, 900), None, ["#page-register h2.section", "#form-register"]),
    ("p2-bar-768", "nokhatha.html#/", (768, 1024), None, ["header"]),
    ("p3-pricing-1024", "nokhatha.html#/pricing", (1024, 768), None, ["#page-pricing"]),
    ("p4-cards-1440", "nokhatha.html#/", (1440, 900), None, ["#mcp-grid-home"]),
    ("p5-footer-390", "nokhatha.html#/", (390, 844), None, ["footer"]),
    ("s1-orders-1440", "nizam.html#/delivery", (1440, 900), "del", ["#del-orders"]),
    ("s2-tiles-844", "nizam.html#/position", (844, 390), None, ["#pos-tiles"]),
    ("s2-tiles-768", "nizam.html#/safi", (768, 1024), "safi", ["#safi-tiles"]),
    ("s3-fieldset-1440", "nizam.html#/xbrl", (1440, 900), None, ["#xbrl-form fieldset:last-of-type"]),
    ("s4-plot-1440", "nizam.html#/safi", (1440, 900), "safi", ["#safi-chart"]),
    ("s5-social-1440", "nizam.html#/social", (1440, 900), None, ["#soc-channels", "#soc-tags"]),
    ("s6-derive-1440", "nizam.html#/xbrl", (1440, 900), None, ["#xbrl-derive", "#xbrl-derive + .note"]),
    ("s7-chips-1440", "nizam.html#/delivery", (1440, 900), "del", ["#del-couriers"]),
    ("s8-form-1440", "nizam.html#/delivery", (1440, 900), "del", ["#del-form"]),
    ("s9-status-1440", "nizam.html#/xbrl", (1440, 900), "validate", ["#xbrl-check", "#xbrl-audit"]),
    ("s10-legend-1440", "nizam.html#/xbrl", (1440, 900), None, ["#xbrl-form fieldset:first-of-type"]),
    ("s11-phone-390", "nizam.html#/xbrl", (390, 844), None, ["#xbrl-validate", "#xbrl-preview"]),
    ("s12-footer-390", "nizam.html#/position", (390, 844), None, ["footer.site"]),
    ("a1-tiles-1440", "admin.html", (1440, 900), "admin", ["#tab-overview .tiles"]),
    ("a2-charts-1440", "admin.html", (1440, 900), "admin", ["#charts"]),
    ("a3-bulk-320", "admin.html", (320, 640), "admin:customers", ["#tab-customers .toolbar"]),
    ("a4-status-390", "admin.html", (390, 844), "admin:customers", ["#tab-customers .toolbar"]),
    ("a5-ticks-1440", "admin.html", (1440, 900), "admin:customers", ["#cust-rows"]),
    ("a6-tabs-1440", "admin.html", (1440, 900), "admin", ["nav.tabs", "#tab-overview .tiles"]),
]
DPR_PHONE = 2


def _serve(root):
    Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    class Quiet(Handler.func):
        def log_message(self, *a): pass
    h = functools.partial(Quiet, directory=str(root))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), h)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.3)
    return httpd


def _prepare(pg, setup):
    if setup == "del":
        pg.evaluate(SEED_DEL); pg.reload(wait_until="networkidle")
    elif setup == "safi":
        pg.evaluate(SEED_SAFI); pg.reload(wait_until="networkidle")
    elif setup == "validate":
        pg.click("#xbrl-validate"); pg.wait_for_timeout(200)
    elif setup and setup.startswith("admin"):
        pg.evaluate("localStorage.clear()"); pg.reload(wait_until="networkidle")
        pg.evaluate(SEED_USERS)
        pg.fill('#gate-form input[name="pass"]', "AdminPass123")
        pg.fill('#gate-form input[name="confirm"]', "AdminPass123")
        pg.evaluate("document.getElementById('gate-form').requestSubmit()"); pg.wait_for_timeout(1500)
        if ":" in setup:
            pg.click(f'nav.tabs button[data-tab="{setup.split(":")[1]}"]'); pg.wait_for_timeout(200)
    pg.evaluate("document.querySelectorAll('.callfab').forEach(e => e.remove())")


def shoot(label, root):
    d = OUT / label; d.mkdir(parents=True, exist_ok=True)
    httpd = _serve(pathlib.Path(root))
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(executable_path=CHROME)
            for name, page, (w, h), setup, sels in SHOTS:
                phone = w <= 844
                c = br.new_context(viewport={"width": w, "height": h}, is_mobile=phone, has_touch=phone,
                                   device_scale_factor=DPR_PHONE if phone else 1,
                                   reduced_motion="reduce", locale="ar-KW")
                pg = c.new_page()
                pg.goto(f"http://127.0.0.1:{PORT}/{page}", wait_until="networkidle"); pg.wait_for_timeout(300)
                _prepare(pg, setup)
                box = pg.evaluate("""(sels) => {
                  const rs = sels.flatMap(s => [...document.querySelectorAll(s)])
                    .filter(e => e.checkVisibility() && e.getBoundingClientRect().width > 0)
                    .map(e => e.getBoundingClientRect());
                  const l = Math.min(...rs.map(r => r.left)), r = Math.max(...rs.map(r => r.right));
                  const t = Math.min(...rs.map(r => r.top)), b = Math.max(...rs.map(r => r.bottom));
                  const m = 14, sx = window.scrollX, sy = window.scrollY;
                  return { x: Math.max(0, l - m + sx), y: Math.max(0, t - m + sy),
                           width: Math.min(document.documentElement.clientWidth - Math.max(0, l - m), r - l + 2 * m),
                           height: b - t + 2 * m }; }""", sels)
                png = pg.screenshot(full_page=True, clip=box)
                (d / f"{name}.png").write_bytes(png)
                c.close()
            br.close()
    finally:
        httpd.shutdown()
    print(f"{label}: {len(SHOTS)} crops in {d.relative_to(REPO)}")


def pairs():
    before, after = OUT / "before", OUT / "after"
    (OUT / "pairs").mkdir(parents=True, exist_ok=True)
    font = None
    for name, *_ in SHOTS:
        a, b = before / f"{name}.png", after / f"{name}.png"
        if not (a.is_file() and b.is_file()):
            continue
        A, B = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
        H = max(A.height, B.height) + 28
        W = A.width + B.width + 24
        canvas = Image.new("RGB", (W, H), (60, 60, 60))
        d = ImageDraw.Draw(canvas)
        canvas.paste(A, (0, 28)); canvas.paste(B, (A.width + 24, 28))
        d.text((8, 8), f"before  {name}", fill=(255, 255, 255))
        d.text((A.width + 32, 8), "after", fill=(255, 255, 255))
        canvas = canvas.quantize(colors=256, method=Image.Quantize.MEDIANCUT).convert("RGB")
        canvas.save(OUT / "pairs" / f"{name}.png", optimize=True)
    print(f"pairs written to {(OUT / 'pairs').relative_to(REPO)}")


if __name__ == "__main__":
    if sys.argv[1:2] == ["shoot"]:
        label = sys.argv[2]
        root = sys.argv[3] if len(sys.argv) > 3 else str(REPO / "almuhallab")
        shoot(label, root)
    elif sys.argv[1:2] == ["pairs"]:
        pairs()
    else:
        print(__doc__)
