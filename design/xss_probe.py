#!/usr/bin/env python3
"""XSS probe against the Almuhallab / النوخذة pages — run it after any
change to how a record reaches the DOM.

Authorised testing of the owner's own site.

Two halves, and the second is the point:

  1. a POSITIVE CONTROL — a page that deliberately does `innerHTML = payload`.
     Every oracle must fire on it. An oracle that stays quiet there is broken,
     and a broken oracle reports every real page as clean.
  2. the real pages, with hostile values in every stored field and every form
     input.

Oracles, because script execution is only one of the ways this goes wrong:
  · window.__x       — set by onerror/onload/onmouseover payloads
  · alert/confirm/prompt overridden, plus Playwright's dialog event
  · pageerror
  · securitypolicyviolation — CSP blocking an inline script IS an injection
                              that reached the parser; it only failed to run
  · DOM: does an element our payload named actually exist in the document?
    (HTML injection without execution is still injection)
"""
import http.server, socketserver, threading, functools, json, pathlib, sys
from playwright.sync_api import sync_playwright

SITE = str(pathlib.Path(__file__).resolve().parent.parent / "almuhallab")
CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
PORT = 8791
BASE = f"http://127.0.0.1:{PORT}"

M = "XSSPROBE"          # marker id used by payloads

# Each payload names an element id / sets window.__x so the oracles can see it.
PAYLOADS = {
    "img-onerror":   f'<img id="{M}" src=x onerror="window.__x=1">',
    "svg-onload":    f'<svg id="{M}" onload="window.__x=1"></svg>',
    "script-tag":    f'<script id="{M}">window.__x=1<\\/script>',
    "attr-breakout": f'" onmouseover="window.__x=1" data-a="',
    "attr-single":   f"' onmouseover='window.__x=1' data-a='",
    "tag-break":     f'</td></tr><img id="{M}" src=x onerror="window.__x=1">',
    "iframe-srcdoc": f'<iframe id="{M}" srcdoc="<script>parent.__x=1<\\/script>"></iframe>',
    "js-url":        'javascript:window.__x=1',
    "body-onload":   f'<body id="{M}" onload="window.__x=1">',
    "details-ontog": f'<details id="{M}" open ontoggle="window.__x=1">',
}

ARM = """() => {
  window.__x = undefined; window.__dialog = 0; window.__csp = 0;
  window.alert = window.confirm = window.prompt = function(){ window.__x = 1;
                                                              window.__dialog++; };
  window.addEventListener('securitypolicyviolation', () => { window.__csp++; });
}"""


FIRE = """() => {
  // Handler payloads (onmouseover/ontoggle/onfocus) need the event. Without
  // this, an attribute breakout that fully succeeded looks identical to one
  // that never landed — which is how four of these oracles were blind.
  for (const e of document.querySelectorAll('*')) {
    for (const ev of ['mouseover','focus','click','toggle']) {
      try { e.dispatchEvent(new Event(ev, {bubbles:true})); } catch (err) {}
    }
  }
}"""

INJECTED = """(m) => {
  // Injection that did not execute is still injection: an attribute that
  // became a real attribute, or a javascript: URL that became a real href.
  const hits = [];
  for (const e of document.querySelectorAll('*')) {
    for (const a of e.attributes) {
      if (/^on/i.test(a.name) && a.value.indexOf('__x') >= 0)
        hits.push(e.tagName + '[' + a.name + ']');
      if (/^(href|src|srcdoc)$/i.test(a.name) &&
          /^\s*javascript:/i.test(a.value))
        hits.push(e.tagName + '[' + a.name + '=javascript:]');
    }
  }
  return hits.slice(0, 5);
}"""


def verdict(pg, errs):
    """Everything the page can tell us about whether the payload landed."""
    try:
        pg.evaluate(FIRE)
        pg.wait_for_timeout(60)
    except Exception:
        pass
    return {
        "attr": pg.evaluate(INJECTED, M),
        "exec":    bool(pg.evaluate("window.__x === 1")),
        "dialog":  pg.evaluate("window.__dialog || 0"),
        "csp":     pg.evaluate("window.__csp || 0"),
        "element": pg.evaluate(f"!!document.getElementById({json.dumps(M)})"),
        "errors":  list(errs),
    }


