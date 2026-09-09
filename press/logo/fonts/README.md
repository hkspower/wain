Vendored from the game's own webfont set (next/font subsets, OFL —
IBM Plex Sans Arabic and Noto Naskh Arabic). Copied here rather than
read out of `.next/`, which is a build directory and gets cleared: the
identity sources have to render the same on a clean checkout.

Big Shoulders (display) and Geist Mono (annotation) are vendored here
too, and for a sharper version of the same reason. Every source in this
directory used to load them with an absolute `file:///` URL into a
skills cache outside the repository. That path stopped existing — the
cache moved under a generated directory name — and nothing failed
loudly: a missing `@font-face` src just falls through to the next family
in the stack, so the marks kept rendering and kept looking wrong. The
lockups fell back to a generic sans and the badge, whose SVG `<text>`
named no fallback at all, rendered the monogram in a serif.

A logo that silently changes typeface is worse than one that fails to
build, so nothing in this directory now reads a font from outside the
repository. `npm run check:logo` fails if any source tries.
