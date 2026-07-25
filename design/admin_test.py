"""Drive the admin panel end to end and capture every tab."""
import http.server, socketserver, threading, functools, time, json, pathlib
from playwright.sync_api import sync_playwright

ROOT = "/home/user/wain/almuhallab"
OUT = pathlib.Path("/home/user/wain/design/shots"); OUT.mkdir(exist_ok=True)
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
PORT = 8741; BASE = f"http://127.0.0.1:{PORT}"

H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
socketserver.TCPServer.allow_reuse_address = True
httpd = socketserver.TCPServer(("127.0.0.1", PORT), H)
threading.Thread(target=httpd.serve_forever, daemon=True).start(); time.sleep(.5)

# a believable book of business, spread over eight weeks
import datetime
now = datetime.datetime(2026, 7, 25)
def ago(days): return (now - datetime.timedelta(days=days)).isoformat() + "Z"
users = {}
book = [("محمد العلي","demo",2,3),("نورة الفهد","noura",1,9),("خالد المطيري","khaled",0,14),
        ("دلال السالم","dalal",2,20),("يوسف العنزي","yousef",1,26),("أم محمد","umm",0,33),
        ("فهد الرشيد","fahad",1,40),("سارة الخالد","sara",0,47),("عبدالله ناصر","abdullah",2,52)]
for name, slug, plan, days in book:
    users[f"{slug}@almuhallab-code.com"] = {
        "name": name, "email": f"{slug}@almuhallab-code.com",
        "salt": "00"*16, "hash": "ab"*32, "iter": 310000,
        "plan": plan, "renewAt": ago(-20) if plan else None,
        "createdAt": ago(days), "status": "suspended" if slug == "sara" else "active"}
holdings = [{"ticker":t,"name":n,"qty":q,"cost":c,"price":p} for t,n,q,c,p in [
    ("NBK","بنك الكويت الوطني",12000,850,921),("ZAIN","شركة زين",8500,452,438),
    ("KFH","بيت التمويل الكويتي",6200,735,812),("AGLTY","أجيليتي",15000,268,301),
    ("BOUB","بنك بوبيان",9400,612,655),("GBK","بنك الخليج",7000,300,286)]]
orders = [{"id":f"ORD-{i+1:04d}","customer":c,"phone":"9"*8,"address":a,"items":it,
           "amount":am,"courier":co,"status":st,"createdAt":ago(i)}
          for i,(c,a,it,am,co,st) in enumerate([
    ("أم محمد","السالمية ق٢","مجبوس دجاج ×٢",7.5,"سالم",3),
    ("أبو خالد","حولي، تونس","مندي لحم",12.25,"يوسف",3),
    ("نورة","الجابرية ق٦","برياني روبيان",15.75,"سالم",2),
    ("فهد","الفنطاس ق١","مشاوي مشكل",21.0,"يوسف",1),
    ("دلال","بيان ق٨","كبسة دجاج",9.5,"سالم",0),
    ("سعد","الرقة ق٣","سمك زبيدي",18.0,"يوسف",3),
    ("منى","صباح السالم","شاورما ×٤",6.25,"سالم",4)])]
reports = [{"entity":"شركة المهلب القابضة","lei":"254900MHLLB2026KW01","period":p,
            "periodEnd":pe,"assets":a,"equity":e,"revenue":r,"profit":pr,"filedAt":ago(d)}
           for p,pe,a,e,r,pr,d in [
    ("Q1","2026-03-31",14820.5,8100.0,2310.0,640.25,120),
    ("Q2","2026-06-30",15630.25,8460.5,4890.75,1120.5,28),
    ("FY","2026-12-31",16170.5,8719.5,9640.0,3424.625,2)]]

seed = ("localStorage.setItem('nokhatha-users-v1', %s);"
        "localStorage.setItem('nokhatha-safi-v1', %s);"
        "localStorage.setItem('nokhatha-delivery-orders-v1', %s);"
        "localStorage.setItem('nokhatha-xbrl-reports-v1', %s);") % tuple(
    json.dumps(json.dumps(x, ensure_ascii=False)) for x in (users, holdings, orders, reports))

