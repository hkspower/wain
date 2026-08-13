"""
Nokha1 (النوخذة) — full system test.

Static checks, then a real browser exercising every page: arithmetic, generated
artefacts, auth, hostile input, storage tampering, offline, and layout.
Run:  python3 design/test_suite.py
"""
import http.server, socketserver, threading, functools, time, json, re, pathlib, sys
import subprocess
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path("/home/user/wain/almuhallab")
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
PORT = 8751
BASE = f"http://127.0.0.1:{PORT}"
# index.html is the Almuhallab Code company site; Nokha1 is a product inside it,
# entered at nokha1.html. The three service units are tabs of nizam.html, and the
# old unit filenames survive as redirect stubs so existing links keep working.
PAGES = ["index.html", "nokhatha.html", "nizam.html", "admin.html"]
STUBS = {"safi.html": "nizam.html#/safi", "xbrl.html": "nizam.html#/xbrl",
         "delivery.html": "nizam.html#/delivery", "nokha1.html": "nokhatha.html"}

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
    CORE = ["bg", "panel", "panel-2", "panel-3", "border", "border-input",
            "text", "muted", "tint", "tint-strong", "sand", "good", "danger", "info"]
    for label, sets in (("light", light),):
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

    # the site is white on every device — a dark preference must not repaint it
    for p, t in texts.items():
        check(S, f"{p}: carries no dark-theme override", "prefers-color-scheme: dark" not in t)
        check(S, f"{p}: declares color-scheme: light", "color-scheme: light" in t)

    # contrast, both themes
    for label, P in (("light", light["index.html"]),):
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
    home, portal = texts["index.html"], texts["nokhatha.html"]
    check(S, "the root page is the Almuhallab Code company site",
          "Almuhallab Code" in home and "شركة برمجة" in home)
    check(S, "the root page carries no Nokha1 account UI",
          'id="form-register"' not in home and 'id="form-login"' not in home)
    check(S, "the root page leads into النوخذة", 'href="nokhatha.html"' in home)
    check(S, "النوخذة is entered at nokhatha.html", 'id="form-register"' in portal)
    check(S, "النوخذة links back out to the company site", 'href="index.html"' in portal)

    mf = json.loads((ROOT / "manifest.webmanifest").read_text())
    check(S, "the installable app starts at النوخذة", mf["start_url"] == "nokhatha.html",
          mf["start_url"])
    check(S, "manifest has the required fields",
          all(k in mf for k in ("name", "start_url", "display", "icons")))

# ═══════════════════════════════════════════ 1c. SEO — what a crawler and a share see
def seo_checks():
    """A brochure site that no one can find, and whose links paste as bare URLs,
    is not finished. These pin the signals a crawler and a link preview read:
    they are invisible in a browser, so nothing else would catch their loss."""
    S = "seo"
    BASE = "https://www.almuhallab-code.com"
    PUBLIC = ("index.html", "nokhatha.html", "nizam.html")
    PRIVATE = ("admin.html", "404.html", "safi.html", "xbrl.html",
               "delivery.html", "nokha1.html")
    pages = {f: (ROOT / f).read_text() for f in PUBLIC + PRIVATE}

    robots = (ROOT / "robots.txt")
    check(S, "robots.txt exists", robots.is_file())
    rb = robots.read_text() if robots.is_file() else ""
    check(S, "robots.txt points at the sitemap",
          f"Sitemap: {BASE}/sitemap.xml" in rb)
    check(S, "robots.txt keeps crawlers out of the admin console",
          "Disallow: /admin.html" in rb)

    sm = (ROOT / "sitemap.xml")
    check(S, "sitemap.xml exists", sm.is_file())
    sx = sm.read_text() if sm.is_file() else ""
    locs = re.findall(r"<loc>([^<]+)</loc>", sx)
    check(S, "the sitemap lists exactly the three public pages", len(locs) == 3, str(locs))
    check(S, "and every entry is an absolute URL on the real domain",
          all(u.startswith(BASE + "/") for u in locs), str(locs))
    # a sitemap that lists a noindex page is a contradiction search engines
    # report straight back at you
    check(S, "the sitemap lists nothing that is marked noindex",
          not any(any(pv.split(".")[0] in u for u in locs) for pv in PRIVATE),
          str(locs))
    if sm.is_file():
        ET.fromstring(sx)   # raises if malformed
        check(S, "the sitemap is well-formed XML", True)

    for f in PUBLIC:
        h = pages[f]
        slug = "/" if f == "index.html" else f"/{f}"
        check(S, f"{f}: canonical points at the real URL",
              f'<link rel="canonical" href="{BASE}{slug}" />' in h)
        for prop in ("og:type", "og:title", "og:description", "og:image",
                     "og:url", "og:site_name", "og:locale"):
            check(S, f"{f}: {prop} is set", f'property="{prop}"' in h)
        check(S, f"{f}: the share image is absolute and sized",
              f'content="{BASE}/og.png"' in h
              and 'property="og:image:width" content="1200"' in h
              and 'property="og:image:height" content="630"' in h)
        check(S, f"{f}: twitter card is the large one",
              'name="twitter:card" content="summary_large_image"' in h)
        check(S, f"{f}: og:image carries alt text", 'property="og:image:alt"' in h)
        check(S, f"{f}: is not accidentally noindexed", 'name="robots"' not in h)
        title = re.search(r"<title>([^<]*)</title>", h)
        desc = re.search(r'name="description" content="([^"]*)"', h)
        check(S, f"{f}: has a title of a sane length",
              title and 15 <= len(title.group(1)) <= 70, title.group(1) if title else "none")
        check(S, f"{f}: has a description of a sane length",
              desc and 50 <= len(desc.group(1)) <= 320,
              str(len(desc.group(1))) if desc else "none")

    for f in PRIVATE:
        check(S, f"{f}: stays out of the index", 'content="noindex' in pages[f])

    og = ROOT / "og.png"
    check(S, "the share image exists", og.is_file())
    if og.is_file():
        # PNG header carries the real dimensions — a 1200x630 claim in the meta
        # tag that the file does not honour is what makes a preview crop badly
        raw = og.read_bytes()
        w = int.from_bytes(raw[16:20], "big"); ht = int.from_bytes(raw[20:24], "big")
        check(S, "the share image really is 1200x630", (w, ht) == (1200, 630), f"{w}x{ht}")
        check(S, "and is small enough to preview quickly",
              og.stat().st_size < 300_000, f"{og.stat().st_size // 1024} KB")

    # structured data: it must parse, and it must not claim anything we cannot
    # stand behind — invented reviews are the fastest way to a manual action
    ld = re.search(r'<script type="application/ld\+json">(.*?)</script>',
                   pages["index.html"], re.S)
    check(S, "the company page carries structured data", bool(ld))
    if ld:
        graph = json.loads(ld.group(1))["@graph"]
        types = [e["@type"] for e in graph]
        check(S, "it declares the Organization, the site and النوخذة",
              set(types) == {"Organization", "WebSite", "SoftwareApplication"}, str(types))
        org = next(e for e in graph if e["@type"] == "Organization")
        check(S, "the structured phone is the real one",
              org["telephone"] == "+96565894110", org["telephone"])
        check(S, "the structured email is the real one",
              org["email"] == "hello@almuhallab-code.com", org["email"])
        check(S, "the structured profile is the real Instagram",
              org["sameAs"] == ["https://www.instagram.com/almuhallab.code"], str(org["sameAs"]))
        app = next(e for e in graph if e["@type"] == "SoftwareApplication")
        check(S, "النوخذة is declared free, matching the page",
              app["offers"]["price"] == "0" and app["offers"]["priceCurrency"] == "KWD",
              str(app["offers"]))
        check(S, "no invented ratings or review counts",
              not any("aggregateRating" in json.dumps(e) or "reviewCount" in json.dumps(e)
                      for e in graph))

    # llms.txt: the crawlers that read sites into language models look for it,
    # and the risk it manages is real — a model summarising this company must
    # not invent prices or clients, so the file says so in as many words
    llms = ROOT / "llms.txt"
    check(S, "llms.txt exists", llms.is_file())
    if llms.is_file():
        lt = llms.read_text()
        check(S, "llms.txt names the real channels and nothing else",
              "+965 6589 4110" in lt and "hello@almuhallab-code.com" in lt
              and "@almuhallab.code" in lt)
        check(S, "llms.txt tells a summariser not to invent prices or clients",
              "do not invent" in lt.lower())
        check(S, "llms.txt states النوخذة is free", "0 KWD" in lt)

    # <lastmod> must be a real date, not one typed once and left to ossify
    for lm in re.findall(r"<lastmod>([^<]+)</lastmod>", sx):
        check(S, f"sitemap lastmod {lm} is a valid ISO date",
              bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}", lm)), lm)
    check(S, "every sitemap entry carries a lastmod",
          sx.count("<lastmod>") == len(locs), f"{sx.count('<lastmod>')} of {len(locs)}")

    # the generated files must match what the generator produces now — the whole
    # point of generating them is that a new page cannot slip out of the sitemap
    gen = subprocess.run([sys.executable, str(ROOT.parent / "design" / "seo_files.py"), "--check"],
                         capture_output=True, text=True)
    check(S, "robots.txt, sitemap.xml and llms.txt are not stale",
          gen.returncode == 0, (gen.stdout + gen.stderr).strip()[:160])

    # a services company that declares no services leaves search engines guessing
    graph_all = json.loads(ld.group(1))["@graph"] if ld else []
    org2 = next((e for e in graph_all if e["@type"] == "Organization"), {})
    cat = org2.get("hasOfferCatalog", {}).get("itemListElement", [])
    check(S, "the six services are declared as an offer catalogue", len(cat) == 6, str(len(cat)))
    home_txt = pages["index.html"]
    for offer in cat:
        svc = offer["itemOffered"]
        check(S, f"declared service is on the page: {svc['name']}",
              svc["name"] in home_txt and svc["description"] in home_txt)

    # breadcrumbs put the inner pages under the company in a search result
    for f, expected in (("nokhatha.html", "النوخذة"), ("nizam.html", "النظام الموحد")):
        b = re.search(r'<script type="application/ld\+json">(.*?)</script>', pages[f], re.S)
        check(S, f"{f}: carries a breadcrumb", bool(b))
        if b:
            crumb = json.loads(b.group(1))
            names = [i["name"] for i in crumb["itemListElement"]]
            check(S, f"{f}: the trail starts at the company and ends here",
                  crumb["@type"] == "BreadcrumbList" and names == ["المهلب كود", expected],
                  str(names))


