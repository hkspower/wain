"""Re-encode one hero slide photo smaller, in place in the database row.

Reads /w/orig.txt (the row's data:image/...;base64 URI), writes /w/new.txt
and /w/new.json {w, h, bytes_before, bytes_after, hash}. The app versions a
slide URL by sha256 of exactly this data-URI string (admin.php), so the new
hash gives the photo a fresh URL and the year-long cache cannot serve the
old bytes.
"""
import base64, hashlib, io, json, re, sys
from PIL import Image

WIDTH = int(sys.argv[1]) if len(sys.argv) > 1 else 2400
QUALITY = int(sys.argv[2]) if len(sys.argv) > 2 else 80

uri = open('/w/orig.txt').read().strip()
m = re.match(r'^data:image/(png|jpeg|webp);base64,(.+)$', uri, re.S)
if not m:
    sys.exit('not a data URI')
raw = base64.b64decode(m.group(2))
im = Image.open(io.BytesIO(raw))
im.load()
w, h = im.size
if w > WIDTH:
    im = im.resize((WIDTH, round(h * WIDTH / w)), Image.LANCZOS)
out = io.BytesIO()
im.save(out, 'WEBP', quality=QUALITY, method=6)
new = out.getvalue()
if len(new) >= len(raw) * 0.8:
    sys.exit(f'not worth it: {len(raw)} -> {len(new)} bytes')
new_uri = 'data:image/webp;base64,' + base64.b64encode(new).decode()
open('/w/new.txt', 'w').write(new_uri)
info = {'from': [w, h], 'w': im.size[0], 'h': im.size[1], 'bytes_before': len(raw),
        'bytes_after': len(new), 'hash': hashlib.sha256(new_uri.encode()).hexdigest()}
json.dump(info, open('/w/new.json', 'w'))
print(json.dumps(info))

# The row update, written as a file and piped into the mysql client. Base64
# and a hex hash contain no quote characters, so plain quoting is safe.
SLIDE_ID = int(sys.argv[3]) if len(sys.argv) > 3 else 8
open('/w/update.sql', 'w').write(
    "UPDATE hero_slides SET image='%s', image_hash='%s', image_w=%d, image_h=%d WHERE id=%d;\n"
    % (new_uri, info['hash'], info['w'], info['h'], SLIDE_ID))
