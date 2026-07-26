"""
Nokha1 (النوخذة) — full system test.

Static checks, then a real browser exercising every page: arithmetic, generated
artefacts, auth, hostile input, storage tampering, offline, and layout.
Run:  python3 design/test_suite.py
"""
import http.server, socketserver, threading, functools, time, json, re, pathlib, sys
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path("/home/user/wain/almuhallab")
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
PORT = 8751
BASE = f"http://127.0.0.1:{PORT}"
# index.html is the Almuhallab Code company site; Nokha1 is a product inside it,
# entered at nokha1.html. The three service units are tabs of nizam.html, and the
# old unit filenames survive as redirect stubs so existing links keep working.
PAGES = ["index.html", "nokha1.html", "nizam.html", "editor.html", "admin.html"]
STUBS = {"safi.html": "nizam.html#/safi", "xbrl.html": "nizam.html#/xbrl",
         "delivery.html": "nizam.html#/delivery"}

results = []
def check(section, name, ok, detail=""):
    results.append((section, name, bool(ok), detail))

# ═══════════════════════════════════════════ colour maths (shared)
def _rgb(h):
    h = h.lstrip("#"); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def _lin(c):
    c /= 255; return c/12.92 if c <= 0.04045 else ((c+0.055)/1.055) ** 2.4
def lum(h):
    r, g, b = _rgb(h); return 0.2126*_lin(r) + 0.7152*_lin(g) + 0.0722*_lin(b)
def contrast(a, b):
    la, lb = lum(a), lum(b); hi, lo = max(la, lb), min(la, lb); return (hi+0.05)/(lo+0.05)

# ═══════════════════════════════════════════ 1. STATIC
def static_checks():
    S = "static"
    texts = {p: (ROOT / p).read_text() for p in PAGES}

    # every page carries the same token set, light and dark
    def tokens(src, dark=False):
        pat = (r"prefers-color-scheme: dark\)\s*\{\s*:root\s*\{(.*?)\}" if dark
               else r":root\s*\{(.*?)\}")
        m = re.search(pat, src, re.S)
        return dict(re.findall(r"--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})", m.group(1))) if m else {}
    light = {p: tokens(t) for p, t in texts.items()}
    dark = {p: tokens(t, True) for p, t in texts.items()}
    CORE = ["bg", "panel", "panel-2", "panel-3", "border", "border-input",
            "text", "muted", "tint", "tint-strong", "sand", "good", "danger", "info"]
    for label, sets in (("light", light), ("dark", dark)):
        keys = sorted({k for d in sets.values() for k in d})
        # a token defined on two pages must hold the same value on both
        conflict = [k for k in keys if len({d[k] for d in sets.values() if k in d}) > 1]
        check(S, f"{label}: no token holds different values across pages",
              not conflict, f"conflicting: {conflict[:6]}")
        missing = {p: [c for c in CORE if c not in d] for p, d in sets.items()}
        missing = {p: v for p, v in missing.items() if v}
        check(S, f"{label}: every page defines the core token set", not missing, str(missing))

    # no undefined custom properties, and every script parses
    for p, t in texts.items():
        used = {m.group(1) for m in re.finditer(r"var\(--([\w-]+)\)", t)}
        undefined = [u for u in used if not re.search(rf"--{re.escape(u)}\s*:", t)]
        check(S, f"{p}: no undefined CSS variables", not undefined, str(undefined[:5]))
        check(S, f"{p}: has a Content-Security-Policy", "Content-Security-Policy" in t)

    # the no-beige rule, enforced numerically: light surfaces must not be warm
    L = light["index.html"]
    warm = []
    for tok in ("bg", "panel", "panel-2", "panel-3", "border"):
        r, g, b = _rgb(L[tok])
        if r > b + 6:                       # red meaningfully above blue == a warm/cream cast
            warm.append(f"{tok}={L[tok]}")
    check(S, "light surfaces are not beige (no warm cast)", not warm, ", ".join(warm))

    # contrast, both themes
    for label, P in (("light", light["index.html"]), ("dark", dark["index.html"])):
        bad = []
        for ink in ("text", "muted", "tint", "sand", "good", "danger", "info"):
            for surf in ("panel", "bg", "panel-2", "panel-3"):
                need = 7.0 if ink == "text" else 4.5
                r = contrast(P[ink], P[surf])
                if r < need: bad.append(f"{ink}/{surf}={r:.2f}")
        check(S, f"{label}: every ink clears contrast on every surface", not bad, ", ".join(bad[:4]))
        check(S, f"{label}: white on primary button >= 4.5",
              contrast("#ffffff", P["tint-strong"]) >= 4.5,
              f"{contrast('#ffffff', P['tint-strong']):.2f}")
        check(S, f"{label}: field border >= 3:1",
              contrast(P["border-input"], P["panel-2"]) >= 3.0,
              f"{contrast(P['border-input'], P['panel-2']):.2f}")

    # links and the service-worker precache must resolve to real files
    broken = []
    for p, t in texts.items():
        for m in re.finditer(r'(?:href|src)="([^":#?]+\.(?:html|svg|webmanifest|js))"', t):
            if not (ROOT / m.group(1)).exists(): broken.append(f"{p} -> {m.group(1)}")
    sw = (ROOT / "sw.js").read_text()
    for m in re.finditer(r'"([a-z0-9._-]+\.(?:html|webmanifest|svg))"', sw):
        if not (ROOT / m.group(1)).exists(): broken.append(f"sw.js -> {m.group(1)}")
    check(S, "every internal link and precache entry resolves", not broken, str(broken[:4]))

    # every page must be precached, or it breaks offline
    missing = [p for p in list(PAGES) + list(STUBS) if f'"{p}"' not in sw]
    check(S, "service worker precaches every page", not missing, str(missing))

    # each retired page must still send visitors to its tab
    for stub, dest in STUBS.items():
        t = (ROOT / stub).read_text()
        check(S, f"{stub} redirects to {dest}",
              f'url={dest}' in t and f'location.replace("{dest}")' in t)

    # the root is the company, not the product
    home, portal = texts["index.html"], texts["nokha1.html"]
    check(S, "the root page is the Almuhallab Code company site",
          "Almuhallab Code" in home and "شركة برمجة" in home)
    check(S, "the root page carries no Nokha1 account UI",
          'id="form-register"' not in home and 'id="form-login"' not in home)
    check(S, "the root page leads into Nokha1", 'href="nokha1.html"' in home)
    check(S, "Nokha1 is entered at nokha1.html", 'id="form-register"' in portal)
    check(S, "Nokha1 links back out to the company site", 'href="index.html"' in portal)

    mf = json.loads((ROOT / "manifest.webmanifest").read_text())
    check(S, "the installable app starts at Nokha1", mf["start_url"] == "nokha1.html",
          mf["start_url"])
    check(S, "manifest has the required fields",
          all(k in mf for k in ("name", "start_url", "display", "icons")))