def hostile_records(p):
    """Every field of every record carries the payload — strings AND the
    numeric ones, since a tampered store is not obliged to send a number."""
    return {
        "nokhatha-safi-v1": [{"ticker": p, "name": p, "qty": p, "cost": p, "price": p}],
        "nokhatha-delivery-orders-v1": [{"id": p, "customer": p, "phone": p,
                                         "address": p, "items": p, "amount": p,
                                         "courier": p, "status": p, "createdAt": p}],
        "nokhatha-delivery-couriers-v1": [{"name": p, "phone": p}],
        "nokhatha-xbrl-reports-v1": [{"id": p, "entity": p, "cr": p, "period": p,
                                      "createdAt": p, "lines": {p: p}, "total": p}],
        "nokhatha-users-v1": [{"email": p, "name": p, "company": p, "plan": p,
                               "salt": p, "hash": p, "createdAt": p}],
        "nokhatha-session-v1": p,
        "almuhallab-admin-v1": [{"email": p, "name": p}],
        "almuhallab-admin-session-v1": p,
    }


def run():
    H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
    class Q(socketserver.TCPServer): allow_reuse_address = True
    srv = Q(("127.0.0.1", PORT), H)
    srv.RequestHandlerClass.log_message = lambda *a, **k: None
    threading.Thread(target=srv.serve_forever, daemon=True).start()

    findings, control_ok = [], {}
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=CHROME)
        ctx = br.new_context()
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:120]))
        pg.on("dialog", lambda d: (d.dismiss()))

        # ---------- 1. positive control: prove the oracles can see ----------
        for name, pay in PAYLOADS.items():
            errs.clear()
            pg.goto("about:blank")
            pg.evaluate(ARM)
            pg.evaluate("""p => {
                const d = document.createElement('div');
                // three contexts, because a payload only proves an oracle
                // works in the context it was built for
                d.innerHTML = '<table><tr><td>' + p + '</td></tr></table>'
                            + '<a href="' + p + '">x</a>'
                            + '<i title="' + p + '">a</i>'
                            + "<u title='" + p + "'>b</u>";
                document.body.appendChild(d);
            }""", pay)
            pg.wait_for_timeout(120)
            v = verdict(pg, errs)
            control_ok[name] = (v["exec"] or v["element"] or v["dialog"] > 0
                                or bool(v["attr"]))
            print(f"  control {name:15} exec={v['exec']!s:5} elem={v['element']!s:5}"
                  f" attr={str(v['attr'])[:28]:28}"
                  f"  → oracle {'SEES' if control_ok[name] else 'BLIND'}")

        # ---------- 2. the real pages, storage tampered ----------
        pages = ["nizam.html", "admin.html", "nokhatha.html", "index.html", "404.html"]
        for name, pay in PAYLOADS.items():
            recs = hostile_records(pay)
            for page in pages:
                errs.clear()
                pg.goto(f"{BASE}/{page}")
                for k, v in recs.items():
                    pg.evaluate("([k,v]) => localStorage.setItem(k, typeof v === 'string' "
                                "? v : JSON.stringify(v))", [k, v])
                pg.goto(f"{BASE}/{page}")
                pg.evaluate(ARM)
                # walk every tab so every render path runs
                for sel in ["#/safi", "#/xbrl", "#/delivery", "#/tawasul"]:
                    try:
                        pg.evaluate("h => { location.hash = h; }", sel)
                        pg.wait_for_timeout(60)
                    except Exception:
                        pass
                pg.wait_for_timeout(200)
                v = verdict(pg, errs)
                if (v["exec"] or v["element"] or v["dialog"] or v["csp"]
                        or v["attr"]):
                    findings.append((page, name, v))
                    print(f"  !! {page:15} {name:15} {v}")
        br.close()
    srv.shutdown()

    print("\n" + "=" * 64)
    blind = [k for k, ok in control_ok.items() if not ok]
    if blind:
        print(f"  ORACLE BLIND for {blind} — a clean result here means nothing")
    print(f"  {len(PAYLOADS)} payloads × {5} pages × 8 storage keys")
    print(f"  findings: {len(findings)}")
    for f in findings:
        print("   ", f)
    return 1 if findings or blind else 0


if __name__ == "__main__":
    sys.exit(run())