# ═══════════════════════════════════════════ 1b. IDENTITY — pinned, do not relax
def identity_checks():
    """The Almuhallab identity is the company's own and is final. These values
    are pinned deliberately: if a change makes them fail, fix the change."""
    S = "identity"
    home = (ROOT / "index.html").read_text()
    logo = (ROOT / "logo.svg").read_text()

    # the mark's own path signature. It lives in three files and they have to
    # stay one drawing — a favicon that lags a redraw is a second logo
    SQ_MAST = "M11.6 16.15 12.9 8.8"
    SQ_HULL = "M2.4 13.4C3.9 14.6 5.3 15.3 6.9 15.6"
    SQ_SAIL = "M4.6 3.4 17.2 11.6 6.2 13.6Z"
    W_MAST = "M26.8 16.4 28.63 7.79"
    W_HULL = "M4.6 12.6C6.3 13.9 8 14.8 9.8 15.15"
    W_SAIL = "M20.5 2.2 35.6 12.6 23.6 14.4Z"
    fav = (ROOT / "favicon.svg").read_text()
    check(S, "the square boum serves the sprite for square holes",
          'id="i-sail"' in home and SQ_MAST in home and SQ_HULL in home)
    check(S, "the wide boum is the mark: logo.svg and the #i-boum symbol",
          'id="i-boum"' in home and W_MAST in logo and W_HULL in logo
          and W_MAST in home and W_HULL in home)
    # The boum is the one Kuwaiti dhow that is DOUBLE-ENDED — no transom — and
    # she is drawn under sail. Bare poles read as a laid-up hull, and a transom
    # makes her a baghlah. Both were real defects an independent review caught.
    check(S, "both forms carry a filled lateen sail, not bare poles",
          W_SAIL in logo and W_SAIL in home and SQ_SAIL in home and SQ_SAIL in fav)
    check(S, "favicon.svg is the same square drawing as #i-sail, not a second ship",
          SQ_MAST in fav and SQ_HULL in fav)
    check(S, "the tall mainmast is forward of the short mizzen, as a boum is rigged",
          logo.index("M26.8 16.4") > 0 and "M13 16 14.1 9.23" in logo)
    check(S, "the masthead flies the wide mark; the footer keeps the square",
          '<use href="#i-boum"/>' in home.split("<footer>")[0].split('class="brand"')[1]
          and '<use href="#i-sail"/>' in home.split("<footer>")[1])
    check(S, "the page carries both forms of the mark, not an emoji or a letter",
          '<use href="#i-boum"/>' in home and '<use href="#i-sail"/>' in home)
    check(S, "the wordmark is المهلب", '<span class="name">المهلب</span>' in home)
    check(S, "Almuhallab Code sits on its own line beneath المهلب",
          '<span class="en">Almuhallab&nbsp;Code</span>' in home
          and home.index('<span class="name">المهلب</span>') < home.index('<span class="en">'))

    def tok(src, name, dark=False):
        import re
        pat = (r"prefers-color-scheme: dark\)\s*\{\s*:root\s*\{(.*?)\}" if dark
               else r":root\s*\{(.*?)\}")
        block = re.search(pat, src, re.S).group(1)
        return re.search(rf"--{name}:\s*(#[0-9a-fA-F]{{6}})", block).group(1)

    PINNED = {"tint": "#7a4418", "tint-strong": "#6f3f1c"}
    for name, want in PINNED.items():
        got = tok(home, name)
        check(S, f"--{name} is {want}", got == want, got)

    check(S, "the page and its cards stay white",
          tok(home, "bg") == "#ffffff" and tok(home, "panel") == "#ffffff")

    # the masthead is brown on every page — one shell, no divergence (owner's
    # request, 2026-07-31). It is the only brown surface; the page stays white.
    for p in PAGES:
        t = (ROOT / p).read_text()
        check(S, f"{p}: the masthead bar is brown",
              re.search(r"header\s*\{[^}]*background:\s*var\(--tint-strong\)", t, re.S) is not None)
        check(S, f"{p}: the browser chrome matches it",
              'name="theme-color" content="#6f3f1c"' in t)

    for want in ("+965 6589 4110", "@almuhallab.code", "hello@almuhallab-code.com"):
        check(S, f"contact channel kept: {want}", want in home)
    check(S, "no invented contact address", "info@almuhallab-code.com" not in home)

    # "Nokha1" was a private shorthand; the published name is النوخذة
    shown = {p: (ROOT / p).read_text() for p in PAGES}
    # the admin console may name the old storage keys in one place only: the
    # migration that carries an existing console onto the new names
    scanned = {p: re.sub(r"legacy-key-migration:start.*?legacy-key-migration:end", "", t, flags=re.S)
               for p, t in shown.items()}
    check(S, "the legacy key migration is still in place",
          "legacy-key-migration:start" in shown["admin.html"])
    leaked = [p for p, t in scanned.items() if re.search(r"Nokha1|\bNokha\b", t, re.I)]
    check(S, "the Nokha shorthand appears on no page", not leaked, str(leaked))
    check(S, "the product is named النوخذة", "النوخذة" in shown["index.html"])

    check(S, "the first version's components are still the layout",
          'class="product lead"' in home and "<ol class=\"steps\">" in home
          and 'class="channels"' in home)

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

        home_checks(pg)
        pricing_checks(pg)
        scan_checks(pg, br)
        safi_checks(pg)
        integration_checks(pg)
        xbrl_checks(pg)
        delivery_checks(pg)
        timezone_checks(br)
        auth_checks(pg, ctx)
        tamper_checks(pg)
        offline_checks(ctx, br)
        layout_checks(br)
        totals_alignment_checks(br)
        mobile_checks(br)
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