# ═══════════════════════════════════════════ browser sections
XSS = '<img src=x onerror="window.__pwned=1">'

def browser_checks():
    Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    time.sleep(0.5)

    with sync_playwright() as pw:
        br = pw.chromium.launch(executable_path=CHROME)
        ctx = br.new_context(viewport={"width": 1440, "height": 900}, locale="ar-KW",
                             accept_downloads=True)
        errs = []
        ctx.on("weberror", lambda e: errs.append(str(e.error)))
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(str(e)))

        intro_checks(pg)
        safi_checks(pg)
        integration_checks(pg)
        xbrl_checks(pg)
        delivery_checks(pg)
        timezone_checks(br)
        auth_checks(pg, ctx)
        tamper_checks(pg)
        offline_checks(ctx, br)
        layout_checks(br)
        font_checks(pg)

        check("runtime", "no uncaught JavaScript errors anywhere", not errs, " | ".join(errs[:3]))
        br.close()
    httpd.shutdown()

# ───────────────────────────── SAFI: arithmetic, export, injection
def safi_checks(pg):
    S = "safi"
    pg.goto(f"{BASE}/nizam.html#/safi", wait_until="networkidle")
    pg.evaluate("localStorage.clear()")
    pg.reload(wait_until="networkidle")

    def add(t, n, q, c, p):
        pg.fill('input[name="ticker"]', t); pg.fill('input[name="name"]', n)
        pg.fill('input[name="qty"]', str(q)); pg.fill('input[name="cost"]', str(c))
        pg.fill('input[name="price"]', str(p))
        pg.click('#safi-form button[type="submit"]'); pg.wait_for_timeout(140)

    add("NBK", "بنك الكويت الوطني", 12000, 850, 921)   # +852.000
    add("ZAIN", "زين", 8500, 452, 438)                  # -119.000
    pg.wait_for_timeout(250)

    # value = qty * price fils / 1000 ; P/L = value - cost
    cost = 12000*850/1000 + 8500*452/1000                  # 14041.000
    val  = 12000*921/1000 + 8500*438/1000                  # 14775.000
    got_cost = pg.inner_text("#s-cost").replace(",", "")
    got_val  = pg.inner_text("#s-value").replace(",", "")
    got_pl   = pg.inner_text("#s-pl").replace(",", "")
    check(S, "total cost is exact", abs(float(got_cost) - cost) < .001, f"{got_cost} vs {cost:.3f}")
    check(S, "market value is exact", abs(float(got_val) - val) < .001, f"{got_val} vs {val:.3f}")
    check(S, "profit/loss is exact", abs(float(got_pl) - (val - cost)) < .001,
          f"{got_pl} vs {val-cost:.3f}")
    check(S, "a losing position is marked as a loss",
          "down" in (pg.get_attribute("#safi-rows tr:nth-child(2) td:nth-child(7)", "class") or ""))

    # updating an existing ticker replaces it rather than duplicating
    add("NBK", "بنك الكويت الوطني", 1000, 800, 900)
    check(S, "re-adding a ticker updates in place",
          pg.eval_on_selector_all("#safi-rows tr", "n=>n.length") == 2)

    # hostile company name must render as text, and must not become a formula
    add("EVIL", XSS + ",=1+1", 10, 100, 100)
    pg.wait_for_timeout(200)
    check(S, "XSS payload does not execute",
          pg.evaluate("window.__pwned === undefined"))
    check(S, "XSS payload is rendered as visible text",
          XSS in pg.inner_text("#safi-rows"))
    with pg.expect_download() as dl:
        pg.click("#safi-export")
    csv = pathlib.Path(dl.value.path()).read_text()
    formula_rows = [l for l in csv.splitlines()[1:] if re.match(r'^[^,]*,"?[=+\-@]', l)]
    check(S, "CSV export neutralises spreadsheet formulas", not formula_rows, str(formula_rows[:1]))
    check(S, "CSV contains a row per holding", len(csv.strip().splitlines()) == 4,
          f"{len(csv.strip().splitlines())} lines")

