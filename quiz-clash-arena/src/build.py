"""Builds the single-file game: python3 -I src/build.py  ->  index.html
Everything (art, 108 questions) is embedded so deploying is one file."""
import base64, pathlib
here = pathlib.Path(__file__).parent
art = here / "art"
def uri(name, mime):
    return f"data:{mime};base64," + base64.b64encode((art / name).read_bytes()).decode()
html = (here / "q-arena.template.html").read_text(encoding="utf-8")
html = html.replace("__QUESTIONS__", (here / "questions.json").read_text(encoding="utf-8"))
html = html.replace("__LOGO__", uri("logo.webp", "image/webp"))
html = html.replace("__ARENA__", uri("arena.jpg", "image/jpeg"))
for t in ["shield_core", "double_down", "time_warp", "comeback_spark", "category_master", "streak_crown"]:
    html = html.replace(f"__I_{t}__", uri(f"{t}.webp", "image/webp"))
(here.parent / "index.html").write_text(html, encoding="utf-8")
print("index.html", len(html), "bytes")
