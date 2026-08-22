#!/usr/bin/env python3
"""Check the live HTTPS of www.almuhallab-code.com — from a machine that can reach it.

Run it where the site is reachable:

    python3 design/ssl_check.py                 # the real domain
    python3 design/ssl_check.py example.org     # any other host
    python3 design/ssl_check.py --self-test     # prove the verdicts still work

Why this is a script and not a paragraph in a document: everything the
repository can do to force HTTPS is already done and already pinned by the
suite — the Apache rules in `.htaccess`, `upgrade-insecure-requests` in every
page's CSP, and the http→https redirect each page runs on arrival. None of that
can tell you whether the certificate is valid *today*, whether plaintext really
301s, or whether the redirect goes to the host the preload list requires. Only
a connection can, and this container cannot make one: its network policy
answers 403 to CONNECT for anything but a short allowlist. So the check lives
here, ready, and the owner runs it.

Stdlib only — no pip install on the owner's machine.

Each check prints PASS / FAIL / SKIP and one line of what was actually seen.
Exit status is 1 if anything failed and 2 if the check refused to run at all
(an intercepted connection, or a host it cannot reach), so it can gate a deploy
without ever mistaking "could not check" for "checked and fine".
"""

import argparse
import datetime as dt
import http.client
import os
import re
import socket
import ssl
import sys

BARE = "almuhallab-code.com"
CANON = "www.almuhallab-code.com"
TIMEOUT = 12

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    tag = {True: "PASS", False: "FAIL", None: "SKIP"}[ok]
    print(f"  {tag}  {name}" + (f"   {detail}" if detail else ""))


# ---------------------------------------------------------------- verdicts
# The judgements live in plain functions so --self-test can exercise them
# without a network. A checker whose logic is only ever run against the live
# site is a checker nobody has tested: the first time it is wrong is the time
# it matters, and a wrong PASS is worse than no check at all.

def redirect_verdict(status, location, from_host):
    """Where http://<host>/ must go.

    The HSTS preload list requires that plaintext on a host redirect to HTTPS
    on the SAME host first. A bare domain that jumps straight to https://www is
    disqualified — and nothing about the site looks wrong, which is exactly why
    this is worth measuring rather than assuming.
    """
    if status not in (301, 308):
        return False, f"expected a permanent redirect, got {status}"
    if not location:
        return False, "redirect with no Location"
    if not location.startswith("https://"):
        return False, f"redirects to {location} — still plaintext"
    host = location[len("https://"):].split("/")[0].split(":")[0]
    if host != from_host:
        return False, (f"redirects to https://{host}, not https://{from_host}"
                       " — HSTS preload needs the same host first")
    return True, location


def expiry_verdict(not_after, now):
    """Days of certificate left. Under 15 is a failure, not a warning: renewal
    is automatic on both Pages and Hostinger, so a certificate this close to
    the edge means the automation has already stopped working."""
    left = (not_after - now).days
    if left < 0:
        return False, f"EXPIRED {-left} days ago"
    if left < 15:
        return False, f"only {left} days left — renewal has likely stopped"
    return True, f"{left} days left (until {not_after:%Y-%m-%d})"


def hsts_verdict(value):
    if not value:
        return False, ("no Strict-Transport-Security header — GitHub Pages"
                       " sends one only once Enforce HTTPS is ticked")
    age = re.search(r"max-age=(\d+)", value)
    if not age or int(age.group(1)) < 31536000:
        return False, f"max-age under a year: {value}"
    return True, value


def names_cover(san, hosts):
    """Does the certificate actually name every host the site answers on?"""
    missing = []
    for h in hosts:
        ok = any(n == h or (n.startswith("*.") and h.endswith(n[1:])
                            and h.count(".") == n.count("."))
                 for n in san)
        if not ok:
            missing.append(h)
    return (not missing), (f"covers {', '.join(hosts)}" if not missing
                           else f"does not name {', '.join(missing)}")


# ---------------------------------------------------------- interception

# Written after this script's first live run. It reported five PASSes about
# www.almuhallab-code.com — a valid certificate, TLS 1.3, old TLS refused —
# and every one of them was a fact about this container's TLS-intercepting
# proxy. The tell was one line the run happened to print: "issued by a public
# CA — Anthropic". A checker that reports the middlebox's own hygiene as the
# site's is worse than no checker, because it is believed. So it now refuses
# to report at all when the connection is not its own.
INTERCEPTORS = ("anthropic", "mitmproxy", "zscaler", "netskope", "bluecoat",
                "forcepoint", "fortinet", "palo alto", "fiddler", "charles",
                "burp", "squid", "kaspersky", "eset", "bitdefender")