# ───────────── the animated Nokha1 intro on the company page
def intro_checks(pg):
    """The demo must actually play: sources count up, the XBRL tiles receive
    the same figures, and reduced-motion visitors get the final frame."""
    S = "intro"
    pg.goto(f"{BASE}/index.html", wait_until="networkidle")
    pg.eval_on_selector("#demo", "e=>e.scrollIntoView({block:'center'})")
    pg.wait_for_timeout(5200)                      # one pass: count → fly → feed
    safi = pg.inner_text("#d-safi").replace(",", "")
    nca = pg.inner_text("#d-nca").replace(",", "")
    check(S, "the source figure counts up to its value", safi == "30481.400", safi)
    check(S, "the XBRL tile receives the same figure", nca == safi, f"{nca} vs {safi}")
    check(S, "the receiving tiles are marked as fed",
          pg.eval_on_selector("#d-nca-t", "e=>e.classList.contains('fed')")
          and pg.eval_on_selector("#d-rev-t", "e=>e.classList.contains('fed')"))
    check(S, "the narration reaches the derive step",
          pg.eval_on_selector_all("#intro-steps li.lit", "n=>n.length") == 1)

    # reduced motion: no animation, but the story's final frame is shown
    c = pg.context.browser.new_context(reduced_motion="reduce", locale="ar-KW")
    rp = c.new_page()
    rp.goto(f"{BASE}/index.html", wait_until="networkidle"); rp.wait_for_timeout(400)
    check(S, "reduced motion shows the final frame instead",
          rp.inner_text("#d-nca").replace(",", "") == "30481.400"
          and rp.eval_on_selector("#d-nca-t", "e=>e.classList.contains('fed')"))
    c.close()

