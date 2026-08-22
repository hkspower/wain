#!/usr/bin/env python3
"""Build the النوخذة film: the page, the narration script, and the subtitles.

    python3 design/film/build_film.py

Writes, next to this file:
    film.html          the film itself — one deterministic timeline
    narration-ar.txt   the Arabic narration, per scene, for the voice
    narration.srt      the same lines with their timecodes
    narration-plain.txt  just the words, for a TTS engine to read
    narration.json     scene timings, for the renderer and the voice script

Then `render.py` turns the page into an MP4.

The timeline lives here, once. The page, the subtitles and the narration are
all generated from it, so a scene cannot be four seconds long in the film and
five in the subtitle file — the failure that makes a voice track drift away
from the picture halfway through and cannot be fixed by nudging one end.

Every word of narration states something already true on the site: النوخذة is
free, it runs offline, the records stay on the device, the XBRL file is filed
through the Ministry of Commerce portal. No invented customers, no invented
numbers, no claim the product cannot make.
"""

import inspect
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
SITE = HERE.parent.parent / "almuhallab"

# ── the sprite, taken from the page rather than redrawn ────────────────────
WANT = ["i-boum", "i-anchor", "i-chart", "i-delivery", "i-report", "i-lock",
        "i-globe", "i-whatsapp", "i-instagram", "i-mail", "i-shield", "i-bolt",
        "i-blocks", "i-code"]


def sprite():
    src = (SITE / "index.html").read_text()
    out = []
    for name in WANT:
        m = re.search(r'<symbol id="%s".*?</symbol>' % re.escape(name), src, re.S)
        if not m:
            raise SystemExit(f"the sprite has no #{name} — the film cannot draw it")
        out.append(m.group(0))
    return "\n  ".join(out)


# ── helpers ───────────────────────────────────────────────────────────────

def a(name, start, dur, ease="cubic-bezier(.2,.7,.3,1)", extra=""):
    """One single-shot animation on the film's absolute clock."""
    return f"animation: {name} {dur}s {ease} {start}s both;{extra}"


def paper(x, y, dx, dy, rot, start, dur, mode="scatter"):
    return (f'<div class="paper" style="left:{x}px;top:{y}px;'
            f'--dx:{dx}px;--dy:{dy}px;--rot:{rot}deg;'
            f'{a(mode, start, dur, "ease-in-out")}">'
            '<i style="top:26px"></i><i style="top:52px;right:70px"></i>'
            '<i style="top:78px"></i></div>')


def card(icon, title, body, start):
    return (f'<div class="card" style="{a("rise", start, 0.8)}">'
            f'<span class="tile"><svg class="ic" aria-hidden="true">'
            f'<use href="#{icon}"/></svg></span>'
            f'<b>{title}</b><p>{body}</p></div>')


def row(label, amount, start, total=False):
    cls = "row total" if total else "row"
    return (f'<div class="{cls}" style="{a("slidein", start, 0.55)}">'
            f'<span>{label}</span>'
            f'<span class="amt ltr">{amount}</span></div>')


def fact(big, small, start):
    # No mixed number-and-currency here. "0 د.ك" is a Latin digit inside an
    # Arabic run, and bidi reordering puts the digit on the wrong side of the
    # currency — the same defect that once printed a phone number backwards on
    # the social tab. A word says it without needing a rule to survive.
    return (f'<div class="fact" style="{a("count", start, 0.6)}">'
            f'<b>{big}</b><span>{small}</span></div>')


def chan(icon, text, start):
    return (f'<div class="chan" style="{a("rise", start, 0.6)}">'
            f'<svg class="ic" aria-hidden="true"><use href="#{icon}"/></svg>'
            f'<span class="ltr">{text}</span></div>')


# ── the film ──────────────────────────────────────────────────────────────
# (id, seconds, narration lines, body-builder). Narration lines are what the
# voice says AND what the caption band shows, so they cannot disagree.

