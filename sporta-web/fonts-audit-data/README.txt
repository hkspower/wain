FONTS AUDIT DATA (written by scripts/fonts-audit.mjs)

One JSON per page-state: <state id>__<lang>__<width>.json  (lang ar = bare URL, RTL; en = ?lang=en, LTR).
throttled__<id>__<lang>__<width>.json = the slow-network pass. index.json lists every file. summary.txt / summary.json aggregate them.
A state skipped because the build has no such control is a stub with "skipped":"why". An "error" key means the state did not measure.

PAGE-STATE FILE
  state{id,path,act,seed}  lang  width  height  url  finalUrl  status  actResult  page{title,htmlLang,htmlDir,rootFontPx,bodyFamily,bodyFontPx,docHeight,mounted,skeletonsLeft}
  platformFonts[]   the fonts Chrome says drew glyphs: {name (the font FILE's internal name), ps, web (came down as a web font), brand}
                    brand = web font named Alexandria* or IBM Plex Sans*. Everything else is a fallback or system font.
  styles[]          deduplicated computed type settings: ff (family stack as resolved), fs px, fw, fst, lh px|"normal", ls px|"normal", ws, tt, fvn (font-variant-numeric),
                    fsyn (font-synthesis), ffs, fvs, fstr, ta, dir
  runs[]            one per element that owns text (and every input/select/textarea):
                    i, sel (tag#id.class < parent < grandparent), tag, region (header|nav|main|footer|dialog|other), roles[], txt (first 70 chars), n (chars),
                    sc{ar,lat,dw (Western digits),da (Arabic-Indic digits),oth,sp}, dom (arabic|latin|digits|symbol), mixed (Arabic and Latin), st (index into styles[]),
                    lang (closest lang attribute), rect [x, y(document), w, h] of the TEXT, lines,
                    vis: visible | offscreen (outside the viewport horizontally, e.g. the closed bag drawer) | inert | hidden | transparent | clipped | nobox
                    pf [[platformFonts index, glyph count]...], glyphs, brandGlyphs, price, ctl{type,placeholder...}, allowed (small-text allow-list reason),
                    flags[] and det{} (the numbers behind each flag), culprits{count,of,list[{ch,cp,font}]} (characters a non-brand font drew)
  controls[]        every input/select/textarea/button: sel, tag, type, ff, fs, fw, w, h, x, textEntry, seen, flags[] (F-CTL-FAMILY, F-CTL-LT16)
  documentFonts[]   document.fonts after the page settled: family, weight, style, display, status (loaded|unloaded|error), unicodeRange
  fontFaceRules[]   the @font-face rules in readable stylesheets (cross-origin sheets are listed as unreadable)
  fontLinks[]       <link> preload/stylesheet/preconnect elements for fonts and font hosts
  fontRequests[]    each font file: url, status, mime, transferred (encoded bytes incl. headers), decoded, fromCache, startMs/endMs, headers{cache-control, etag, content-encoding, ...}
  fontHostRequests[] third-party font hosts (Adobe Fonts / Google): status, failed (net::ERR_BLOCKED_BY_CLIENT when this tool blocked it), blockedReason
  summary           counts: glyphs by font (all/visible), flags (all/visible), non-brand runs, allow-list hits, controls
  blockedWrites[] (non-GET requests the guard aborted), externalBlocked[], pageErrors[], console[], failedRequests[] (4xx/5xx or failed, non-font),
  notes[] (waits that gave up, stubbed or missing route CSS, reloads), stubbedCss[] (lazy route stylesheets the server lacked, answered with an EMPTY stub:
  that page's route CSS is not measured), routeCssMissing (the app reported "Unable to preload CSS"), navigations (document loads; 2+ = the app reloaded itself)
  info on a run: observations that are not flags (letter-spacing under 0.01em on Arabic)

FLAGS   F-NONBRAND F-WEIGHT F-SYNTH-BOLD F-STYLE F-AR-ITALIC F-AR-SPACING F-AR-UPPER F-AR-LEADING F-CTL-FAMILY F-CTL-LT16 F-PRICE-PROP F-SMALL F-MIXED-DIGITS F-NOPF
        (definitions and thresholds: the header of scripts/fonts-audit.mjs). Count a flag with vis === "visible" unless you mean the closed drawer too.

THROTTLED FILE
  profile (kbps, latency, cpuSlowdown)   derived{fcpMs, lcpMs, firstTextMs, firstTextElement, brandFacesLoadedAtFirstText, textShownBeforeBrandFont, foutMs, fullSwapMs,
  foitRiskAtFirstText, declaredDisplay, preloadedFontFiles, firstTextGlyphsByFont, firstTextGlyphsNonBrand, firstTextGlyphsTotal, brandFacesLateAfterFirstText[],
  firstBrandLoadedMs, lastBrandLoadedMs, fontFirstRequestMs, stylesheetsDoneMs, fontStartLagAfterCssMs (negative = fonts were requested before the CSS finished,
  i.e. preloaded), fontBytesBeforeFirstText, fontBytesTotal, clsTotal, clsFromFontSwap, shiftCount}
  firstText{sel,text,ff,faces[]}   firstTextFonts[]{sel,txt,fs,fw,fonts[{name,ps,web,brand,glyphs}]} (the platform font of up to 24 elements of the first screen,
  read while the page was frozen in the first-text frame)   faces[]{family,weight,display,loading,loaded,error (ms)}
  shifts[]{t, v, input, nearFontSwap, fontLoadedAtMs, face, sources[{node, prev[x,y,w,h], cur[x,y,w,h]}]}   timing{font[], stylesheetsDoneMs, ttfbMs, loadMs}   fontRequests

MEASURED ON THIS MACHINE, SO: the fallback a device substitutes is that device's; the data says what this one drew.
Re-run:  node scripts/fonts-audit.mjs   (BASE=https://www.sporta.com.kw to audit the real site; GET only)