# ───────────── the integration: one data core feeding the statements
def integration_checks(pg):
    """SAFI and Delivery must actually reach XBRL — that is the whole point of
    the unified system. Runs right after safi_checks, whose holdings it reuses."""
    S = "integration"
    pg.goto(f"{BASE}/nizam.html#/delivery", wait_until="networkidle")
    pg.evaluate("localStorage.removeItem('nokhatha-delivery-orders-v1')")
    pg.reload(wait_until="networkidle")

    def order(amount):
        pg.fill('#del-form input[name="customer"]', "عميل")
        pg.fill('#del-form input[name="phone"]', "99887766")
        pg.fill('#del-form input[name="address"]', "السالمية")
        pg.fill('#del-form input[name="items"]', "طلب")
        pg.fill('#del-form input[name="amount"]', f"{amount:.3f}")
        pg.click('#del-form button[type="submit"]'); pg.wait_for_timeout(160)

    order(7.5); order(12.25)
    for _ in range(3):                                   # deliver the first only
        pg.click('button[data-next="0"]'); pg.wait_for_timeout(150)

    holdings = pg.evaluate("JSON.parse(localStorage.getItem('nokhatha-safi-v1'))")
    market = sum(h["qty"] * h["price"] / 1000 for h in holdings)

    # the position tab states the combined figures
    pg.goto(f"{BASE}/nizam.html#/position", wait_until="networkidle")
    pg.wait_for_timeout(250)
    got_val = float(pg.inner_text("#p-value").replace(",", ""))
    got_rev = float(pg.inner_text("#p-revenue").replace(",", ""))
    got_net = float(pg.inner_text("#p-net").replace(",", ""))
    check(S, "position shows the portfolio market value", abs(got_val - market) < .001,
          f"{got_val} vs {market:.3f}")
    check(S, "position shows delivered revenue only", abs(got_rev - 7.5) < .001, str(got_rev))
    check(S, "combined resources are the sum of both units",
          abs(got_net - (market + 7.5)) < .001, f"{got_net} vs {market + 7.5:.3f}")
    check(S, "the linkage is stated on screen, not just implied",
          "الأصول غير المتداولة" in pg.inner_text("#flow")
          and "الإيرادات" in pg.inner_text("#flow"))

    # and the derive button pushes them into the financial statements
    pg.goto(f"{BASE}/nizam.html#/xbrl", wait_until="networkidle")
    pg.fill('input[name="nonCurrentAssets"]', "0"); pg.fill('input[name="revenue"]', "0")
    pg.click("#xbrl-derive"); pg.wait_for_timeout(250)
    nca = float(pg.input_value('input[name="nonCurrentAssets"]'))
    rev = float(pg.input_value('input[name="revenue"]'))
    check(S, "SAFI market value becomes non-current assets", abs(nca - market) < .001,
          f"{nca} vs {market:.3f}")
    check(S, "delivered orders become revenue", abs(rev - 7.5) < .001, str(rev))
    check(S, "net income follows the derived revenue",
          abs(float(pg.input_value('input[name="netIncome"]')) - 7.5) < .001)
    check(S, "derived fields are marked as derived",
          "derived" in (pg.get_attribute('input[name="revenue"]', "class") or ""))

    # a derived figure stays editable — the derivation is a starting point
    pg.fill('input[name="revenue"]', "99.000"); pg.wait_for_timeout(150)
    check(S, "editing a derived field clears the marker",
          "derived" not in (pg.get_attribute('input[name="revenue"]', "class") or ""))

    # all four modules share one page, so one storage clear resets everything
    pg.goto(f"{BASE}/nizam.html#/position", wait_until="networkidle")
    keys = pg.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('nokhatha-'))")
    check(S, "the unified page uses the established storage keys",
          "nokhatha-safi-v1" in keys and "nokhatha-delivery-orders-v1" in keys, str(keys))