def scenes():
    S = []

    # 1 ─ the title card
    def title(t):
        return f"""
        <svg class="mark" viewBox="0 0 48 24" style="{a('pop', t+0.3, 1.1)}">
          <use href="#i-boum"/></svg>
        <div class="word" style="{a('rise', t+1.2, 0.9)}">النوخذة</div>
        <div class="sub"  style="{a('fade', t+2.0, 0.9, 'ease')}">
          النظام الموحّد — من <b>المهلب كود</b></div>"""
    S.append(("title", 8.0, [
        (0.6, 6.8, "النوخذة: النظامُ الموحَّد الذي بنته وتُشغّله شركةُ المهلب كود."),
    ], title))

    # 2 ─ what it replaces
    def problem(t):
        papers = "".join([
            # they scatter, but stay inside the frame: a card that leaves the
            # picture reads as a rendering fault, not as disorder
            paper(320, 220, -230, -110, -16, t + 1.6, 1.6),
            paper(580, 180, -80, -150, 9, t + 1.8, 1.6),
            paper(840, 220, 60, 120, 14, t + 2.0, 1.6),
            paper(1100, 180, 190, -130, -11, t + 2.2, 1.6),
            paper(1360, 220, 250, 110, 18, t + 2.4, 1.6),
        ])
        return f"""
        <h2 style="{a('rise', t+0.4, 0.8)}">قبل النوخذة</h2>
        <p class="lede" style="{a('fade', t+0.9, 0.8, 'ease')}">
          كلُّ شيءٍ صحيحٌ على حدة، ولا شيءَ متّفقٌ مع غيره.</p>
        <div style="position:relative;width:1600px;height:430px;margin-top:28px">{papers}</div>"""
    S.append(("problem", 11.0, [
        (0.6, 5.4, "محفظتُك في ملف، وطلباتُك في دفتر، وميزانيتُك في جدولٍ ثالث."),
        (5.6, 10.6, "ثلاثةُ مصادرَ للحقيقة، ولا واحدٌ منها يعرف الآخر."),
    ], problem))

    # 3 ─ صافي
    def safi(t):
        heights = [120, 168, 96, 210, 250, 186, 274]
        bars = "".join(
            f'<b style="height:{h}px;{a("grow", t+1.4+i*0.12, 0.7)}"></b>'
            for i, h in enumerate(heights))
        rows = "".join([
            row("زين", "1,240.500", t + 2.6),
            row("بيت التمويل", "860.250", t + 2.9),
            row("الوطني", "2,105.000", t + 3.2),
            row("القيمة السوقيّة", "4,205.750", t + 3.7, total=True),
        ])
        return f"""
        <div class="kicker" style="{a('fade', t+0.3, 0.6, 'ease')}">الوحدة الأولى</div>
        <h2 style="{a('rise', t+0.6, 0.8)}">صافي — محفظتُك</h2>
        <div style="display:flex;gap:80px;align-items:flex-end;margin-top:20px">
          <div class="bars">{bars}</div>
          <div class="rows" style="width:840px;margin-top:0">{rows}</div>
        </div>"""
    S.append(("safi", 11.0, [
        (0.5, 5.6, "صافي يتولّى محفظتَك: كلَّ صفقة، وسعرَ السوق، والربحَ والخسارة."),
        (5.8, 10.6, "بالدينار الكويتي، وبأرقامٍ تُحسَب لا تُكتَب."),
    ], safi))

    # 4 ─ التوصيل
    def delivery(t):
        rows = "".join([
            row("طلب رقم 1042 — سُلِّم", "78.500", t + 1.6),
            row("طلب رقم 1043 — في الطريق", "126.000", t + 2.0),
            row("طلب رقم 1044 — جاهز", "45.250", t + 2.4),
            # 78.500 + 126.000 + 45.250 = 249.750 — that is every order on the
            # screen, not only the delivered one. The label has to say so:
            # "إجمالي المُسلَّم" beside a sum that includes an order still on
            # its way is a wrong figure with a correct-looking total rule.
            row("إجمالي الطلبات", "249.750", t + 3.1, total=True),
        ])
        return f"""
        <div class="kicker" style="{a('fade', t+0.3, 0.6, 'ease')}">الوحدة الثانية</div>
        <h2 style="{a('rise', t+0.6, 0.8)}">التوصيل — طلباتُك</h2>
        <div class="rows">{rows}</div>"""
    S.append(("delivery", 11.0, [
        (0.5, 5.4, "والتوصيل يتولّى طلباتِك: من الطلب حتى التسليم."),
        (5.6, 10.6, "والإجماليُّ يُجمَع من سطوره، فلا يختلف عليه اثنان."),
    ], delivery))

    # 5 ─ one data core
    def core(t, dur=10.0):
        return f"""
        <h2 style="{a('rise', t+0.4, 0.8)}">نواةُ بياناتٍ واحدة</h2>
        <div class="cam" style="display:flex;align-items:center;gap:80px;
             margin-top:72px;{a('camera', t+0.6, dur-1.4, 'cubic-bezier(.4,0,.2,1)')}">
          <div style="display:flex;flex-direction:column;gap:36px">
            {card('i-chart', 'صافي', 'المحفظة والقيمة السوقيّة', t+1.0)}
            {card('i-delivery', 'التوصيل', 'الطلبات والمُسلَّم منها', t+1.3)}
          </div>
          <svg width="260" height="300" viewBox="0 0 260 300" fill="none"
               stroke="var(--tint)" stroke-width="4" stroke-linecap="round">
            <path d="M250 90H150C120 90 120 150 90 150H10" style="--len:420;{a('draw', t+2.0, 1.2, 'ease-in-out')}"/>
            <path d="M250 210H150C120 210 120 150 90 150H10" style="--len:420;{a('draw', t+2.3, 1.2, 'ease-in-out')}"/>
          </svg>
          <div class="core" style="{a('pop', t+3.0, 0.9)}">نواة<br>بيانات<br>واحدة</div>
        </div>"""
    S.append(("core", 10.0, [
        (0.5, 5.0, "الوحدتان تكتبان في نواةِ بياناتٍ واحدة."),
        (5.2, 9.6, "لا نسخةَ ثانيةً، ولا رقمَ يُنقَل باليد من جدولٍ إلى جدول."),
    ], core))

    # 6 ─ the annual filing
    def xbrl(t):
        rows = "".join([
            row("الإيرادات", "249.750", t + 1.4),
            row("الاستثمارات بالقيمة السوقيّة", "4,205.750", t + 1.8),
            row("مجموع الموجودات", "4,455.500", t + 2.6, total=True),
        ])
        return f"""
        <div class="kicker" style="{a('fade', t+0.3, 0.6, 'ease')}">من النواة نفسها</div>
        <h2 style="{a('rise', t+0.6, 0.8)}">الميزانية السنوية · ملف XBRL</h2>
        <div class="rows">{rows}</div>
        <div class="cards" style="margin-top:44px">
          {card('i-report', 'يُحسَب لا يُكتَب', 'كلُّ مجموعٍ مبنيٌّ من سطوره', t+4.2)}
          {card('i-shield', 'تدقيق قبل الإيداع', 'ما يمنع الإيداع، وما يُنبِّه فقط', t+4.5)}
          {card('i-globe', 'الإيداع في البوّابة', 'عبر بوّابة وزارة التجارة', t+4.8)}
        </div>"""
    S.append(("xbrl", 12.0, [
        (0.5, 5.6, "ومن النواة نفسِها تُبنى الميزانيةُ السنوية وملفُّ XBRL."),
        (5.8, 11.6, "الإجمالياتُ تُحسَب من سطورها، والتدقيقُ يُريك ما يمنع الإيداع قبل أن تُودِعه."),
    ], xbrl))

    # 7 ─ the three facts that matter, each one checkable
    def facts(t):
        return f"""
        <h2 style="{a('rise', t+0.4, 0.8)}">وثلاثةُ أشياءَ لا تتغيّر</h2>
        <div class="facts">
          {fact('مجاني', 'كلُّ الوحدات مفتوحة، بلا رسوم', t+1.2)}
          {fact('بلا إنترنت', 'يعمل بعد أوّل تشغيل', t+1.5)}
          {fact('في جهازك', 'السجلّات لا تغادره', t+1.8)}
        </div>
        <div class="cards" style="margin-top:56px">
          {card('i-lock', 'لا حساب على خادم', 'الدخول محليٌّ بالكامل', t+3.4)}
          {card('i-bolt', 'بلا اعتماديات', 'صفحات ثابتة، بلا مكتبات', t+3.7)}
        </div>"""
    S.append(("facts", 9.0, [
        (0.5, 4.4, "النوخذة نظامٌ مجانيٌّ بالكامل، وكلُّ وحداته مفتوحة."),
        (4.6, 8.6, "يعمل بلا إنترنت، وسجلّاتُك لا تغادر جهازَك."),
    ], facts))

    # 8 ─ the close: the company, then how to reach it
    def close(t):
        return f"""
        <svg class="mark sm" viewBox="0 0 48 24" style="{a('pop', t+0.3, 0.9)}">
          <use href="#i-boum"/></svg>
        <div class="word" style="font-size:96px;{a('rise', t+0.9, 0.8)}">المهلب</div>
        <div class="sub" style="{a('fade', t+1.4, 0.7, 'ease')}">شركة برمجة وأنظمة</div>
        <div class="chans">
          {chan('i-whatsapp', '+965 6589 4110', t+2.2)}
          {chan('i-instagram', '@almuhallab.code', t+2.5)}
          {chan('i-mail', 'hello@almuhallab-code.com', t+2.8)}
        </div>"""
    S.append(("close", 9.0, [
        (0.6, 4.6, "النوخذة من المهلب كود — شركةِ برمجةٍ وأنظمة."),
        (4.8, 8.6, "كلِّمنا على واتساب، ونبدأ من حيث أنت."),
    ], close))

    return S


