#!/usr/bin/env python3
"""Stitch the per-route PDFs into one bookmarked document.

Kept separate from the Node scripts because pypdf is the only thing here that
can build a nested outline and set the document metadata; Chromium can render
a page but cannot assemble one.
"""
import json
import sys
from pypdf import PdfWriter, PdfReader

DIR = sys.argv[1] if len(sys.argv) > 1 else "/tmp/pdfout"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/sporta-website.pdf"
BUILT = sys.argv[3] if len(sys.argv) > 3 else ""

entries = json.load(open(f"{DIR}/index.json"))
writer = PdfWriter()


def add(path):
    """Append a file's pages and return the index of its first page."""
    first = len(writer.pages)
    for p in PdfReader(path).pages:
        writer.add_page(p)
    return first


writer.add_outline_item("Cover", add(f"{DIR}/00-cover.pdf"))

# Outline mirrors how the site is actually organised: language, then section.
# Arabic titles stay in Arabic so the bookmark panel reads correctly for an
# Arabic speaker rather than being transliterated.
for lang, label in (("en", "English"), ("ar", "العربية")):
    rows = [e for e in entries if e["lang"] == lang]
    if not rows:
        continue
    lang_node = writer.add_outline_item(label, len(writer.pages))
    for group in dict.fromkeys(r["group"] for r in rows):
        members = [r for r in rows if r["group"] == group]
        group_node = writer.add_outline_item(
            group, add(f"{DIR}/{members[0]['file']}"), parent=lang_node
        )
        writer.add_outline_item(
            members[0]["title"], len(writer.pages) - 1, parent=group_node
        )
        for r in members[1:]:
            writer.add_outline_item(
                r["title"], add(f"{DIR}/{r['file']}"), parent=group_node
            )

writer.add_metadata(
    {
        "/Title": "Sporta — Complete Website (www.sporta.com.kw)",
        "/Author": "Sporta سبورتا",
        "/Subject": f"Full capture of www.sporta.com.kw in English and Arabic, {BUILT}",
        "/Keywords": "Sporta, sportswear, Kuwait, ملابس رياضية, الكويت",
        "/Creator": "sporta-web/scripts/site-pdf.mjs",
    }
)
writer.write(OUT)
print(f"{OUT}: {len(writer.pages)} pages")