# ───────────────────────────── XBRL: validation, XML, date arithmetic
def xbrl_checks(pg):
    S = "xbrl"
    pg.goto(f"{BASE}/nizam.html#/xbrl", wait_until="networkidle")

    def fill(period, end, ca, nca, cl, ncl, eq, rev, exp):
        pg.fill('input[name="entity"]', "شركة المهلب القابضة")
        pg.fill('input[name="lei"]', "254900MHLLB2026KW01")
        pg.select_option('select[name="period"]', period)
        pg.fill('input[name="periodEnd"]', end)
        for k, v in [("currentAssets", ca), ("nonCurrentAssets", nca),
                     ("currentLiabilities", cl), ("nonCurrentLiabilities", ncl),
                     ("equity", eq), ("revenue", rev), ("expenses", exp)]:
            pg.fill(f'input[name="{k}"]', f"{v:.3f}")
        pg.wait_for_timeout(120)

    # unbalanced must be rejected
    fill("FY", "2026-12-31", 100, 100, 50, 50, 50, 10, 5)     # assets 200 vs 150
    pg.click("#xbrl-validate"); pg.wait_for_timeout(200)
    check(S, "an unbalanced sheet is reported as unbalanced",
          "غير متوازنة" in pg.inner_text("#xbrl-check"))
    check(S, "the imbalance amount is stated", "50.000" in pg.inner_text("#xbrl-check"))

    # net income is derived, not typed
    check(S, "net income is computed as revenue - expenses",
          abs(float(pg.input_value('input[name="netIncome"]')) - 5.0) < .001)

    # balanced: assets == liabilities + equity
    fill("FY", "2026-12-31", 4820.5, 11350, 2310.25, 5140.75, 8719.5, 9640, 6215.375)
    pg.click("#xbrl-validate"); pg.wait_for_timeout(200)
    check(S, "a balanced sheet passes", "متوازنة" in pg.inner_text("#xbrl-check")
          and "غير" not in pg.inner_text("#xbrl-check"))

    pg.click("#xbrl-preview"); pg.wait_for_timeout(400)
    xml = pg.inner_text("#xbrl-out")
    try:
        ET.fromstring(xml); wf = True; err = ""
    except Exception as e:
        wf = False; err = str(e)
    check(S, "generated XBRL is well-formed XML", wf, err)

    ns = {"i": "https://xbrl.ifrs.org/taxonomy/2024-03-27/ifrs-full"}
    if wf:
        root = ET.fromstring(xml)
        def fact(tag):
            el = root.find(f"i:{tag}", ns); return float(el.text) if el is not None else None
        check(S, "Assets fact equals the sum of its parts", fact("Assets") == 16170.5, str(fact("Assets")))
        check(S, "EquityAndLiabilities equals Assets",
              fact("EquityAndLiabilities") == fact("Assets"),
              f"{fact('EquityAndLiabilities')} vs {fact('Assets')}")
        check(S, "ProfitLoss fact is correct", abs(fact("ProfitLoss") - 3424.625) < .001,
              str(fact("ProfitLoss")))
        check(S, "amounts are stated in KWD",
              root.find(".//{http://www.xbrl.org/2003/instance}measure").text == "iso4217:KWD")
        dur = [c for c in root.findall("{http://www.xbrl.org/2003/instance}context")
               if c.get("id") == "Duration"][0]
        start = dur.find(".//{http://www.xbrl.org/2003/instance}startDate").text
        check(S, "annual period starts the day after the prior year end",
              start == "2026-01-01", f"start={start}")

    # quarter ending on a 31st — month arithmetic must not overflow into the wrong month
    fill("Q2", "2026-05-31", 100, 0, 40, 0, 60, 10, 4)
    pg.click("#xbrl-preview"); pg.wait_for_timeout(400)
    xml2 = pg.inner_text("#xbrl-out")
    m = re.search(r"<startDate>([\d-]+)</startDate>", xml2)
    start2 = m.group(1) if m else "?"
    check(S, "quarter ending 31 May starts 1 March (no month overflow)",
          start2 == "2026-03-01", f"start={start2} (expected 2026-03-01)")

    # entity name is XML-escaped
    pg.fill('input[name="entity"]', 'A & B <script>"x"')
    pg.click("#xbrl-preview"); pg.wait_for_timeout(300)
    out = pg.inner_text("#xbrl-out")
    check(S, "entity name is XML-escaped", "&amp;" in out and "<script>" not in out)

def timezone_checks(br):
    """A filing date must be the same in Kuwait as in Honolulu."""
    S = "xbrl"
    got = {}
    for tz in ("UTC", "Asia/Kuwait", "Pacific/Kiritimati", "Pacific/Honolulu"):
        c = br.new_context(timezone_id=tz, locale="ar-KW")
        p = c.new_page()
        p.goto(f"{BASE}/nizam.html#/xbrl", wait_until="networkidle")
        p.fill('input[name="entity"]', "س"); p.fill('input[name="lei"]', "ABCD1234")
        p.select_option('select[name="period"]', "FY")
        p.fill('input[name="periodEnd"]', "2026-12-31")
        for k in ("currentAssets", "nonCurrentAssets", "currentLiabilities",
                  "nonCurrentLiabilities", "equity", "revenue", "expenses"):
            p.fill(f'input[name="{k}"]', "0.000")
        p.click("#xbrl-preview"); p.wait_for_timeout(350)
        m = re.search(r"<startDate>([\d-]+)</startDate>", p.inner_text("#xbrl-out"))
        got[tz] = m.group(1) if m else "?"
        c.close()
    check(S, "the period start is identical in every timezone",
          len(set(got.values())) == 1 and got["UTC"] == "2026-01-01", str(got))