# ───────────── the company page keeps its content in the shared vocabulary
def home_checks(pg):
    """The root page is built from the site's own card grid — no bespoke
    components — and still carries every section it is meant to carry."""
    S = "home"
    pg.goto(f"{BASE}/index.html", wait_until="networkidle")
    pg.wait_for_timeout(300)
    for heading in ("النوخذة — النظام الموحد", "خدماتنا", "من أعمالنا", "كيف نعمل",
                    "ما نبنيه لعملك",
                    "لماذا المهلب كود", "تواصل معنا", "أتمتة سير العمل",
                    "مزايا تحصل عليها", "التقنيات"):
        check(S, f"the page still carries: {heading}", heading in pg.inner_text("main"))
    # المهلب is the company; النوخذة is the unified system it built and runs
    check(S, "the masthead names the company, not the product",
          "شركة برمجة" in pg.inner_text("header"))
    check(S, "النوخذة is named as the unified system",
          pg.inner_text("main").count("النظام الموحد") >= 2)
    cards = pg.eval_on_selector_all(".card", "n=>n.length")
    check(S, "the card sections are all present", cards == 25, f"{cards} cards")
    check(S, "the three commitments sit in the band, not a grid",
          pg.eval_on_selector_all(".band .fact", "n=>n.length") == 3)
    check(S, "the retired code editor is gone from the page",
          "editor.html" not in (ROOT / "index.html").read_text())
    # the services the company leads with
    for want in ("أتمتة العمليات", "وكلاء الذكاء الاصطناعي", "تصميم الشعارات والهوية",
                 "تطبيق مخصّص بالكامل", "تطبيق خاص لكل مشروع"):
        check(S, f"services include: {want}", want in pg.inner_text("main"))
    # the three animated icons: parts that move, and stop under reduced motion
    for cls in ("spin", "spark", "draw"):
        anim = pg.eval_on_selector(f"#services .ic .{cls}",
                                   "e=>getComputedStyle(e).animationName")
        check(S, f"the {cls} icon part is animated", anim not in ("none", ""), anim)
    rm = pg.context.browser.new_context(reduced_motion="reduce", locale="ar-KW")
    rp2 = rm.new_page()
    rp2.goto(f"{BASE}/index.html", wait_until="networkidle"); rp2.wait_for_timeout(300)
    check(S, "reduced motion stills the animated icons",
          rp2.eval_on_selector("#services .ic .spin",
                               "e=>getComputedStyle(e).animationName") == "none")
    rm.close()
    # the card sections slide (owner's request 2026-07-30): one scroll-snap
    # rail per section, all cards on one baseline, genuinely scrollable
    for sid, n in (("nokhatha", 4), ("services", 6), ("offers", 5), ("edge", 10)):
        cnt = pg.eval_on_selector_all(f"#{sid} .rail .card", "n=>n.length")
        check(S, f"{sid}: the rail carries all its cards", cnt == n, f"{cnt} cards")
        tops = set(pg.eval_on_selector_all(f"#{sid} .rail .card",
                   "n=>n.map(c=>Math.round(c.getBoundingClientRect().top))"))
        check(S, f"{sid}: every card sits on one sliding row", len(tops) == 1, str(tops))
        able = pg.eval_on_selector(f"#{sid} .rail", "e=>e.scrollWidth > e.clientWidth + 8")
        check(S, f"{sid}: the rail actually slides", able)
        snap = pg.eval_on_selector(f"#{sid} .rail", "e=>getComputedStyle(e).scrollSnapType")
        check(S, f"{sid}: the rail snaps to cards", snap.startswith("x"), snap)
    # the arrows move the rail the right way for RTL: "next" reveals content
    # further left, and at rest the start-side arrow is disabled
    check(S, "at rest, the previous arrow is disabled",
          pg.eval_on_selector("#services .arrow.prev", "e=>e.disabled"))
    before = pg.eval_on_selector("#services .rail", "e=>e.scrollLeft")
    pg.click("#services .arrow.next"); pg.wait_for_timeout(700)
    after = pg.eval_on_selector("#services .rail", "e=>e.scrollLeft")
    check(S, "the next arrow slides the services rail", after < before - 40, f"{before}->{after}")
    check(S, "sliding lights the matching dot",
          pg.eval_on_selector("#services .dots", "e=>[...e.children].findIndex(d=>d.className==='on')") == 1)
    # drive the rail to its very end: the next arrow must die there, the
    # at-end state must clear the exhausted-side fade, and the LAST dot must
    # light — dots count reachable positions, not cards, so the indicator
    # can never sit short at the end of the rail
    for _ in range(14):
        if pg.eval_on_selector("#services .arrow.next", "e=>e.disabled"): break
        pg.click("#services .arrow.next"); pg.wait_for_timeout(450)
    check(S, "the rail's end disables the next arrow",
          pg.eval_on_selector("#services .arrow.next", "e=>e.disabled"))
    check(S, "the rail's end is marked at-end",
          pg.eval_on_selector("#services", "e=>e.classList.contains('at-end')"))
    check(S, "at the end, the last dot is the lit one",
          pg.eval_on_selector("#services .dots",
              "e=>[...e.children].findIndex(d=>d.className==='on') === e.children.length-1"))
    pg.eval_on_selector("#services .rail", "e=>e.scrollTo({left:0})"); pg.wait_for_timeout(400)

    # tablet widths must show the whole email address — a truncated channel
    # value is worse than a wrapped bar
    tc = pg.context.browser.new_context(viewport={"width": 768, "height": 1024}, locale="ar-KW")
    tp = tc.new_page()
    tp.goto(f"{BASE}/index.html", wait_until="networkidle"); tp.wait_for_timeout(300)
    fits = tp.evaluate("""[...document.querySelectorAll('.channel .v')]
      .every(v => v.scrollWidth <= v.clientWidth + 1)""")
    check(S, "no contact value truncates at tablet width", fits)
    tc.close()

    # without JavaScript the page must degrade to a clean swipeable row:
    # everything visible, no dead arrows, and no edge fades lying about
    # hidden content that nothing will ever clear
    nj = pg.context.browser.new_context(viewport={"width": 1280, "height": 900},
                                        locale="ar-KW", java_script_enabled=False)
    np_ = nj.new_page()
    np_.goto(f"{BASE}/index.html", wait_until="networkidle"); np_.wait_for_timeout(300)
    check(S, "no-JS: every section is visible",
          np_.evaluate("[...document.querySelectorAll('[data-reveal]')]"
                       ".every(e => parseFloat(getComputedStyle(e).opacity) > 0.99)"))
    check(S, "no-JS: the arrows stay hidden",
          np_.evaluate("[...document.querySelectorAll('.railnav')]"
                       ".every(e => getComputedStyle(e).display === 'none')"))
    check(S, "no-JS: the rails still scroll as plain rows",
          np_.eval_on_selector("#services .rail", "e=>e.scrollWidth > e.clientWidth + 8"))
    check(S, "no-JS: the edge fades are not painted",
          np_.evaluate("getComputedStyle(document.querySelector('#services .railwrap'),'::before').content") == "none")
    check(S, "no-JS: the counters already show the true numbers",
          np_.eval_on_selector_all(".stat .num", "n=>n.map(e=>e.textContent)") == ["4", "488", "0", "100%"])
    check(S, "no-JS: the form is not offered dead — the channels are",
          np_.evaluate("getComputedStyle(document.querySelector('.qwrap')).display") == "none"
          and np_.is_visible(".channels"))
    nj.close()
    # the first version's own components: two wide product rows, numbered steps,
    # and the contact bar
    check(S, "the product is a wide row, not a tile",
          pg.eval_on_selector_all(".product", "n=>n.length") == 1)
    check(S, "the lead product is marked as the flagship",
          pg.eval_on_selector_all(".product.lead", "n=>n.length") == 1)
    check(S, "how-we-work is the eight-step timeline",
          pg.eval_on_selector_all("ol.steps li", "n=>n.length") == 8)
    # eight steps never fit a desktop: the timeline must be driven like every
    # other rail, or three of them are unreachable with no affordance at all
    check(S, "the timeline is a slider, not a silent overflow",
          pg.eval_on_selector_all("#process .arrow", "n=>n.length") == 2
          and pg.eval_on_selector_all("#process .dots span", "n=>n.length") >= 2)
    sbefore = pg.eval_on_selector("#process ol.steps", "e=>e.scrollLeft")
    pg.click("#process .arrow.next"); pg.wait_for_timeout(700)
    check(S, "the timeline's next arrow advances it",
          pg.eval_on_selector("#process ol.steps", "e=>e.scrollLeft") < sbefore - 40)
    check(S, "the timeline is reachable by keyboard",
          pg.eval_on_selector("#process ol.steps", "e=>e.getAttribute('tabindex')") == "0")
    pg.eval_on_selector("#process ol.steps", "e=>e.scrollTo({left:0})"); pg.wait_for_timeout(300)
    check(S, "the automation flow runs its seven stations",
          pg.eval_on_selector_all("ol.flow li", "n=>n.length") == 7)
    check(S, "the technology cloud floats all fifteen",
          pg.eval_on_selector_all(".cloud .tech", "n=>n.length") == 15)
    # the hero counters carry only real, verifiable numbers — and they must
    # settle on those numbers once the count-up finishes
    pg.wait_for_timeout(1800)
    finals = pg.eval_on_selector_all(".stat .num", "n=>n.map(e=>e.textContent)")
    check(S, "the counters settle on the true numbers",
          finals == ["4", "488", "0", "100%"], str(finals))
    # the project form validates honestly and never navigates on bad input
    pg.fill("#q-email", "not-an-email"); pg.dispatch_event("#q-email", "blur")
    check(S, "a bad email is marked invalid",
          pg.eval_on_selector("#q-email", "e=>e.getAttribute('aria-invalid')") == "true")
    url_before = pg.url
    pg.click(".qform .send")
    check(S, "an invalid form never navigates", pg.url == url_before)
    pg.fill("#q-name", "اختبار الموقع"); pg.fill("#q-email", "test@example.com")
    pg.fill("#q-msg", "مشروع تجريبي للاختبار الآلي فقط.")
    check(S, "a corrected email clears its mark",
          pg.eval_on_selector("#q-email", "e=>e.getAttribute('aria-invalid')") == "false")
    # the real contact channels, with the numbers the company actually publishes
    chans = pg.eval_on_selector_all(".channel", "n=>n.length")
    check(S, "all three contact channels are offered", chans == 3, f"{chans} channels")
    for want in ("+965 6589 4110", "@almuhallab.code", "hello@almuhallab-code.com"):
        check(S, f"contact shows {want}", want in pg.inner_text("main"))
    hrefs = pg.eval_on_selector_all(".channel", "n=>n.map(a=>a.getAttribute('href'))")
    check(S, "each channel actually opens",
          hrefs == ["https://wa.me/96565894110",
                    "https://instagram.com/almuhallab.code",
                    "mailto:hello@almuhallab-code.com"], str(hrefs))
    check(S, "the placeholder address is gone",
          "info@almuhallab-code.com" not in (ROOT / "index.html").read_text())
    # emoji render as a different typeface, weight and colour on every platform;
    # the drawn set must have replaced them everywhere on the public page
    check(S, "the page carries no emoji icons (footer and flags included)",
          not pg.evaluate(r"/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/u.test(document.body.innerText)"))
    icons = pg.eval_on_selector_all("main use", "n=>n.length")
    check(S, "the drawn icon set is used throughout", icons >= 14, f"{icons} icons")
    check(S, "the header carries the Almuhallab mark",
          pg.eval_on_selector("header .logo use", "e=>e.getAttribute('href')") == "#i-boum")
    check(S, "the wordmark reads المهلب",
          pg.inner_text("header .name").strip() == "المهلب")
    centred = pg.evaluate("""(() => {
      const mid = document.querySelector('header').getBoundingClientRect();
      const logo = document.querySelector('header .logo').getBoundingClientRect();
      const name = document.querySelector('header .name').getBoundingClientRect();
      const cx = mid.left + mid.width / 2;
      return Math.abs((logo.left + logo.width / 2) - cx) < 2
          && Math.abs((name.left + name.width / 2) - cx) < 2
          && name.top >= logo.bottom - 1;
    })()""")
    check(S, "the masthead is centred: mark above wordmark on one axis", centred)
    # the masthead is the site's one brown surface (owner's request 2026-07-31):
    # sticky, brown, with the mark and wordmark in white
    bar = pg.evaluate("""(() => {
      const h = document.querySelector('header');
      const cs = getComputedStyle(h);
      return { pos: cs.position, bg: cs.backgroundColor, top: h.getBoundingClientRect().top,
               name: getComputedStyle(document.querySelector('header .name')).color,
               mark: getComputedStyle(document.querySelector('header .logo')).color };
    })()""")
    check(S, "the masthead is sticky", bar["pos"] == "sticky", bar["pos"])
    check(S, "the masthead is brown", bar["bg"] == "rgb(111, 63, 28)", bar["bg"])
    check(S, "the wordmark and mark are white on it",
          bar["name"] == "rgb(255, 255, 255)" and bar["mark"] == "rgb(255, 255, 255)",
          f'{bar["name"]} / {bar["mark"]}')
    # white on the brand brown must clear the body-text bar by measurement
    check(S, "white on the masthead brown clears 7:1",
          round(contrast("#ffffff", "#6f3f1c"), 2) >= 7,
          f'{contrast("#ffffff", "#6f3f1c"):.2f}:1')
    # it must actually stay put, and shrink rather than eat the viewport.
    # measure the full state from the top: earlier checks in this section
    # scroll the page, and the bar is compact whenever it is scrolled
    pg.evaluate("window.scrollTo({top:0,behavior:'instant'})"); pg.wait_for_timeout(500)
    tall = pg.eval_on_selector("header", "e=>e.getBoundingClientRect().height")
    pg.evaluate("window.scrollTo({top:600,behavior:'instant'})"); pg.wait_for_timeout(500)
    stuck = pg.eval_on_selector("header", "e=>e.getBoundingClientRect().top")
    short = pg.eval_on_selector("header", "e=>e.getBoundingClientRect().height")
    check(S, "the masthead stays at the top when the page scrolls",
          abs(stuck) < 2, str(stuck))
    check(S, "the masthead compacts once scrolled", short < tall - 20, f"{tall}->{short}")
    pg.evaluate("window.scrollTo({top:0,behavior:'instant'})"); pg.wait_for_timeout(500)
    check(S, "and returns to full height at the top",
          pg.eval_on_selector("header", "e=>e.getBoundingClientRect().height") > short + 10)

    # Every visible label on the brown bar must be legible against it, on every
    # page. Two real bugs lived here: a wordmark that stayed dark ink (1.8:1)
    # because its markup was a <div> rather than an <h1>, and a logout control
    # in brand red (1.6:1). Measured, not eyeballed.
    for page in PAGES:
        pg.goto(f"{BASE}/{page}", wait_until="networkidle"); pg.wait_for_timeout(400)
        rows = pg.evaluate("""(() => {
          const h = document.querySelector('header'), out = [];
          h.querySelectorAll('*').forEach(e => {
            if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
            const cs = getComputedStyle(e);
            if (cs.display === 'none' || !e.getClientRects().length) return;
            out.push([e.textContent.trim().slice(0, 20), cs.color, cs.backgroundColor]);
          });
          return out;
        })()""")

        def flatten(css_colour, under):
            m = re.findall(r"[\d.]+", css_colour)
            r, g, b = (float(x) for x in m[:3])
            a = float(m[3]) if len(m) > 3 else 1.0
            u = [int(under[i:i + 2], 16) for i in (1, 3, 5)]
            return "#%02x%02x%02x" % tuple(round(a * v + (1 - a) * u[i]) for i, v in enumerate((r, g, b)))

        worst, label = 99.0, ""
        for text, colour, own in rows:
            base = "#6f3f1c" if own.startswith("rgba(0, 0, 0, 0") else flatten(own, "#6f3f1c")
            c = contrast(flatten(colour, base), base)
            if c < worst: worst, label = c, text
        check(S, f"{page}: every masthead label clears 4.5:1",
              worst >= 4.5, f"{worst:.2f}:1 on “{label}”")
        # both real bugs were "ink that stayed page-coloured on a brown bar":
        # the brand text must be white, and no header control may keep the
        # brand red — it measures 1.6:1 here and passed a bare ratio check
        # only because it sat on a leftover pale pill.
        brand = pg.eval_on_selector(".brand", "e=>getComputedStyle(e).color")
        kids = pg.eval_on_selector_all(".brand *", "n=>n.map(e=>getComputedStyle(e).color)")
        check(S, f"{page}: the brand reads white on the bar",
              all(c.startswith("rgb(255, 255, 255") or "255, 255, 255" in c
                  for c in [brand] + kids), f"{brand} / {kids}")
        reds = pg.eval_on_selector_all(
            "header *", "n=>n.filter(e=>getComputedStyle(e).color==='rgb(206, 25, 37)').length")
        check(S, f"{page}: no masthead control keeps the danger red", reds == 0, str(reds))
    pg.goto(f"{BASE}/index.html", wait_until="networkidle"); pg.wait_for_timeout(400)
    check(S, "every icon reference resolves to a symbol",
          pg.evaluate("[...document.querySelectorAll('use')].every(u =>"
                      " !!document.querySelector(u.getAttribute('href')))"))

    # motion must never gate content: a renderer that does not scroll (a print,
    # a screenshot, a crawler) has to end up with every section visible
    pg.wait_for_timeout(1800)
    faded = pg.evaluate("""[...document.querySelectorAll('[data-reveal]')]
      .filter(e => parseFloat(getComputedStyle(e).opacity) < 0.99).length""")
    check(S, "no section stays invisible when nothing scrolls", faded == 0, f"{faded} faded")
    reduced = pg.context.browser.new_context(reduced_motion="reduce", locale="ar-KW")
    rp = reduced.new_page()
    rp.goto(f"{BASE}/index.html", wait_until="networkidle"); rp.wait_for_timeout(300)
    faded = rp.evaluate("""[...document.querySelectorAll('[data-reveal]')]
      .filter(e => parseFloat(getComputedStyle(e).opacity) < 0.99).length""")
    check(S, "reduced motion shows everything at once, unanimated", faded == 0, f"{faded} faded")
    reduced.close()

    # a sticky bar covers whatever an anchor jumps to unless every target keeps
    # headroom: before scroll-margin-top, "خدماتنا" landed under the masthead
    for sel in ("#services", "#contact", "#automation", "#process", "#tech"):
        # scrollIntoView honours scroll-margin-top and lands deterministically,
        # where a hash navigation races the page's smooth-scroll animation
        pg.evaluate("(s) => document.querySelector(s).scrollIntoView({behavior:'instant'})", sel)
        pg.wait_for_timeout(400)
        gap = pg.evaluate("""(sel) => {
          const t = document.querySelector(sel).getBoundingClientRect().top;
          const h = document.querySelector('header').getBoundingClientRect().bottom;
          return t - h;
        }""", sel)
        check(S, f"{sel} lands clear of the sticky masthead", gap >= 0, f"{gap:.0f}px")
    # and the footer offers the way back up
    pg.goto(f"{BASE}/index.html", wait_until="networkidle"); pg.wait_for_timeout(400)
    check(S, "the footer offers a way back to the top",
          pg.eval_on_selector(".base .top", "e=>e.getAttribute('href')") == "#top"
          and pg.eval_on_selector_all("#top", "n=>n.length") == 1)
    # the footer writes the channels out, not only as icon buttons
    ftext = pg.inner_text("footer")
    for want in ("+965 6589 4110", "hello@almuhallab-code.com"):
        check(S, f"the footer states {want}", want in ftext)
    check(S, "the footer maps the company, the services and the system",
          pg.eval_on_selector_all(".fcols nav a", "n=>n.length") >= 16)
    # one numeral system per page: Arabic-Indic digits beside "+965" and "467"
    # is the same defect that once printed ١٢٬٠٠٠ next to 850 in one table
    mixed = pg.evaluate(r"(document.body.innerText.match(/[٠-٩]/g) || []).length")
    check(S, "the page uses one numeral system throughout", mixed == 0, f"{mixed} Arabic-Indic")

    # the flow map explains the system in labels, not only in motion: with
    # animation off it must still read as the same diagram
    nodes = pg.eval_on_selector_all(".flowmap .fnode b", "n=>n.map(e=>e.textContent.trim())")
    check(S, "the flow map names every stage",
          nodes == ["صافي", "التوصيل", "نواة بيانات واحدة", "الميزانية السنوية", "ملف XBRL"], str(nodes))
    check(S, "each source's wire meets its own node",
          pg.evaluate("""[...document.querySelectorAll('.frow')].every(r => {
            const n = r.querySelector('.fnode').getBoundingClientRect();
            const w = r.querySelector('.wire').getBoundingClientRect();
            return Math.abs((n.top + n.height/2) - (w.top + w.height/2)) < 2;
          })"""))
    rm2 = pg.context.browser.new_context(reduced_motion="reduce", locale="ar-KW")
    rp3 = rm2.new_page()
    rp3.goto(f"{BASE}/index.html", wait_until="networkidle"); rp3.wait_for_timeout(400)
    check(S, "reduced motion stills the flow map but keeps it legible",
          rp3.eval_on_selector(".flowmap .wire", "e=>getComputedStyle(e).animationName") == "none"
          and rp3.eval_on_selector_all(".flowmap .fnode", "n=>n.length") == 5)
    rm2.close()

    # البحار, the voice assistant. Unconfigured it must not render at all — a
    # sticky button that opens nothing is worse than no button.
    # the four drawn scenes: pictures carry «ما نبنيه لعملك», not paragraphs
    scenes = pg.eval_on_selector_all("#offers .scene", "n=>n.map(e=>e.getAttribute('aria-label'))")
    check(S, "the five works are drawn, not written", len(scenes) == 5, str(len(scenes)))
    check(S, "each drawing is described for screen readers",
          all(s_ and "رسم" in s_ for s_ in scenes), str(scenes))
    labels = pg.eval_on_selector_all("#offers .card.drawn > b", "n=>n.map(e=>e.textContent.trim())")
    check(S, "the works are أتمتة · تصميم · تطبيقات · برمجة خاصة · شعار وهوية",
          labels == ["أتمتة", "تصميم", "تطبيقات", "برمجة خاصة", "شعار وهوية"], str(labels))
    check(S, "the app scene names both platforms",
          "iOS" in pg.inner_text("#offers") and "Android" in pg.inner_text("#offers"))
    # every card must lay out in the rail — a card that inherits position:absolute
    # from a same-named class stacks all four in one cell and the rail stops
    # sliding, which is exactly what .shape (the hero's floating geometry) did
    stacked = pg.evaluate("""(() => {
      const cards = [...document.querySelectorAll('#offers .rail > .card')];
      const lefts = new Set(cards.map(c => Math.round(c.getBoundingClientRect().left)));
      const abs = cards.filter(c => getComputedStyle(c).position === 'absolute').length;
      return { distinct: lefts.size, abs };
    })()""")
    check(S, "each drawn card takes its own column",
          stacked["distinct"] == 5 and stacked["abs"] == 0, str(stacked))
    # the logo offer says what a logo is made of, and never shows the company's
    # own sail as if it were a sample of client work
    logo = pg.evaluate("""(() => {
      const c = [...document.querySelectorAll('#offers .card.drawn')]
        .find(e => e.querySelector('b').textContent.trim() === 'شعار وهوية');
      if (!c) return null;
      const s = c.querySelector('svg.scene');
      return { beats: [...s.querySelectorAll('text')].map(t => t.textContent.trim()),
               borrows: !!s.querySelector('use') };
    })()""")
    check(S, "the logo offer is told as فكرة · بناء · روح",
          logo and logo["beats"] == ["فكرة", "بناء", "روح"], str(logo))
    check(S, "the logo offer draws a neutral mark, not the company's own",
          logo and not logo["borrows"], str(logo))

    check(S, "the drawings animate, and stop under reduced motion",
          pg.eval_on_selector("#offers .scene .ga", "e=>getComputedStyle(e).animationName") != "none")

    # every service explains itself with a drawing, in the same idiom
    svc = pg.evaluate("""(() => {
      const cards = [...document.querySelectorAll('#services .rail > .card')];
      return cards.map(c => {
        const s = c.querySelector(':scope > svg.scene');
        return { label: s && s.getAttribute('aria-label'),
                 role: s && s.getAttribute('role'),
                 h: s ? Math.round(s.getBoundingClientRect().height) : 0,
                 title: c.querySelector('h3').textContent.trim() };
      });
    })()""")
    check(S, "all six services carry a drawing", len(svc) == 6
          and all(c["label"] for c in svc), str([c["title"] for c in svc if not c["label"]]))
    check(S, "each service drawing is described for screen readers",
          all(c["role"] == "img" and "رسم" in (c["label"] or "") for c in svc), str(svc))
    # the service scene is the short one; the offer scenes must keep their height
    check(S, "service scenes are drawn at the service height",
          all(100 <= c["h"] <= 116 for c in svc), str([c["h"] for c in svc]))
    check(S, "the offer scenes keep their own taller height",
          pg.eval_on_selector("#offers .scene", "e=>Math.round(e.getBoundingClientRect().height)") >= 130)
    # motion is additive: the parts move, but nothing is hidden until it moves,
    # so reduced motion, print and a screenshot all read the same explanation
    hidden = pg.evaluate("""(() => {
      const parts = [...document.querySelectorAll('#services .scene *')];
      return parts.filter(p => {
        const cs = getComputedStyle(p);
        return cs.opacity === '0' || cs.display === 'none' || cs.visibility === 'hidden';
      }).length;
    })()""")
    check(S, "no part of a service drawing starts invisible", hidden == 0, str(hidden))
    animated = pg.evaluate("""(() => [...document.querySelectorAll('#services .rail > .card')]
      .filter(c => [...c.querySelectorAll(':scope > svg.scene *')]
        .some(p => getComputedStyle(p).animationName !== 'none')).length)()""")
    check(S, "every service drawing animates", animated == 6, str(animated))

    # البحار ships gated on AGENT_URL: no URL, no button. Test the rule, not
    # today's value — the agent is live now, and a check that only passed while
    # the line was empty would have to be deleted the moment it was filled in.
    home_src = (ROOT / "index.html").read_text()
    agent_url = re.search(r'var AGENT_URL = "([^"]*)"', home_src).group(1)
    check(S, "البحار is revealed only for an https agent URL",
          'if (/^https:\\/\\//i.test(url)) { fab.href = url; fab.hidden = false; }' in home_src)
    if agent_url:
        check(S, "البحار is configured and on screen", agent_url.startswith("https://")
              and pg.eval_on_selector("#callfab", "e=>e.getAttribute('href')") == agent_url
              and pg.is_visible("#callfab"), agent_url)
    else:
        check(S, "البحار stays hidden while unconfigured",
              pg.eval_on_selector("#callfab", "e=>e.hidden") is True
              and not pg.is_visible("#callfab")
              and not pg.eval_on_selector("#callfab", "e=>e.getAttribute('href')"))
    # configured, it must be a real, reachable, named control that opens out
    pg.evaluate("""(() => {
      const f = document.getElementById('callfab');
      f.href = 'https://elevenlabs.io/app/talk-to?agent_id=test';
      f.hidden = false;
    })()""")
    pg.wait_for_timeout(200)
    fab = pg.evaluate("""(() => {
      const f = document.getElementById('callfab');
      const r = f.getBoundingClientRect();
      const cs = getComputedStyle(f);
      return { h: r.height, pos: cs.position, label: f.getAttribute('aria-label'),
               target: f.getAttribute('target'), rel: f.getAttribute('rel'),
               inView: r.bottom <= window.innerHeight + 1 && r.top >= 0 };
    })()""")
    check(S, "البحار is sticky once configured", fab["pos"] == "fixed", fab["pos"])
    check(S, "البحار meets the touch-target floor", fab["h"] >= 44, f'{fab["h"]}px')
    check(S, "البحار has an accessible name",
          "البحار" in (fab["label"] or ""), str(fab["label"]))
    check(S, "البحار opens in a new tab, safely",
          fab["target"] == "_blank" and "noopener" in (fab["rel"] or ""),
          f'{fab["target"]} / {fab["rel"]}')
    check(S, "البحار sits within the viewport", fab["inView"])
    # a fixed pill must never sit on top of another control: the rails put
    # their arrows at the inline-end, so البحار lives at the inline-start
    # a fixed pill must never sit on top of another control anywhere down the
    # page — measured by walking the whole scroll range, not just the top
    # await a frame at each stop: stepping aside is driven by an
    # IntersectionObserver, whose callback cannot run inside a synchronous
    # scroll loop, so a sync walk measures a state the visitor never sees
    covered = pg.evaluate("""(async () => {
      const f = document.getElementById('callfab');
      const settle = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
      const bad = [];
      for (let y = 0; y < document.body.scrollHeight; y += 250) {
        window.scrollTo({top: y, behavior: 'instant'});
        await settle();
        if (getComputedStyle(f).pointerEvents === 'none') continue;   // stepped aside
        const fr = f.getBoundingClientRect();
        document.querySelectorAll('.arrow, .btn, .channel, .top, nav.site a, h1, h2, h3').forEach(e => {
          const r = e.getBoundingClientRect();
          if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) return;
          if (r.left < fr.right && r.right > fr.left && r.top < fr.bottom && r.bottom > fr.top)
            bad.push(y + ':' + (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 14));
        });
      }
      window.scrollTo({top: 0, behavior: 'instant'});
      return [...new Set(bad)];
    })()""")
    check(S, "البحار covers no control and no heading at any scroll position",
          not covered, str(covered))

    # A dodge that fires everywhere is not a fix: the first version of this
    # rule hid the pill across the whole desktop page — it was colliding with
    # its own <b>البحار</b> label — and a visitor would never have seen it.
    seen = pg.evaluate("""(async () => {
      const f = document.getElementById('callfab');
      const settle = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));
      let shown = 0, stops = 0;
      for (let y = 0; y < document.body.scrollHeight; y += 250) {
        window.scrollTo({top: y, behavior: 'instant'});
        await settle();
        stops++;
        if (!f.classList.contains('away')) shown++;
      }
      window.scrollTo({top: 0, behavior: 'instant'});
      return {shown, stops};
    })()""")
    share = seen["shown"] / max(seen["stops"], 1)
    check(S, "البحار is still on screen for a real share of the page",
          share >= 0.35, f'{round(share * 100)}% of {seen["stops"]} stops')
    pg.wait_for_timeout(300)
    check(S, "البحار steps aside over the contact bar",
          pg.evaluate("""(() => {
            document.getElementById('contact').scrollIntoView({behavior:'instant'});
            return new Promise(r => setTimeout(() =>
              r(document.getElementById('callfab').classList.contains('away')), 400));
          })()"""))
    # the CSP must still forbid every external origin — the agent is a link,
    # never an embedded widget
    csp = re.search(r'Content-Security-Policy" content="([^"]+)"',
                    (ROOT / "index.html").read_text()).group(1)
    check(S, "the page still allows no external origin",
          "default-src 'none'" in csp and "elevenlabs" not in csp.lower(), csp[:60])
    pg.reload(wait_until="networkidle"); pg.wait_for_timeout(1600)

    check(S, "النوخذة opens from its row",
          pg.eval_on_selector_all('.product a[href="nokhatha.html"]', "n=>n.length") == 1)