def interception(cert, env):
    """Is something between this machine and the site terminating TLS?"""
    for var in ("HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"):
        if env.get(var):
            return f"{var} is set — this machine proxies HTTPS"
    issuer = dict(x[0] for x in cert.get("issuer", ()))
    org = (issuer.get("organizationName") or issuer.get("commonName") or "")
    if any(k in org.lower() for k in INTERCEPTORS):
        return (f"the certificate was issued by {org!r} — that is an"
                " interception CA, not the site's own")
    return None


# ------------------------------------------------------------------ probes

def probe_plaintext(host):
    c = http.client.HTTPConnection(host, 80, timeout=TIMEOUT)
    try:
        c.request("HEAD", "/", headers={"Host": host})
        r = c.getresponse()
        return r.status, r.getheader("Location")
    finally:
        c.close()


def probe_tls(host):
    ctx = ssl.create_default_context()
    with socket.create_connection((host, 443), timeout=TIMEOUT) as raw:
        with ctx.wrap_socket(raw, server_hostname=host) as s:
            cert = s.getpeercert()
            version = s.version()
    conn = http.client.HTTPSConnection(host, 443, timeout=TIMEOUT,
                                       context=ssl.create_default_context())
    try:
        conn.request("HEAD", "/", headers={"Host": host})
        r = conn.getresponse()
        headers = {k.lower(): v for k, v in r.getheaders()}
        status = r.status
    finally:
        conn.close()
    return cert, version, status, headers


def refuses_old_tls(host):
    """TLS 1.0/1.1 must not negotiate. Both are withdrawn; a server still
    accepting them is a server whose configuration nobody has revisited."""
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        ctx.maximum_version = ssl.TLSVersion.TLSv1_1
        ctx.minimum_version = ssl.TLSVersion.TLSv1
    except (ValueError, AttributeError):
        return None, "this Python cannot offer TLS 1.0/1.1 — nothing to test"
    try:
        with socket.create_connection((host, 443), timeout=TIMEOUT) as raw:
            with ctx.wrap_socket(raw, server_hostname=host) as s:
                return False, f"negotiated {s.version()}"
    except ssl.SSLError:
        return True, "handshake refused, as it should be"
    except OSError as e:
        return None, f"could not test: {e}"


# ------------------------------------------------------------------- runner

def run(canon, bare, env):
    # Before anything is reported, establish that the answers come from the
    # site. On an intercepted connection every one of these checks measures the
    # middlebox instead, and reports it in the site's name.
    try:
        cert, _, _, _ = probe_tls(canon)
    except OSError as e:
        print(f"\n  cannot reach {canon}: {e}")
        print("  Run this from a machine that can.")
        return False
    bad = interception(cert, env)
    if bad:
        print(f"\n  REFUSING TO REPORT — {bad}.")
        print("  Everything below would describe that middlebox, not the site,")
        print("  and it would read exactly like a clean result. Run this from a")
        print("  machine with a direct connection.")
        return False

    print(f"\nPlaintext on {bare}")
    try:
        status, loc = probe_plaintext(bare)
        ok, detail = redirect_verdict(status, loc, bare)
        check(f"http://{bare}/ 301s to https on the same host", ok, detail)
    except OSError as e:
        check(f"http://{bare}/ is reachable", None, f"{e}")

    print(f"\nPlaintext on {canon}")
    try:
        status, loc = probe_plaintext(canon)
        ok, detail = redirect_verdict(status, loc, canon)
        check(f"http://{canon}/ 301s to https on the same host", ok, detail)
    except OSError as e:
        check(f"http://{canon}/ is reachable", None, f"{e}")

    print(f"\nCertificate and TLS on {canon}")
    try:
        cert, version, status, headers = probe_tls(canon)
    except OSError as e:
        check("the TLS handshake completes", False, f"{e}")
        return

    check("the certificate validates against the system trust store", True,
          f"issued to {dict(x[0] for x in cert['subject']).get('commonName', '?')}")
    issuer = dict(x[0] for x in cert["issuer"])
    check("issued by a public CA", bool(issuer.get("organizationName")),
          issuer.get("organizationName", str(issuer)))

    san = [v for k, v in cert.get("subjectAltName", ()) if k == "DNS"]
    ok, detail = names_cover(san, [canon, bare])
    check("the certificate names both hosts", ok, detail)

    not_after = dt.datetime.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z")
    ok, detail = expiry_verdict(not_after, dt.datetime.utcnow())
    check("the certificate is comfortably in date", ok, detail)

    check("the connection is TLS 1.2 or better",
          version in ("TLSv1.2", "TLSv1.3"), version)

    ok, detail = refuses_old_tls(canon)
    check("TLS 1.0 and 1.1 are refused", ok, detail)

    ok, detail = hsts_verdict(headers.get("strict-transport-security"))
    check("HSTS is sent over HTTPS", ok, detail)
    check("HTTPS answers the page itself", status < 400, str(status))
    return True