# ───────────────────────────── Delivery: ids, pipeline, stats
def delivery_checks(pg):
    S = "delivery"
    pg.goto(f"{BASE}/nizam.html#/delivery", wait_until="networkidle")
    pg.evaluate("localStorage.removeItem('nokhatha-delivery-orders-v1');"
                "localStorage.removeItem('nokhatha-delivery-couriers-v1')")
    pg.reload(wait_until="networkidle")

    pg.fill('#del-courier-form input[name="cname"]', "سالم")
    pg.fill('#del-courier-form input[name="cphone"]', "99012345")
    pg.click('#del-courier-form button[type="submit"]'); pg.wait_for_timeout(160)

    def order(cust, amount):
        pg.fill('#del-form input[name="customer"]', cust)
        pg.fill('#del-form input[name="phone"]', "99887766")
        pg.fill('#del-form input[name="address"]', "السالمية")
        pg.fill('#del-form input[name="items"]', "طلب")
        pg.fill('#del-form input[name="amount"]', str(amount))
        pg.click('#del-form button[type="submit"]'); pg.wait_for_timeout(160)

    order("عميل ١", 7.5); order("عميل ٢", 12.25); order(XSS, 3.0)
    ids = pg.evaluate("JSON.parse(localStorage.getItem('nokhatha-delivery-orders-v1')).map(o=>o.id)")
    check(S, "order ids are sequential and zero-padded", ids == ["ORD-0001", "ORD-0002", "ORD-0003"], str(ids))
    check(S, "hostile customer name does not execute", pg.evaluate("window.__pwned === undefined"))
    check(S, "hostile customer name renders as text", XSS in pg.inner_text("#del-orders"))

    # advance the first order to delivered; revenue counts only delivered
    for _ in range(3):
        pg.click('button[data-next="0"]'); pg.wait_for_timeout(160)
    check(S, "status advances to delivered", "تم التسليم" in pg.inner_text("#del-orders"))
    check(S, "revenue counts only delivered orders",
          pg.inner_text("#s-revenue").replace(",", "") == "7.500",
          pg.inner_text("#s-revenue"))
    check(S, "delivered count is right", pg.inner_text("#s-done") == "1")
    check(S, "in-progress excludes delivered", pg.inner_text("#s-active") == "2",
          pg.inner_text("#s-active"))

    pg.click('button[data-cancel="1"]')
    pg.on("dialog", lambda d: d.accept())
    pg.wait_for_timeout(300)

    # a cancelled order must not count as in progress nor as revenue
    active = pg.inner_text("#s-active")
    check(S, "a cancelled order leaves the in-progress count", active == "1", f"active={active}")
    check(S, "cancelling does not change revenue",
          pg.inner_text("#s-revenue").replace(",", "") == "7.500")

    # a new order after cancellation continues the sequence
    order("عميل ٤", 5.0)
    ids2 = pg.evaluate("JSON.parse(localStorage.getItem('nokhatha-delivery-orders-v1')).map(o=>o.id)")
    check(S, "ids continue after a cancellation", ids2[-1] == "ORD-0004", str(ids2[-1]))

# ───────────────────────────── portal auth
def auth_checks(pg, ctx):
    S = "auth"
    pg.goto(f"{BASE}/nokha1.html#/register", wait_until="networkidle")
    pg.evaluate("localStorage.removeItem('nokhatha-users-v1');"
                "localStorage.removeItem('nokhatha-session-v1');"
                "localStorage.removeItem('nokhatha-lock-v1')")
    pg.goto(f"{BASE}/nokha1.html#/register", wait_until="networkidle")

    pg.fill('#form-register input[name="name"]', "محمد العلي")
    pg.fill('#form-register input[name="email"]', "t@example.com")
    pg.fill('#form-register input[name="password"]', "short")
    pg.click('#form-register button[type="submit"]'); pg.wait_for_timeout(600)
    created = pg.evaluate("!!(JSON.parse(localStorage.getItem('nokhatha-users-v1')||'{}'))"
                          "['t@example.com']")
    check(S, "a short password creates no account", not created)
    check(S, "the password field reports itself invalid",
          not pg.eval_on_selector('#form-register input[name="password"]', "e=>e.checkValidity()"))

    pg.fill('#form-register input[name="password"]', "correct-horse-2026")
    pg.click('#form-register button[type="submit"]'); pg.wait_for_timeout(2600)
    check(S, "registration reaches the dashboard", "/dashboard" in pg.url)

    rec = pg.evaluate("JSON.parse(localStorage.getItem('nokhatha-users-v1'))['t@example.com']")
    check(S, "password is never stored in plaintext",
          "correct-horse-2026" not in json.dumps(rec))
    check(S, "password is stored as a salted PBKDF2 hash",
          len(rec.get("hash", "")) == 64 and len(rec.get("salt", "")) == 32
          and rec.get("iter") == 310000, str({k: rec.get(k) for k in ("iter",)}))

    pg.click("#nav-logout"); pg.wait_for_timeout(600)
    pg.goto(f"{BASE}/nokha1.html#/login", wait_until="networkidle")
    pg.fill('#form-login input[name="email"]', "t@example.com")
    pg.fill('#form-login input[name="password"]', "wrong-password")
    pg.click('#form-login button[type="submit"]'); pg.wait_for_timeout(2600)
    check(S, "a wrong password is refused", "غير صحيحة" in pg.inner_text("#login-error"))

    # five failures must lock the account
    for _ in range(4):
        pg.click('#form-login button[type="submit"]'); pg.wait_for_timeout(2400)
    locked = "حاول بعد" in pg.inner_text("#login-error")
    if not locked:                      # the lock arms on the next attempt
        pg.click('#form-login button[type="submit"]'); pg.wait_for_timeout(2400)
        locked = "حاول بعد" in pg.inner_text("#login-error")
    check(S, "repeated failures lock the account", locked, pg.inner_text("#login-error"))

    # a suspended account cannot log in, even with the right password
    pg.evaluate("localStorage.removeItem('nokhatha-lock-v1');"
                "var u=JSON.parse(localStorage.getItem('nokhatha-users-v1'));"
                "u['t@example.com'].status='suspended';"
                "localStorage.setItem('nokhatha-users-v1', JSON.stringify(u))")
    pg.reload(wait_until="networkidle")
    pg.goto(f"{BASE}/nokha1.html#/login", wait_until="networkidle")
    pg.fill('#form-login input[name="email"]', "t@example.com")
    pg.fill('#form-login input[name="password"]', "correct-horse-2026")
    pg.click('#form-login button[type="submit"]'); pg.wait_for_timeout(2600)
    check(S, "a suspended account is refused the correct password",
          "موقوف" in pg.inner_text("#login-error") and "/dashboard" not in pg.url,
          pg.inner_text("#login-error"))

    # an expired session must not admit
    pg.evaluate("var u=JSON.parse(localStorage.getItem('nokhatha-users-v1'));"
                "u['t@example.com'].status='active';"
                "localStorage.setItem('nokhatha-users-v1', JSON.stringify(u));"
                "localStorage.setItem('nokhatha-session-v1',"
                " JSON.stringify({email:'t@example.com', exp: Date.now()-1000}))")
    pg.goto(f"{BASE}/nokha1.html#/dashboard", wait_until="networkidle")
    pg.wait_for_timeout(400)
    check(S, "an expired session is not accepted", "/dashboard" not in pg.url, pg.url)