# ───────────── the full-scan findings, each pinned so it cannot come back
def scan_checks(pg, br):
    S = "scan"

    # an account stored on a retired paid tier must not crash the dashboard
    c = br.new_context(locale="ar-KW")
    users = {"legacy@x.c": {"name": "محمد", "email": "legacy@x.c", "hash": "x"*64,
                            "salt": "y"*32, "iter": 310000, "plan": 2, "status": "active",
                            "createdAt": "2026-01-01T00:00:00Z", "renewAt": None}}
    c.add_init_script(
        "localStorage.setItem('nokhatha-users-v1', %s);"
        "localStorage.setItem('nokhatha-session-v1', %s);"
        % (json.dumps(json.dumps(users, ensure_ascii=False)),
           json.dumps(json.dumps({"email": "legacy@x.c", "exp": 9999999999999}))))
    lp = c.new_page(); errs = []
    lp.on("pageerror", lambda e: errs.append(str(e)))
    lp.goto(f"{BASE}/nokhatha.html#/dashboard", wait_until="networkidle"); lp.wait_for_timeout(700)
    check(S, "a legacy paid-tier account does not throw", not errs, str(errs[:1]))
    check(S, "its plan badge reads the free plan",
          "مجاني" in lp.inner_text("#dash-plan"), lp.inner_text("#dash-plan"))
    healed = lp.evaluate("JSON.parse(localStorage.getItem('nokhatha-users-v1'))['legacy@x.c'].plan")
    check(S, "the stored record is healed to the free plan", healed == 0, str(healed))
    c.close()

    # The rendered-text numeral check above only sees what a page shows on
    # load. Five Arabic-Indic digits hid in JS strings that appear only on
    # error — including «٨ أحرف» in an error whose own placeholder said "8".
    for f in list(PAGES) + list(STUBS) + ["404.html"]:
        found = sorted(set(re.findall(r"[\u0660-\u0669\u06f0-\u06f9]+",
                                      (ROOT / f).read_text())))
        check(S, f"{f}: no Arabic-Indic digits, even in strings shown only on error",
              not found, ", ".join(found))

    # An annual filing with no financial year end is not a filing. The form's
    # `required` only raises a browser tooltip; the audit report is what the
    # user reads before filing, so it has to say this itself.
    c = br.new_context()
    dp = c.new_page()
    dp.goto(f"{BASE}/nizam.html#/xbrl", wait_until="networkidle"); dp.wait_for_timeout(300)
    dp.fill('#xbrl-form [name="entity"]', "شركة المهلب كود")
    dp.fill('#xbrl-form [name="crn"]', "123456")
    dp.fill('#xbrl-form [name="capital"]', "50000")
    dp.fill('#xbrl-form [name="cash"]', "50000")
    dp.click("#xbrl-validate"); dp.wait_for_timeout(250)
    check(S, "the audit reports a missing financial year end",
          "نهاية السنة المالية غير محددة" in dp.inner_text("#xbrl-audit"))
    dp.fill('#xbrl-form [name="periodEnd"]', "2026-12-31")
    dp.click("#xbrl-validate"); dp.wait_for_timeout(250)
    check(S, "and stops reporting it once the date is entered",
          "نهاية السنة المالية غير محددة" not in dp.inner_text("#xbrl-audit"))
    # the statement totals read like statement totals; the instance stays raw
    tot = dp.eval_on_selector('#xbrl-form [name="totalAssets"]', "e=>e.value")
    check(S, "computed totals carry the same thousands separator as every "
             "other figure", tot == "50,000.000", tot)
    dp.click("#xbrl-preview"); dp.wait_for_timeout(250)
    xml = dp.inner_text("#xbrl-out")
    check(S, "the XBRL instance itself stays machine-readable",
          "50000.000" in xml and "50,000.000" not in xml)
    c.close()

    # Two tabs of one system are the same records. Without a storage listener
    # one tab's table went stale while its CSV export — which re-reads storage
    # — wrote the other tab's rows: a statement disagreeing with its screen.
    c = br.new_context()
    a1, a2 = c.new_page(), c.new_page()
    for t in (a1, a2):
        t.goto(f"{BASE}/nizam.html#/safi", wait_until="networkidle")
    a1.fill('#safi-form [name="ticker"]', "NBK")
    a1.fill('#safi-form [name="name"]', "بنك")
    a1.fill('#safi-form [name="qty"]', "100")
    a1.fill('#safi-form [name="cost"]', "850")
    a1.fill('#safi-form [name="price"]', "910")
    a1.click('#safi-form button[type=submit]'); a1.wait_for_timeout(500)
    rows = (a1.eval_on_selector_all("#safi-rows tr", "r=>r.length"),
            a2.eval_on_selector_all("#safi-rows tr", "r=>r.length"))
    check(S, "a record added in one tab appears in the other", rows[0] == rows[1] == 1,
          str(rows))
    c.close()

    # Arabic in Cairo needs line-height >= 1.35 at display sizes or a damma
    # lands on the line above. Measured: 18 headings sat at the browser
    # default of 1.2, including a 52px h1 on the portal that wraps.
    for page in ("index.html", "nokhatha.html"):
        lp = br.new_context().new_page()
        lp.goto(f"{BASE}/{page}", wait_until="networkidle"); lp.wait_for_timeout(400)
        tight = lp.evaluate("""[...document.querySelectorAll('h1,h2,h3,.num')]
          .filter(e => {
            const s = getComputedStyle(e), size = parseFloat(s.fontSize);
            if (size < 20 || !e.innerText.trim() || s.display === 'none') return false;
            const lh = s.lineHeight === 'normal' ? size * 1.2 : parseFloat(s.lineHeight);
            return lh / size < 1.35;
          }).map(e => e.tagName + ':' + e.innerText.trim().slice(0, 18))""")
        check(S, f"{page}: Arabic display type clears the damma at 1.35",
              not tight, str(tight[:4]))
        lp.context.close()

    # every spacing value belongs to the one scale
    sp = br.new_context().new_page()
    sp.goto(f"{BASE}/index.html", wait_until="networkidle"); sp.wait_for_timeout(500)
    off = sp.evaluate("""(() => {
      const SCALE = new Set([0,4,6,8,12,16,20,24,32,40,56,44]);   // 44: the flow number's gutter
      const bad = {};
      document.querySelectorAll('*').forEach(el => {
        const s = getComputedStyle(el);
        if (s.display === 'none') return;
        // <option> carries the user agent's own 1px padding; that is
        // Chromium's spacing, not ours, and no stylesheet of ours can own it
        if (el.tagName === 'OPTION') return;
        ['paddingTop','paddingBottom','marginTop','marginBottom','gap'].forEach(k => {
          const v = parseFloat(s[k]) || 0;
          if (v > 0 && Number.isInteger(v) && !SCALE.has(v)) bad[k + ':' + v] = (bad[k + ':' + v] || 0) + 1;
        });
      });
      return Object.keys(bad);
    })()""")
    check(S, "index.html: every spacing value sits on the one scale", not off, str(off[:6]))
    sp.context.close()

    # one numeral system per table: the quantity column used the device locale
    c = br.new_context(locale="ar-KW")
    c.add_init_script("localStorage.setItem('nokhatha-safi-v1', %s);" % json.dumps(json.dumps(
        [{"ticker": "NBK", "name": "بنك", "qty": 12000, "cost": 850, "price": 921}], ensure_ascii=False)))
    ap = c.new_page()
    ap.goto(f"{BASE}/nizam.html#/safi", wait_until="networkidle"); ap.wait_for_timeout(400)
    qty = ap.eval_on_selector("#safi-rows td:nth-child(3)", "e=>e.textContent")
    check(S, "quantities use the same numerals as every other figure", qty == "12,000", qty)
    c.close()

    # printing a statement prints the statement, not the application
    pg.goto(f"{BASE}/nizam.html#/safi", wait_until="networkidle")
    pg.emulate_media(media="print"); pg.wait_for_timeout(300)
    hidden = pg.evaluate("""(() => {
      const g = s => { const e = document.querySelector(s); return !e || getComputedStyle(e).display === 'none'; };
      return g('nav.tabs') && g('#safi-form') && g('footer.site') && g('.row');
    })()""")
    check(S, "print hides the chrome, the forms and the row actions", hidden)
    check(S, "print keeps the holdings table",
          pg.eval_on_selector("#safi-rows", "e=>getComputedStyle(e).display") != "none")
    pg.emulate_media(media="screen")

    # every shipped page carries a CSP, stubs included
    for f in list(PAGES) + list(STUBS) + ["404.html"]:
        t = (ROOT / f).read_text()
        check(S, f"{f}: has a Content-Security-Policy", "Content-Security-Policy" in t)

    # the company tab shows the company mark, not النوخذة's anchor
    home = (ROOT / "index.html").read_text()
    check(S, "the company favicon is the sail, not the anchor",
          'href="favicon.svg"' in home and 'href="icon.svg"' not in home)
    fav = (ROOT / "favicon.svg").read_text()
    check(S, "the favicon file draws the boum",
          "M11.6 16.15 12.9 8.8" in fav
          and "M2.4 13.4C3.9 14.6 5.3 15.3 6.9 15.6" in fav)

    # document structure: exactly one h1 per page
    for f in list(PAGES) + list(STUBS) + ["404.html"]:
        n = (ROOT / f).read_text().count("<h1")
        check(S, f"{f}: exactly one h1", n == 1, f"{n} found")

    check(S, "the system page has a meta description",
          'name="description"' in (ROOT / "nizam.html").read_text())

    # the flag emoji renders as the letters "KW" where no flag font exists
    flagged = [f for f in list(PAGES) + list(STUBS) if "\U0001F1F0\U0001F1FC" in (ROOT / f).read_text()]
    check(S, "no page carries the flag emoji", not flagged, str(flagged))

    # ── the 2026-08-01 scan, each finding pinned ──────────────────────────
    # One numeral system across the whole site, not just the company page:
    # placeholders read "٨ أحرف" and the not-found page was titled ٤٠٤ while
    # every figure beside them was Latin.
    for f in list(PAGES) + list(STUBS):
        t = (ROOT / f).read_text()
        body = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", t, flags=re.S)
        body = re.sub(r"<!--.*?-->", "", body, flags=re.S)
        found = re.findall(r"[٠-٩]", body)
        check(S, f"{f}: one numeral system in the markup", not found, f"{len(found)} Arabic-Indic")

    # The shared token set must not diverge — --sans had drifted into three
    # different font stacks, and admin was missing two colours outright.
    def tokset(t):
        m = re.search(r":root\s*\{(.*?)\}", t, re.S)
        return dict(re.findall(r"--([a-z0-9-]+):\s*([^;]+);", m.group(1))) if m else {}
    home_tok = tokset((ROOT / "index.html").read_text())
    for f in PAGES[1:]:
        tk = tokset((ROOT / f).read_text())
        drift = [k for k, v in home_tok.items()
                 if k not in tk or tk[k].strip() != v.strip()]
        check(S, f"{f}: carries the company page's token set", not drift, str(drift))

    # Every form control needs a name a screen reader can read: five controls
    # in the admin console had none.
    for f in PAGES:
        pg.goto(f"{BASE}/{f}", wait_until="networkidle"); pg.wait_for_timeout(500)
        bare = pg.evaluate("""[...document.querySelectorAll('input,select,textarea')]
          .filter(i => i.type !== 'hidden')
          .filter(i => !(i.id && document.querySelector(`label[for="${i.id}"]`))
                    && !i.closest('label') && !i.getAttribute('aria-label'))
          .map(i => i.id || i.name || i.type)""")
        check(S, f"{f}: every form control has a label", not bare, str(bare))

    # WCAG 2.2 target size: footer links were 12px tall on three pages.
    for f in PAGES:
        pg.goto(f"{BASE}/{f}", wait_until="networkidle"); pg.wait_for_timeout(1800)
        small = pg.evaluate("""[...new Set([...document.querySelectorAll('a[href],button')]
          .filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 24; })
          .map(e => (e.textContent || '').trim().slice(0, 20) || e.tagName))]""")
        check(S, f"{f}: interactive targets clear 24px", not small, str(small))

    # the installed app's colour follows the masthead, like every page's meta
    mani = json.loads((ROOT / "manifest.webmanifest").read_text())
    check(S, "the manifest's theme colour is the masthead brown",
          mani.get("theme_color") == "#6f3f1c", str(mani.get("theme_color")))

    # every shipped page belongs in the offline shell — 404.html did not
    sw = (ROOT / "sw.js").read_text()
    for f in list(PAGES) + list(STUBS):
        check(S, f"{f}: is precached for offline", f'"{f}"' in sw)

