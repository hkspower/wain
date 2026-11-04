# Font masters

The eight WOFF2 files in this folder are the **masters** of the fonts the site ships (IBM Plex Sans Arabic 400/600/700 and the
Alexandria variable font, each in a Latin and an Arabic cut). They are byte-identical to what was in `sporta-web/public/fonts/` on
2026-11-04 and to what the live server serves (sha256 first 16 hex: alexandria-var-arabic e8d8ca61d4da1a1a, alexandria-var-latin
98ccec0bc3c45633, plex-400-arabic 6010e7fd0dce5d52, plex-400-latin 9ed8dcb02e6c7246, plex-600-arabic 16734a5adb27b0f3,
plex-600-latin 63f4757271e403f7, plex-700-arabic 04c730b4292731cc, plex-700-latin ae2d59f91ecf9f7e).

Masters live here and not in `public/` because anything in `public/` ships. **Never edit a master.** `public/fonts/` is generated:

```
node sporta-web/scripts/slim-fonts.mjs          # masters + used-weights.json  ->  sporta-web/public/fonts/*.woff2
node sporta-web/scripts/slim-fonts.mjs --check  # is public/fonts that rebuild? (exit 1 if not): the same bytes, or the same tables
                                                # when only the WOFF2 compression differs (another machine's brotli does that);
                                                # add --strict-bytes to demand the very same bytes
npm run test:fonts-used                         # the proof: pixels, weights, files (see the header of the script)
```

The rebuild needs python3 with `fonttools` and `brotli` (`pip install fonttools brotli`); a rebuild with fonttools 4.68.0 and brotli 1.2.1 is byte-identical
to the committed files (independent re-run 2026-11-04: 8 of 8). `--check` is written so that a different brotli build does not
fail it while every table is the same.

`used-weights.json` is the evidence the slimming rests on: which CSS weights the whole storefront really draws, per family, with
glyph counts. It is written by `npm run test:fonts-used -- --write-used` after a full crawl, never by hand. If a future page needs a
lighter Alexandria than 400, the suite fails first; widen the range by re-running the crawl (or lower `alexandria.wght.range`) and
rebuild, the masters keep the full 100-900 axis.

IBM Plex Sans Arabic and Alexandria are SIL Open Font License 1.1 fonts (see the audit note on shipping the licence text).