# ───────────────────────────── storage tampering
def tamper_checks(pg):
    S = "robustness"
    hostile = {
        "nokhatha-safi-v1": '[{"ticker":123,"name":null,"qty":"abc","cost":-5,"price":1e308}]',
        "nokhatha-delivery-orders-v1": '[{"id":42,"customer":null,"amount":"x","status":99}]',
        "nokhatha-users-v1": '{"a@b.c":{"name":null,"plan":77,"createdAt":"nonsense"}}',
        "nokhatha-xbrl-reports-v1": '[{"entity":null,"assets":"x","profit":null}]',
    }
    for page, keys in (("nizam.html#/safi", ["nokhatha-safi-v1"]),
                       ("nizam.html#/delivery", ["nokhatha-delivery-orders-v1"]),
                       ("nizam.html#/xbrl", ["nokhatha-xbrl-reports-v1"]),
                       ("nokha1.html", ["nokhatha-users-v1"])):
        pg.goto(f"{BASE}/{page}", wait_until="networkidle")
        for k in keys:
            pg.evaluate(f"localStorage.setItem({json.dumps(k)}, {json.dumps(hostile[k])})")
        errs = []
        pg.once("pageerror", lambda e: errs.append(str(e)))
        pg.reload(wait_until="networkidle"); pg.wait_for_timeout(500)
        rendered = pg.evaluate("document.body.innerText.length > 40")
        check(S, f"{page} survives malformed stored data", not errs and rendered,
              (errs[0] if errs else "page rendered empty") if (errs or not rendered) else "")

    # corrupt JSON entirely
    pg.goto(f"{BASE}/nizam.html#/safi", wait_until="networkidle")
    pg.evaluate("localStorage.setItem('nokhatha-safi-v1','{not json at all')")
    errs = []
    pg.once("pageerror", lambda e: errs.append(str(e)))
    pg.reload(wait_until="networkidle"); pg.wait_for_timeout(400)
    check(S, "unparseable storage does not break the page", not errs,
          errs[0] if errs else "")
    pg.evaluate("localStorage.clear()")