# ───────────── النوخذة is free: one plan, no price, nothing to upgrade to
def pricing_checks(pg):
    S = "pricing"
    pg.goto(f"{BASE}/nokhatha.html#/pricing", wait_until="networkidle")
    pg.wait_for_timeout(300)
    txt = pg.inner_text("#page-pricing")
    check(S, "the subscription is stated as free", "مجاناً" in txt and "الاشتراك مجاني" in txt)
    check(S, "exactly one plan is offered",
          pg.eval_on_selector_all("#plans .plan", "n=>n.length") == 1)
    check(S, "no monthly price is shown", "د.ك / شهرياً" not in txt)
    src = (ROOT / "nokhatha.html").read_text()
    for gone in ("قبطان — Pro", "نوخذة — Fleet", 'price: "15"', 'price: "39"'):
        check(S, f"the paid tier is gone: {gone}", gone not in src)
    check(S, "every unit is open on the free plan",
          "🔒" not in pg.inner_text("body"))
    adm = (ROOT / "admin.html").read_text()
    check(S, "the console projects no subscription revenue",
          "الإيراد الشهري المتوقع" not in adm and "اشتراكات مدفوعة" not in adm)

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
    pg.fill('input[name="revenue"]', "0")
    pg.click("#xbrl-derive"); pg.wait_for_timeout(250)
    inv = float(pg.input_value('input[name="investments"]'))
    # the computed totals are display fields now — they carry the same
    # thousands separator as every other figure, so strip it before comparing
    def total(name):
        return float(pg.input_value(f'input[name="{name}"]').replace(",", ""))
    nca = total("nonCurrentAssets")
    rev = float(pg.input_value('input[name="revenue"]'))
    check(S, "SAFI market value becomes the financial investments line", abs(inv - market) < .001,
          f"{inv} vs {market:.3f}")
    check(S, "the non-current subtotal carries it", abs(nca - market) < .001,
          f"{nca} vs {market:.3f}")
    check(S, "delivered orders become revenue", abs(rev - 7.5) < .001, str(rev))
    check(S, "net income follows the derived revenue",
          abs(total("netIncome") - 7.5) < .001)
    check(S, "derived fields are marked as derived",
          "derived" in (pg.get_attribute('input[name="revenue"]', "class") or "")
          and "derived" in (pg.get_attribute('input[name="investments"]', "class") or ""))

    # a derived figure stays editable — the derivation is a starting point
    pg.fill('input[name="revenue"]', "99.000"); pg.wait_for_timeout(150)
    check(S, "editing a derived field clears the marker",
          "derived" not in (pg.get_attribute('input[name="revenue"]', "class") or ""))

    # all four modules share one page, so one storage clear resets everything
    pg.goto(f"{BASE}/nizam.html#/position", wait_until="networkidle")
    keys = pg.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('nokhatha-'))")
    check(S, "the unified page uses the established storage keys",
          "nokhatha-safi-v1" in keys and "nokhatha-delivery-orders-v1" in keys, str(keys))


