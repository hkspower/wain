"""Store a PNG at its smallest lossless encoding.

Pillow's optimize=True was the only setting the generators used, and it was
never the smallest: a zlib level 9 re-deflate of the same filtered scanlines,
or Pillow's compress_level 9, is smaller on most of the site's PNGs. Every
candidate is decoded and compared with the pixels being stored, and the
smallest one that decodes to the same pixels is written, so the image cannot
change. A candidate that does not match is never written.

    from png_store import write_png
    write_png(image, path)
"""

import io
import struct
import zlib

from PIL import Image

SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _chunk(kind, data):
    crc = zlib.crc32(kind + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)


def _redeflated(png):
    """The same PNG with its image data deflated at level 9. The filtered
    scanlines are carried over unchanged, so the pixels are too; every other
    chunk is copied byte for byte, CRC included."""
    if png[:8] != SIGNATURE:
        raise ValueError("not a PNG")
    parts, data, slot, pos = [], [], None, 8
    while pos < len(png):
        size, = struct.unpack(">I", png[pos:pos + 4])
        kind = png[pos + 4:pos + 8]
        if kind == b"IDAT":
            if slot is None:
                slot = len(parts)
                parts.append(b"")
            data.append(png[pos + 8:pos + 8 + size])
        else:
            parts.append(png[pos:pos + 12 + size])
        pos += 12 + size
    parts[slot] = _chunk(b"IDAT", zlib.compress(zlib.decompress(b"".join(data)), 9))
    return SIGNATURE + b"".join(parts)


def _pixels(im):
    return im.mode, im.size, im.tobytes()


def _decodes_to(png, wanted):
    decoded = Image.open(io.BytesIO(png))
    decoded.load()
    return _pixels(decoded) == wanted


def smallest_png(im):
    """The smallest PNG of `im` whose decoded pixels equal `im`'s."""
    im.load()
    wanted = _pixels(im)
    candidates = []
    for options in ({"optimize": True}, {"compress_level": 9}):
        buf = io.BytesIO()
        im.save(buf, "PNG", **options)
        candidates.append(buf.getvalue())
    candidates += [_redeflated(c) for c in candidates]
    fit = [c for c in candidates if _decodes_to(c, wanted)]
    if not fit:
        raise RuntimeError("no lossless candidate decodes to the same pixels")
    return min(fit, key=len)


def write_png(im, path):
    data = smallest_png(im)
    with open(path, "wb") as f:
        f.write(data)
    return len(data)
