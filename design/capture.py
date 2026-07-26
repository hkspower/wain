"""
Capture every page of the Almuhallab Code site — the company pages and the
النوخذة system inside it — from a real browser.
The site is driven end-to-end first (register, add holdings, orders, a report)
so the screenshots show a working system rather than empty forms.
"""
import http.server, socketserver, threading, functools, time, pathlib
import json
from playwright.sync_api import sync_playwright

ROOT = "/home/user/wain/almuhallab"
OUT = pathlib.Path("/home/user/wain/design/shots"); OUT.mkdir(exist_ok=True)
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
PORT = 8731
BASE = f"http://127.0.0.1:{PORT}"

# ---- serve the site locally ----
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
time.sleep(0.6)

shots = []

def snap(page, name, title, url_label, full=True):
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path), full_page=full)
    shots.append({"file": str(path), "title": title, "url": url_label})
    print(f"  captured {name}")

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME)
    ctx = browser.new_context(viewport={"width": 1440, "height": 900},
                              device_scale_factor=2, locale="ar-KW")
    page = ctx.new_page()

    # -------------------------------------------------- company site (the root)
    page.goto(f"{BASE}/index.html", wait_until="networkidle")
    page.wait_for_timeout(500)
    snap(page, "01-company", "المهلب كود — Almuhallab Code", "/")

    # ------------------------------------------------ النوخذة portal (a product)
    page.goto(f"{BASE}/nokhatha.html", wait_until="networkidle")
    page.wait_for_timeout(500)
    snap(page, "02-landing", "النوخذة", "/nokhatha")

    # ---------------------------------------------------------- pricing
    page.goto(f"{BASE}/nokhatha.html#/pricing", wait_until="networkidle")
    page.wait_for_timeout(400)
    snap(page, "03-pricing", "الاشتراكات — Plans", "/nokhatha#/pricing")

    # ---------------------------------------------------------- register
    page.goto(f"{BASE}/nokhatha.html#/register", wait_until="networkidle")
    page.fill('#form-register input[name="name"]', "محمد العلي")
    page.fill('#form-register input[name="email"]', "demo@almuhallab-code.com")
    page.fill('#form-register input[name="password"]', "almuhallab-demo-2026")
    page.wait_for_timeout(300)
    snap(page, "04-register", "إنشاء حساب — Registration", "/nokhatha#/register")

    # submit -> real PBKDF2 hash, real session, lands on dashboard
    page.click('#form-register button[type="submit"]')
    page.wait_for_timeout(2500)
    snap(page, "05-dashboard", "لوحة التحكم — Customer dashboard", "/nokhatha#/dashboard")

    # ---------------------------------------------------------- SAFI
    page.goto(f"{BASE}/nizam.html#/safi", wait_until="networkidle")
    holdings = [
        ("NBK",  "بنك الكويت الوطني",       12000, 850,  921),
        ("ZAIN", "شركة زين للاتصالات",       8500,  452,  438),
        ("KFH",  "بيت التمويل الكويتي",      6200,  735,  812),
        ("AGLTY","شركة أجيليتي",            15000, 268,  301),
        ("BOUB", "بنك بوبيان",               9400,  612,  655),
    ]
    for t, n, q, c, pr in holdings:
        page.fill('input[name="ticker"]', t)
        page.fill('input[name="name"]', n)
        page.fill('input[name="qty"]', str(q))
        page.fill('input[name="cost"]', str(c))
        page.fill('input[name="price"]', str(pr))
        page.click('#safi-form button[type="submit"]')
        page.wait_for_timeout(180)
    page.wait_for_timeout(500)
    snap(page, "06-safi", "صافي — SAFI portfolio", "/nizam.html#/safi")

    # ---------------------------------------------------------- XBRL
    page.goto(f"{BASE}/nizam.html#/xbrl", wait_until="networkidle")
    page.fill('input[name="entity"]', "شركة المهلب القابضة")
    page.fill('input[name="crn"]', "123456")
    page.select_option('select[name="period"]', "FY")
    page.fill('input[name="periodEnd"]', "2026-12-31")
    # the hand-balanced Kuwaiti WLL case from the test suite
    vals = {"cash": 3200.500, "receivables": 5100.250, "inventory": 2400.000, "otherCA": 299.250,
            "ppe": 8400.000, "investments": 11350.000, "otherNCA": 250.000,
            "payables": 3100.750, "stBorrow": 1500.000, "otherCL": 399.250,
            "ltBorrow": 6000.000, "eosb": 950.000, "otherNCL": 50.000,
            "capital": 12000.000, "statRes": 1600.000, "volRes": 800.000, "retained": 1465.000,
            "revenue": 9640.000, "cogs": 5215.375, "adminExp": 1200.000,
            "otherExp": 150.000, "otherInc": 60.375}
    for k, v in vals.items():
        page.fill(f'input[name="{k}"]', f"{v:.3f}")
    page.click("#xbrl-validate")
    page.wait_for_timeout(300)
    page.click("#xbrl-preview")
    page.wait_for_timeout(700)
    snap(page, "07-xbrl", "XBRL — الميزانية السنوية", "/nizam.html#/xbrl")

    # ---------------------------------------------------------- Delivery
    page.goto(f"{BASE}/nizam.html#/delivery", wait_until="networkidle")
    for cn, cp in [("سالم", "99012345"), ("يوسف", "97788221"), ("عبدالله", "66554120")]:
        page.fill('#del-courier-form input[name="cname"]', cn)
        page.fill('#del-courier-form input[name="cphone"]', cp)
        page.click('#del-courier-form button[type="submit"]')
        page.wait_for_timeout(150)
    orders = [
        ("أم محمد",  "99887766", "السالمية، قطعة ٢، شارع ٣",  "مجبوس دجاج ×٢",      7.500,  "سالم"),
        ("أبو خالد", "55443322", "حولي، شارع تونس، مبنى ١٤",  "مندي لحم + سلطات",   12.250, "يوسف"),
        ("نورة",     "97001122", "الجابرية، قطعة ٦",           "برياني روبيان ×٣",   15.750, "عبدالله"),
        ("فهد",      "60112233", "الفنطاس، قطعة ١، منزل ٢٢",  "مشاوي مشكل",         21.000, "سالم"),
        ("دلال",     "94556677", "بيان، قطعة ٨، شارع ١",       "كبسة دجاج ×٢",        9.500,  "يوسف"),
    ]
    for cu, ph, ad, it, am, co in orders:
        page.fill('#del-form input[name="customer"]', cu)
        page.fill('#del-form input[name="phone"]', ph)
        page.fill('#del-form input[name="address"]', ad)
        page.fill('#del-form input[name="items"]', it)
        page.fill('#del-form input[name="amount"]', str(am))
        page.select_option('#del-form select[name="courier"]', co)
        page.click('#del-form button[type="submit"]')
        page.wait_for_timeout(180)
    # advance the pipeline so every status is represented
    for _ in range(3):
        page.click('button[data-next="0"]'); page.wait_for_timeout(150)
    for _ in range(2):
        page.click('button[data-next="1"]'); page.wait_for_timeout(150)
    page.click('button[data-next="2"]'); page.wait_for_timeout(150)
    page.click('button[data-cancel="4"]'); page.wait_for_timeout(300)
    page.wait_for_timeout(400)
    snap(page, "08-delivery", "التوصيل — Delivery operations", "/nizam.html#/delivery")

    # ------------------------------------------------ unified financial position
    # captured last, so the portfolio and the delivered orders above are both in
    # place and the derived figures on this tab are real
    page.goto(f"{BASE}/nizam.html#/position", wait_until="networkidle")
    page.wait_for_timeout(600)
    snap(page, "09-position", "المركز المالي — Unified position", "/nizam.html#/position")


    # ---------------------------------------------------------- mobile
    m = browser.new_context(viewport={"width": 402, "height": 874},
                            device_scale_factor=3, is_mobile=True,
                            has_touch=True, locale="ar-KW")
    seed_safi = json.dumps([{"ticker": t, "name": n, "qty": q, "cost": c, "price": pr}
                            for t, n, q, c, pr in holdings], ensure_ascii=False)
    seed_orders = json.dumps([
        {"id": f"ORD-{i+1:04d}", "customer": o[0], "phone": o[1], "address": o[2],
         "items": o[3], "amount": o[4], "courier": o[5],
         "status": [3, 3, 2, 1, 0][i], "createdAt": "2026-07-25T09:00:00Z"}
        for i, o in enumerate(orders)], ensure_ascii=False)
    seed_couriers = json.dumps([{"name": "سالم", "phone": "99012345"},
                                {"name": "يوسف", "phone": "97788221"}], ensure_ascii=False)
    m.add_init_script(
        "localStorage.setItem('nokhatha-safi-v1', %s);"
        "localStorage.setItem('nokhatha-delivery-orders-v1', %s);"
        "localStorage.setItem('nokhatha-delivery-couriers-v1', %s);"
        % (json.dumps(seed_safi), json.dumps(seed_orders), json.dumps(seed_couriers)))
    mp = m.new_page()
    for nm, url, title in [("10-m-company", "index.html", "Company — mobile"),
                           ("11-m-safi", "nizam.html#/safi", "SAFI — mobile"),
                           ("12-m-position", "nizam.html#/position", "Position — mobile")]:
        mp.goto(f"{BASE}/{url}", wait_until="networkidle")
        mp.wait_for_timeout(700)
        mp.screenshot(path=str(OUT / f"{nm}.png"), full_page=False)
        print(f"  captured {nm}")
    m.close()
    browser.close()

httpd.shutdown()
json.dump(shots, open("/home/user/wain/design/shots/index.json", "w"), ensure_ascii=False, indent=1)
print(f"\n{len(shots)} desktop + 3 mobile captures")