# ───────────────────────────── XBRL: الميزانية السنوية — حساب، فحص، ملف
def xbrl_checks(pg):
    S = "xbrl"
    pg.goto(f"{BASE}/nizam.html#/xbrl", wait_until="networkidle")

    def fill(fields):
        pg.fill('input[name="entity"]', "شركة المهلب القابضة")
        pg.fill('input[name="crn"]', "123456")
        for k, v in fields.items():
            if k in ("period", "legal"): pg.select_option(f'select[name="{k}"]', v)
            elif k == "periodEnd": pg.fill('input[name="periodEnd"]', v)
            else: pg.fill(f'input[name="{k}"]', f"{v:.3f}")
        pg.wait_for_timeout(150)

    def clear():
        pg.reload(wait_until="networkidle"); pg.wait_for_timeout(200)

    # ── a hand-computed annual balance sheet for a Kuwaiti WLL ──
    # CA = 3200.500+5100.250+2400+299.250        = 11000.000
    # NCA = 8400+11350+250                        = 20000.000  → assets 31000.000
    # CL = 3100.750+1500+399.250                  =  5000.000
    # NCL = 6000+950+50                           =  7000.000  → liab   12000.000
    # net = 9640 − 5215.375 − 1200 − 150 + 60.375 =  3135.000
    # eq  = 12000+1600+800+1465+3135              = 19000.000  → liab+eq 31000.000 ✔
    CASE = dict(period="FY", periodEnd="2026-12-31", legal="wll",
                cash=3200.500, receivables=5100.250, inventory=2400.000, otherCA=299.250,
                ppe=8400.000, investments=11350.000, otherNCA=250.000,
                payables=3100.750, stBorrow=1500.000, otherCL=399.250,
                ltBorrow=6000.000, eosb=950.000, otherNCL=50.000,
                capital=12000.000, statRes=1600.000, volRes=800.000, retained=1465.000,
                revenue=9640.000, cogs=5215.375, adminExp=1200.000,
                otherExp=150.000, otherInc=60.375)
    fill(CASE)
    for name, want in (("currentAssets", "11000.000"), ("nonCurrentAssets", "20000.000"),
                       ("totalAssets", "31000.000"), ("currentLiabilities", "5000.000"),
                       ("nonCurrentLiabilities", "7000.000"), ("netIncome", "3135.000"),
                       ("equity", "19000.000")):
        # the totals read as statement totals, so compare on the number
        got = pg.input_value(f'input[name="{name}"]').replace(",", "")
        check(S, f"computed {name} matches the hand total", got == want, f"{got} vs {want}")

    pg.click("#xbrl-validate"); pg.wait_for_timeout(250)
    check(S, "the hand-balanced sheet passes", "✔" in pg.inner_text("#xbrl-check"))
    check(S, "a balanced WLL below the reserve cap gets the 10% suggestion",
          "الاحتياطي القانوني" in pg.inner_text("#xbrl-audit")
          and "313.500" in pg.inner_text("#xbrl-audit"))     # 10% of 3135.000

    pg.click("#xbrl-preview"); pg.wait_for_timeout(400)
    xml = pg.inner_text("#xbrl-out")
    try:
        ET.fromstring(xml); wf = True; err = ""
    except Exception as e:
        wf = False; err = str(e)
    check(S, "generated XBRL is well-formed XML", wf, err)
    if wf:
        root = ET.fromstring(xml)
        ns = {"i": "https://xbrl.ifrs.org/taxonomy/2024-03-27/ifrs-full"}
        def fact(tag):
            e2 = root.find(f"i:{tag}", ns); return float(e2.text) if e2 is not None else None
        check(S, "Assets fact equals the computed total", fact("Assets") == 31000.0, str(fact("Assets")))
        check(S, "EquityAndLiabilities equals Assets", fact("EquityAndLiabilities") == fact("Assets"))
        check(S, "cash, receivables and inventory are itemised",
              fact("CashAndCashEquivalents") == 3200.5 and fact("Inventories") == 2400.0
              and fact("TradeAndOtherCurrentReceivables") == 5100.25)
        check(S, "retained earnings roll the year result in",
              fact("RetainedEarnings") == 1465.0 + 3135.0, str(fact("RetainedEarnings")))
        check(S, "gross profit is revenue minus cost of sales",
              abs(fact("GrossProfit") - (9640.0 - 5215.375)) < .001)
        check(S, "ProfitLoss fact is the computed net", abs(fact("ProfitLoss") - 3135.0) < .001)
        check(S, "amounts are stated in KWD",
              root.find(".//{http://www.xbrl.org/2003/instance}measure").text == "iso4217:KWD")
        check(S, "the entity is identified by its commercial registration",
              "moci.gov.kw/commercial-registration" in xml and ">123456<" in xml)
        dur = [c for c in root.findall("{http://www.xbrl.org/2003/instance}context")
               if c.get("id") == "Duration"][0]
        start = dur.find(".//{http://www.xbrl.org/2003/instance}startDate").text
        check(S, "the annual period starts the day after the prior year end",
              start == "2026-01-01", f"start={start}")

    # ── the audit engine: every rule fires with its suggested fix ──
    clear(); fill(dict(CASE, retained=1000.000))              # break the balance by 465
    pg.click("#xbrl-validate"); pg.wait_for_timeout(250)
    check(S, "an unbalanced sheet is refused with the difference stated",
          "غير متوازنة" in pg.inner_text("#xbrl-check")
          and "465.000" in pg.inner_text("#xbrl-check"))
    check(S, "the imbalance carries a fix suggestion",
          "الأرباح المرحّلة" in pg.inner_text("#xbrl-audit"))
    pg.click('#xbrl-form button[type="submit"]'); pg.wait_for_timeout(300)
    hist = pg.evaluate("JSON.parse(localStorage.getItem('nokhatha-xbrl-reports-v1')||'[]').length")
    check(S, "a sheet with errors cannot be filed", hist == 0, f"{hist} filed")

    clear(); fill(dict(period="FY", periodEnd="2026-12-31", capital=1000.000,
                       retained=-1900.000, otherInc=100.000, cash=0.0))
    # eq = 1000 −1900 +100 = −800 ; assets 0 vs liab+eq −800 → also unbalanced
    pg.click("#xbrl-validate"); pg.wait_for_timeout(250)
    audit = pg.inner_text("#xbrl-audit")
    check(S, "negative equity is reported as an error", "حقوق الملكية سالبة" in audit)
    check(S, "losses at half the capital trigger the companies-law warning",
          "الجمعية العامة" in audit)

    clear(); fill(dict(period="Q2", periodEnd="2026-05-31", capital=5000.000,
                       cash=5000.000, revenue=100.000, cogs=250.000))
    pg.click("#xbrl-validate"); pg.wait_for_timeout(250)
    audit = pg.inner_text("#xbrl-audit")
    check(S, "a quarterly period warns that the official filing is annual",
          "سنوي" in audit)
    check(S, "a gross loss is flagged", "مجمل" in audit)

    clear(); fill(dict(period="FY", periodEnd="2026-12-31", legal="kscc", capital=100000.000,
                       cash=100000.000, statRes=50000.000, revenue=8000.000))
    pg.click("#xbrl-validate"); pg.wait_for_timeout(250)
    audit = pg.inner_text("#xbrl-audit")
    check(S, "a profitable closed shareholding company gets the zakat estimate",
          "زكاة" in audit and "80.000" in audit)             # 1% of 8000
    check(S, "a reserve at half the capital stops the 10% suggestion",
          "الاحتياطي القانوني" not in audit)

    clear(); fill(dict(period="FY", periodEnd="2026-12-31", legal="kscp", capital=100000.000,
                       cash=100000.000, statRes=50000.000, revenue=8000.000))
    pg.click("#xbrl-validate"); pg.wait_for_timeout(250)
    check(S, "a listed company gets labour-support and KFAS estimates",
          "دعم" in pg.inner_text("#xbrl-audit") and "200.000" in pg.inner_text("#xbrl-audit"))

    # quarter ending on a 31st — month arithmetic must not overflow
    clear(); fill(dict(period="Q2", periodEnd="2026-05-31", capital=100.000, cash=100.000))
    pg.click("#xbrl-preview"); pg.wait_for_timeout(400)
    m = re.search(r"<startDate>([\d-]+)</startDate>", pg.inner_text("#xbrl-out"))
    start2 = m.group(1) if m else "?"
    check(S, "quarter ending 31 May starts 1 March (no month overflow)",
          start2 == "2026-03-01", f"start={start2}")

    # entity name is XML-escaped
    pg.fill('input[name="entity"]', 'A & B <script>"x"')
    pg.click("#xbrl-preview"); pg.wait_for_timeout(300)
    out = pg.inner_text("#xbrl-out")
    check(S, "entity name is XML-escaped", "&amp;" in out and "<script>" not in out)
    pg.evaluate("localStorage.removeItem('nokhatha-xbrl-reports-v1')")