# ───────────────────────────── PWA / offline
def offline_checks(ctx, br):
    S = "pwa-offline"
    pg = ctx.new_page()
    pg.goto(f"{BASE}/index.html", wait_until="networkidle")
    reg = pg.evaluate("navigator.serviceWorker.getRegistration().then(r=>!!r)")
    check(S, "service worker registers", reg)
    pg.wait_for_timeout(1500)                       # let precaching finish
    cached = pg.evaluate("""caches.keys().then(ks => ks.length
        ? caches.open(ks[0]).then(c => c.keys().then(rs => rs.map(r => new URL(r.url).pathname)))
        : [])""")
    for want in ("/index.html", "/nokha1.html", "/nizam.html", "/safi.html", "/delivery.html", "/admin.html"):
        check(S, f"precached {want}", any(p.endswith(want) for p in cached))

    ctx.set_offline(True)
    ok = True; detail = ""
    for p in ("index.html", "nokha1.html", "nizam.html", "nizam.html#/xbrl"):
        try:
            r = pg.goto(f"{BASE}/{p}", wait_until="domcontentloaded", timeout=8000)
            body = pg.evaluate("document.body.innerText.length")
            if body < 40: ok = False; detail = f"{p} rendered empty offline"
        except Exception as e:
            ok = False; detail = f"{p}: {e}"
    check(S, "pages still load with the network offline", ok, detail)
    ctx.set_offline(False)
    pg.close()

# ───────────────────────────── layout / responsive / themes
def layout_checks(br):
    S = "layout"
    for wname, w, h in (("mobile 360", 360, 780), ("tablet 768", 768, 1024), ("desktop 1440", 1440, 900)):
        c = br.new_context(viewport={"width": w, "height": h}, locale="ar-KW")
        p = c.new_page()
        overflow = []
        for page in ("index.html", "nokha1.html", "nizam.html", "nizam.html#/safi",
                     "nizam.html#/xbrl", "nizam.html#/delivery", "admin.html"):
            p.goto(f"{BASE}/{page}", wait_until="networkidle"); p.wait_for_timeout(300)
            sw_ = p.evaluate("document.documentElement.scrollWidth")
            cw = p.evaluate("document.documentElement.clientWidth")
            if sw_ > cw + 1: overflow.append(f"{page} ({sw_}>{cw})")
        check(S, f"{wname}: no horizontal overflow", not overflow, ", ".join(overflow))
        c.close()

    for scheme in ("light", "dark"):
        c = br.new_context(viewport={"width": 1280, "height": 860},
                           color_scheme=scheme, locale="ar-KW")
        p = c.new_page()
        p.goto(f"{BASE}/index.html", wait_until="networkidle"); p.wait_for_timeout(400)
        bg = p.evaluate("getComputedStyle(document.body).backgroundColor")
        want_light = bg.startswith("rgb(255, 255, 255")
        check(S, f"{scheme} theme applies", want_light if scheme == "light" else not want_light, bg)
        c.close()

def font_checks(pg):
    """The Arabic face must be bundled and actually used, not merely listed."""
    S = "typography"
    pg.goto(f"{BASE}/index.html", wait_until="networkidle")
    pg.wait_for_timeout(900)
    loaded = pg.evaluate("document.fonts.check('400 16px \"Plex Arabic\"')")
    check(S, "the bundled Arabic face loads", loaded)
    fam = pg.evaluate("getComputedStyle(document.querySelector('h1')).fontFamily")
    check(S, "Arabic text resolves to the bundled face first",
          fam.strip().startswith('"Plex Arabic"') or fam.strip().startswith("Plex Arabic"), fam)
    faces = pg.evaluate("[...document.fonts].filter(f=>f.family==='Plex Arabic').length")
    check(S, "all three weights are declared", faces == 3, f"{faces} faces")
    # the CSP must permit the font, or it silently never paints
    csp = pg.evaluate("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]').content")
    check(S, "CSP allows self-hosted fonts", "font-src 'self'" in csp)
    # and it must survive offline, since it is part of the shell
    cached = pg.evaluate("""caches.keys().then(ks => ks.length
        ? caches.open(ks[0]).then(c => c.keys().then(rs => rs.map(r => new URL(r.url).pathname)))
        : [])""")
    check(S, "fonts are precached for offline use",
          sum(1 for p in cached if p.endswith(".woff2")) == 3,
          f"{sum(1 for p in cached if p.endswith('.woff2'))} cached")

# ═══════════════════════════════════════════ run
static_checks()
browser_checks()

print()
width = max(len(n) for _, n, _, _ in results) + 2
section = None
for sec, name, ok, detail in results:
    if sec != section:
        section = sec
        print(f"\n\033[1m{sec.upper()}\033[0m")
    mark = "\033[32mPASS\033[0m" if ok else "\033[31mFAIL\033[0m"
    print(f"  {mark}  {name.ljust(width)}{('  ' + detail) if detail and not ok else ''}")

passed = sum(1 for *_, ok, _ in ((r[0], r[1], r[2], r[3]) for r in results) if ok)
total = len(results)
print(f"\n{'='*60}\n  {passed}/{total} passed, {total-passed} failed\n{'='*60}")
sys.exit(0 if passed == total else 1)