# ── the voice sets the clock, when there is a voice ───────────────────────
# The captions are burned into the picture, so a narration line that runs
# longer than its caption does not simply overlap — it is speaking one
# sentence while the screen shows the next. Six of the fifteen lines came
# back longer than the slots I had written for them by ear.
#
# So the picture is re-timed to the recording rather than the recording
# squeezed into the picture: each line gets exactly as long as it takes to
# say, plus a beat. Timings, subtitles and the audio assembly all still come
# from this one place, so they cannot drift apart.
LEAD_IN = 0.6      # a beat after a scene appears, before anyone speaks
GAP = 0.45         # between two lines inside one scene
TAIL = 0.35        # after a line ends, before its caption goes
SCENE_TAIL = 1.0   # after the last line, before the scene changes


def voiced_timings(scene_lines, voiced, index):
    """Lay a scene's lines out end to end at their measured spoken length."""
    out, cursor = [], LEAD_IN
    for i, (_, _, text) in enumerate(scene_lines):
        dur = voiced[str(index + i + 1)]
        if i:
            cursor += GAP
        out.append((round(cursor, 2), round(cursor + dur + TAIL, 2), text))
        cursor += dur + TAIL
    return out, round(cursor + SCENE_TAIL, 2)


def build():
    S = scenes()
    voiced = None
    vp = HERE / "voice" / "durations.json"
    if vp.exists():
        voiced = json.loads(vp.read_text())

    html_scenes, captions, timing = [], [], []
    t = 0.0
    spoken = 0
    for name, dur, lines, body in S:
        if voiced:
            lines, dur = voiced_timings(lines, voiced, spoken)
            spoken += len(lines)
        # a scene that moves a camera needs to know how long it is on screen,
        # and that length comes from the recording — never from a number
        # written beside the drawing, which would fall out of step the first
        # time a line was re-recorded
        want = len(inspect.signature(body).parameters)
        html_scenes.append(
            f'<section class="sc" data-scene="{name}" '
            f'style="{a("scene", t, dur, "linear")}">'
            f'{body(t, dur) if want == 2 else body(t)}</section>')
        for start, end, text in lines:
            captions.append(
                f'<span style="{a("line", t+start, end-start, "linear")}">{text}</span>')
            timing.append({"scene": name, "start": round(t + start, 2),
                           "end": round(t + end, 2), "text": text})
        t += dur

    total = round(t, 2)
    tmpl = (HERE / "film.template.html").read_text()
    page = (tmpl
            .replace("<!--SPRITE-->", sprite())
            .replace("<!--SCENES-->", "\n  ".join(html_scenes))
            .replace("<!--CAPTIONS-->", "\n    ".join(captions))
            .replace("<!--TIMELINE-->", json.dumps(
                {"total": total, "lines": timing}, ensure_ascii=False)))
    (HERE / "film.html").write_text(page)

    # the narration, as the voice will read it — one line per caption
    txt = ["# نص التعليق الصوتي — فيلم النوخذة",
           f"# المدة الكاملة: {total} ثانية · {len(timing)} سطراً", ""]
    for i, ln in enumerate(timing, 1):
        txt.append(f"[{ln['start']:>6.2f} → {ln['end']:>6.2f}]  {ln['text']}")
    (HERE / "narration-ar.txt").write_text("\n".join(txt) + "\n")

    def ts(x):
        h, r = divmod(x, 3600)
        m, s = divmod(r, 60)
        return f"{int(h):02d}:{int(m):02d}:{s:06.3f}".replace(".", ",")

    srt = []
    for i, ln in enumerate(timing, 1):
        srt.append(f"{i}\n{ts(ln['start'])} --> {ts(ln['end'])}\n{ln['text']}\n")
    (HERE / "narration.srt").write_text("\n".join(srt))

    # the same words with nothing around them, for a text-to-speech engine
    # that reads a file: timecodes spoken aloud would be absurd
    (HERE / "narration-plain.txt").write_text(
        "\n".join(ln["text"] for ln in timing) + "\n")

    (HERE / "narration.json").write_text(
        json.dumps({"total": total, "lines": timing},
                   ensure_ascii=False, indent=1) + "\n")

    print(f"  film.html          {total}s, {len(S)} scenes"
          + ("  (timed to the recorded voice)" if voiced else "  (timed by ear)"))
    print(f"  narration-ar.txt   {len(timing)} lines")
    print("  narration.srt")
    print("  narration-plain.txt")
    print("  narration.json")
    return total


if __name__ == "__main__":
    build()