def timezone_checks(br):
    """A filing date must be the same in Kuwait as in Honolulu."""
    S = "xbrl"
    got = {}
    for tz in ("UTC", "Asia/Kuwait", "Pacific/Kiritimati", "Pacific/Honolulu"):
        c = br.new_context(timezone_id=tz, locale="ar-KW")
        p = c.new_page()
        p.goto(f"{BASE}/nizam.html#/xbrl", wait_until="networkidle")
        p.fill('input[name="entity"]', "س"); p.fill('input[name="crn"]', "1234")
        p.select_option('select[name="period"]', "FY")
        p.fill('input[name="periodEnd"]', "2026-12-31")
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
    pg.goto(f"{BASE}/nokhatha.html#/register", wait_until="networkidle")
    pg.evaluate("localStorage.removeItem('nokhatha-users-v1');"
                "localStorage.removeItem('nokhatha-session-v1');"
                "localStorage.removeItem('nokhatha-lock-v1')")
    pg.goto(f"{BASE}/nokhatha.html#/register", wait_until="networkidle")

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

    # النوخذة is four units over one data core, and the dashboard has to agree
    # with the company page's counter and with the plan's own feature list.
    # It listed three — المركز المالي, the tab that states the whole linkage,
    # was missing from UNITS while every other surface counted it.
    dash = pg.evaluate("""(() => ({
      cards: [...document.querySelectorAll('#mcp-grid-dash .card h3')].map(h => h.textContent.trim()),
      total: document.getElementById('stat-total').textContent.trim(),
      open: document.getElementById('stat-open').textContent.trim(),
      labels: [...document.querySelectorAll('.stat-row .l')].map(l => l.textContent.trim()),
      body: document.body.innerText
    }))()""")
    check(S, "the dashboard lists all four units", len(dash["cards"]) == 4, str(dash["cards"]))
    check(S, "المركز المالي is one of them",
          any("المركز المالي" in c for c in dash["cards"]), str(dash["cards"]))
    check(S, "the unit count matches the company page's counter",
          dash["total"] == "4" and dash["open"] == "4", f'{dash["total"]}/{dash["open"]}')
    # free means free: nothing renews, nothing is gated behind a plan
    check(S, "no renewal date is promised on a free system",
          "تاريخ التجديد" not in dash["body"] and "renewAt" not in
          (ROOT / "nokhatha.html").read_text(), "renewal leftovers present")
    check(S, "the units are not described as gated by a plan",
          "لباقتك" not in dash["body"], str(dash["labels"]))

    rec = pg.evaluate("JSON.parse(localStorage.getItem('nokhatha-users-v1'))['t@example.com']")
    check(S, "password is never stored in plaintext",
          "correct-horse-2026" not in json.dumps(rec))
    check(S, "password is stored as a salted PBKDF2 hash",
          len(rec.get("hash", "")) == 64 and len(rec.get("salt", "")) == 32
          and rec.get("iter") == 310000, str({k: rec.get(k) for k in ("iter",)}))

    pg.click("#nav-logout"); pg.wait_for_timeout(600)
    pg.goto(f"{BASE}/nokhatha.html#/login", wait_until="networkidle")
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
    pg.goto(f"{BASE}/nokhatha.html#/login", wait_until="networkidle")
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
    pg.goto(f"{BASE}/nokhatha.html#/dashboard", wait_until="networkidle")
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
                       ("nokhatha.html", ["nokhatha-users-v1"])):
        pg.goto(f"{BASE}/{page}", wait_until="networkidle")
        for k in keys:
            pg.evaluate(f"localStorage.setItem({json.dumps(k)}, {json.dumps(hostile[k])})")
        errs = []
        pg.once("pageerror", lambda e: errs.append(str(e)))
        pg.reload(wait_until="networkidle"); pg.wait_for_timeout(500)
        rendered = pg.evaluate("document.body.innerText.length > 40")
        check(S, f"{page} survives malformed stored data", not errs and rendered,
              (errs[0] if errs else "page rendered empty") if (errs or not rendered) else "")

    # A full quota is not hypothetical: Safari's private browsing throws on
    # setItem, and a phone that has been using the system for months can fill
    # 5MB. Registering must then say so — the write that stored the session was
    # the one unguarded write in the file, and its throw was being caught by the
    # registration promise's .catch and reported as "the browser does not
    # support the required encryption", which blames the wrong thing entirely.
    pg.goto(f"{BASE}/nokhatha.html#/register", wait_until="networkidle")
    pg.evaluate("""(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).indexOf('session') !== -1) {
          const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e;
        }
        return real.call(this, k, v);
      };
    })()""")
    pg.fill('#form-register input[name="name"]', "ممتلئ")
    pg.fill('#form-register input[name="email"]', "full@example.com")
    pg.fill('#form-register input[name="password"]', "correct-horse-2026")
    errs = []
    pg.once("pageerror", lambda e: errs.append(str(e)))
    pg.click('#form-register button[type="submit"]'); pg.wait_for_timeout(2600)
    msg = pg.eval_on_selector("#register-error", "e=>e.textContent.trim()")
    check(S, "a full quota is reported as a storage problem, not a crypto one",
          not errs and "تعذّر الحفظ" in msg, f"errs={errs} msg={msg!r}")
    check(S, "and a failed session write does not strand the visitor on a dashboard",
          "/dashboard" not in pg.url, pg.url)

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
    for want in ("/index.html", "/nokhatha.html", "/nizam.html", "/safi.html", "/delivery.html", "/admin.html"):
        check(S, f"precached {want}", any(p.endswith(want) for p in cached))

    ctx.set_offline(True)
    ok = True; detail = ""
    for p in ("index.html", "nokhatha.html", "nizam.html", "nizam.html#/xbrl"):
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
        for page in ("index.html", "nokhatha.html", "nizam.html", "nizam.html#/safi",
                     "nizam.html#/xbrl", "nizam.html#/delivery", "admin.html"):
            p.goto(f"{BASE}/{page}", wait_until="networkidle"); p.wait_for_timeout(300)
            sw_ = p.evaluate("document.documentElement.scrollWidth")
            cw = p.evaluate("document.documentElement.clientWidth")
            if sw_ > cw + 1: overflow.append(f"{page} ({sw_}>{cw})")
        check(S, f"{wname}: no horizontal overflow", not overflow, ", ".join(overflow))
        c.close()

    # a device set to dark must still get the white site — this is the whole
    # point of dropping the navy theme
    for scheme in ("light", "dark"):
        c = br.new_context(viewport={"width": 1280, "height": 860},
                           color_scheme=scheme, locale="ar-KW")
        p = c.new_page()
        for page in ("index.html", "nokhatha.html", "nizam.html"):
            p.goto(f"{BASE}/{page}", wait_until="networkidle"); p.wait_for_timeout(300)
            bg = p.evaluate("getComputedStyle(document.body).backgroundColor")
            card = p.evaluate("""(() => {
              const el = document.querySelector('.card, .tile, .product, form');
              return el ? getComputedStyle(el).backgroundColor : 'rgb(255, 255, 255)';
            })()""")
            check(S, f"{scheme} preference: {page} stays white",
                  bg.startswith("rgb(255, 255, 255") and card.startswith("rgb(255, 255, 255"),
                  f"body={bg} card={card}")
        c.close()