def self_test():
    """Prove each verdict can still both fail and pass. A checker that has gone
    blind reports a clean site in exactly the same words as a clean site."""
    now = dt.datetime(2026, 1, 1)
    cases = [
        ("a redirect straight to www is refused",
         redirect_verdict(301, "https://www.x.com/", "x.com")[0] is False),
        ("a same-host https redirect passes",
         redirect_verdict(301, "https://x.com/", "x.com")[0] is True),
        ("a plaintext redirect is refused",
         redirect_verdict(301, "http://x.com/", "x.com")[0] is False),
        ("a 200 instead of a redirect is refused",
         redirect_verdict(200, None, "x.com")[0] is False),
        ("an expired certificate fails",
         expiry_verdict(dt.datetime(2025, 12, 1), now)[0] is False),
        ("one about to expire fails",
         expiry_verdict(dt.datetime(2026, 1, 10), now)[0] is False),
        ("a healthy one passes",
         expiry_verdict(dt.datetime(2026, 4, 1), now)[0] is True),
        ("a missing HSTS header fails", hsts_verdict(None)[0] is False),
        ("a short max-age fails",
         hsts_verdict("max-age=600")[0] is False),
        ("a year passes",
         hsts_verdict("max-age=31536000; includeSubDomains")[0] is True),
        ("a certificate missing the bare domain fails",
         names_cover(["www.x.com"], ["www.x.com", "x.com"])[0] is False),
        ("one naming both passes",
         names_cover(["www.x.com", "x.com"], ["www.x.com", "x.com"])[0] is True),
        ("a wildcard covers a subdomain",
         names_cover(["*.x.com"], ["www.x.com"])[0] is True),
        ("but a wildcard does not cover the bare domain",
         names_cover(["*.x.com"], ["x.com"])[0] is False),
        ("an interception CA is detected",
         interception({"issuer": ((("organizationName", "Anthropic"),),)},
                      {}) is not None),
        ("a proxy environment is detected",
         interception({"issuer": ((("organizationName", "Real CA"),),)},
                      {"HTTPS_PROXY": "http://p:8080"}) is not None),
        ("a direct connection to a real CA is not flagged",
         interception({"issuer": ((("organizationName", "Let's Encrypt"),),)},
                      {}) is None),
    ]
    bad = [n for n, ok in cases if not ok]
    for n, ok in cases:
        print(f"  {'PASS' if ok else 'FAIL'}  {n}")
    return not bad


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("host", nargs="?", default=CANON)
    ap.add_argument("--self-test", action="store_true",
                    help="check the verdicts, no network")
    a = ap.parse_args()

    if a.self_test:
        print("\nssl_check verdicts")
        ok = self_test()
        print("\n  " + ("verdicts intact" if ok else "VERDICTS BROKEN"))
        return 0 if ok else 1

    canon = a.host
    bare = canon[4:] if canon.startswith("www.") else canon
    print(f"HTTPS check — {canon}")
    if not run(canon, bare, os.environ):
        return 2

    failed = [n for n, ok, _ in results if ok is False]
    skipped = [n for n, ok, _ in results if ok is None]
    print(f"\n  {sum(1 for _, ok, _ in results if ok)} passed,"
          f" {len(failed)} failed, {len(skipped)} skipped")
    if skipped:
        print("  SKIP means the host was unreachable from here, not that it"
              " passed — run this where the site is reachable.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