fails = []
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME)
    ctx = b.new_context(viewport={"width": 1460, "height": 980}, device_scale_factor=2, locale="ar-KW")
    ctx.add_init_script(seed)
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))

    pg.goto(f"{BASE}/admin.html", wait_until="networkidle")
    pg.wait_for_timeout(400)
    pg.screenshot(path=str(OUT / "20-admin-gate.png"))

    # first run must be setup mode
    if "لم تُضبط" not in pg.inner_text("#gate-lead"): fails.append("setup mode not offered")
    pg.fill('input[name="pass"]', "nokha1-admin-2026")
    pg.fill('input[name="confirm"]', "nokha1-admin-2026")
    pg.click("#gate-btn"); pg.wait_for_timeout(2600)

    if not pg.is_visible("#shell"): fails.append("did not enter the console")
    pg.screenshot(path=str(OUT / "21-admin-overview.png"))

    for tab, shot in [("customers","22-admin-customers"), ("ops","23-admin-ops"),
                      ("finance","24-admin-finance"), ("settings","25-admin-settings")]:
        pg.click(f'#tabs button[data-tab="{tab}"]'); pg.wait_for_timeout(450)
        pg.screenshot(path=str(OUT / f"{shot}.png"))

    # --- behaviour checks ---
    pg.click('#tabs button[data-tab="customers"]'); pg.wait_for_timeout(300)
    rows = pg.eval_on_selector_all("#cust-rows tr", "n=>n.length")
    if rows != 9: fails.append(f"expected 9 customers, saw {rows}")

    pg.fill("#cust-q", "نورة"); pg.wait_for_timeout(250)
    if pg.eval_on_selector_all("#cust-rows tr", "n=>n.length") != 1: fails.append("search filter broken")
    pg.fill("#cust-q", ""); pg.wait_for_timeout(200)

    pg.select_option("#cust-status", "suspended"); pg.wait_for_timeout(250)
    if pg.eval_on_selector_all("#cust-rows tr", "n=>n.length") != 1: fails.append("status filter broken")
    pg.select_option("#cust-status", ""); pg.wait_for_timeout(200)

    # suspend one account and confirm the portal then refuses it
    pg.click('#cust-rows button[data-act="toggle"]'); pg.wait_for_timeout(400)
    suspended = pg.evaluate("Object.values(JSON.parse(localStorage.getItem('nokhatha-users-v1')))"
                            ".filter(u=>u.status==='suspended').length")
    if suspended != 2: fails.append(f"suspend did not persist (got {suspended})")

    # audit log must have recorded it
    pg.click('#tabs button[data-tab="settings"]'); pg.wait_for_timeout(300)
    if "تغيير حالة العميل" not in pg.inner_text("#audit"): fails.append("audit log missing the action")

    # charts must have rendered real marks
    pg.click('#tabs button[data-tab="overview"]'); pg.wait_for_timeout(300)
    marks = pg.eval_on_selector_all("#charts [data-tip]", "n=>n.length")
    if marks < 15: fails.append(f"charts rendered too few marks ({marks})")

    # session should survive a reload
    pg.reload(wait_until="networkidle"); pg.wait_for_timeout(700)
    if not pg.is_visible("#shell"): fails.append("session did not persist across reload")

    # wrong password must be rejected
    pg.click("#btn-logout"); pg.wait_for_timeout(700)
    pg.fill('input[name="pass"]', "wrong-password-xx"); pg.click("#gate-btn"); pg.wait_for_timeout(2600)
    if pg.is_visible("#shell"): fails.append("SECURITY: wrong password granted access")
    if "غير صحيحة" not in pg.inner_text("#gate-err"): fails.append("no error on bad password")

    if errs: fails.append("console errors: " + " | ".join(errs[:3]))
    b.close()
httpd.shutdown()

print("\n".join("FAIL: " + f for f in fails) if fails else "all admin checks passed")
print(f"{len(fails)} failures")