def totals_alignment_checks(br):
    """A computed subtotal is a statement total, not another input. Every
    readonly field in the filing must carry .total and own a full-width row —
    before this was pinned, totals landed inline among the inputs on one
    fieldset and orphaned alone on a second row in another."""
    S = "layout"
    c = br.new_context(viewport={"width": 1280, "height": 900}, locale="ar-KW")
    p = c.new_page()
    p.goto(f"{BASE}/nizam.html#/xbrl", wait_until="networkidle"); p.wait_for_timeout(400)

    unmarked = p.evaluate("""(() => {
      const out = [];
      document.querySelectorAll('#xbrl-form input[readonly]').forEach(i => {
        const l = i.closest('label');
        if (!l || !l.classList.contains('total')) out.push(i.name || '?');
      });
      return out;
    })()""")
    check(S, "every computed total is marked as a total", not unmarked, ", ".join(unmarked))

    n = p.evaluate("document.querySelectorAll('#xbrl-form label.total').length")
    check(S, "the filing carries all eight computed totals", n == 8, str(n))

    # a total line must span its fieldset's full width — nothing shares its row
    shared = p.evaluate("""(() => {
      const out = [];
      document.querySelectorAll('#xbrl-form label.total').forEach(l => {
        const r = l.getBoundingClientRect();
        const fs = l.closest('fieldset').getBoundingClientRect();
        if (r.width < fs.width - 40) out.push(l.textContent.trim().slice(0, 20));
      });
      return out;
    })()""")
    check(S, "each total owns a full-width row", not shared, ", ".join(shared))
    c.close()

def mobile_checks(br):
    """A phone gets an app, not a shrunken desktop: the system's tabs sit in a
    fixed bottom bar within thumb reach, inputs hold 16px so iOS never zooms a
    focused field, and primary controls meet the 44px touch target."""
    S = "mobile"
    c = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True,
                       has_touch=True, locale="ar-KW")
    p = c.new_page()

    p.goto(f"{BASE}/nizam.html#/safi", wait_until="networkidle"); p.wait_for_timeout(300)
    pos = p.eval_on_selector("nav.tabs", "e=>getComputedStyle(e).position")
    check(S, "the system's tabs become a fixed bottom bar", pos == "fixed", pos)
    bar = p.eval_on_selector("nav.tabs", "e=>e.getBoundingClientRect().bottom")
    check(S, "the bar sits at the bottom of the viewport", abs(bar - 844) < 2, str(bar))
    check(S, "tab buttons meet the touch-target floor",
          p.eval_on_selector("nav.tabs button", "e=>e.getBoundingClientRect().height") >= 44)
    fs = p.eval_on_selector('#safi-form input[name="ticker"]', "e=>parseFloat(getComputedStyle(e).fontSize)")
    check(S, "inputs hold 16px so iOS does not zoom on focus", fs >= 16, f"{fs}px")
    # the bar must never hide the content above it
    clear = p.evaluate("""(() => {
      const bar = document.querySelector('nav.tabs').getBoundingClientRect();
      const main = document.querySelector('main');
      return parseFloat(getComputedStyle(main).paddingBottom) >= (844 - bar.top) - 10;
    })()""")
    check(S, "content padding clears the bottom bar", clear)
    # tabs still switch by touch
    p.tap('nav.tabs button[data-tab="delivery"]'); p.wait_for_timeout(250)
    check(S, "tapping the bar switches tabs", "#/delivery" in p.url)

    # the footer's written channels are the fallback contact surface — on a
    # phone they must be real touch targets, not 12px text
    p.goto(f"{BASE}/index.html", wait_until="networkidle"); p.wait_for_timeout(1800)
    rows = p.eval_on_selector_all(".fcontact a", "n=>n.map(e=>e.getBoundingClientRect().height)")
    check(S, "footer contact rows meet the touch-target floor",
          len(rows) == 3 and all(h >= 44 for h in rows), str([round(h) for h in rows]))

    # regression: a mobile display rule must never resurrect [hidden] elements
    p.goto(f"{BASE}/nokhatha.html", wait_until="networkidle"); p.wait_for_timeout(300)
    check(S, "logged-out nav hides dashboard and logout on mobile",
          not p.is_visible("#nav-logout") and not p.is_visible("#nav-dash"))

    p.goto(f"{BASE}/nokhatha.html#/register", wait_until="networkidle"); p.wait_for_timeout(300)
    fs = p.eval_on_selector('#form-register input[name="email"]', "e=>parseFloat(getComputedStyle(e).fontSize)")
    check(S, "portal inputs hold 16px too", fs >= 16, f"{fs}px")
    h = p.eval_on_selector('#form-register button[type="submit"]', "e=>e.getBoundingClientRect().height")
    check(S, "the register button meets the touch target", h >= 40, f"{h}px")

    p.goto(f"{BASE}/index.html", wait_until="networkidle"); p.wait_for_timeout(300)
    h = p.eval_on_selector('.hero .actions .btn', "e=>e.getBoundingClientRect().height")
    check(S, "hero actions meet the touch target", h >= 44, f"{h}px")

    c.close()

def font_checks(pg):
    """The Arabic face must be bundled and actually used, not merely listed."""
    S = "typography"
    pg.goto(f"{BASE}/index.html", wait_until="networkidle")
    pg.wait_for_timeout(900)
    loaded = pg.evaluate("document.fonts.check('400 16px \"Cairo\"')")
    check(S, "the bundled Arabic face loads", loaded)
    fam = pg.evaluate("getComputedStyle(document.querySelector('h1')).fontFamily")
    check(S, "Arabic text resolves to the bundled face first",
          fam.strip().startswith('"Cairo"') or fam.strip().startswith("Cairo"), fam)
    faces = pg.evaluate("[...document.fonts].filter(f=>f.family==='Cairo').length")
    check(S, "every declared weight is present", faces == 5, f"{faces} faces")
    # the CSP must permit the font, or it silently never paints
    csp = pg.evaluate("document.querySelector('meta[http-equiv=\"Content-Security-Policy\"]').content")
    check(S, "CSP allows self-hosted fonts", "font-src 'self'" in csp)
    # and it must survive offline, since it is part of the shell
    cached = pg.evaluate("""caches.keys().then(ks => ks.length
        ? caches.open(ks[0]).then(c => c.keys().then(rs => rs.map(r => new URL(r.url).pathname)))
        : [])""")
    check(S, "fonts are precached for offline use",
          sum(1 for p in cached if p.endswith(".woff2")) == 4,
          f"{sum(1 for p in cached if p.endswith('.woff2'))} cached")

# ═══════════════════════════════════════════ run
static_checks()
seo_checks()
identity_checks()
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
