# Sea & Sand — design system

Extracted from wain's code (`src/app/theme.css`, `globals.css`, the component
class strings repeated across `src/`). Framework-free: plain CSS variables and
classes, no Tailwind or React needed. Arabic-first, RTL, logical properties only.

| File | What | Edit by hand? |
|---|---|---|
| `tokens.css` | `--ds-*` variables: colour (primitive + semantic), type, radius, elevation, space, motion | No — generated |
| `tokens.json` | Same tokens in W3C design-token shape (for Figma / Style Dictionary) | No — generated |
| `tokens.js` | Token-name list used by the preview | No — generated |
| `components.css` | `.ds-btn .ds-chip .ds-field .ds-card .ds-notice .ds-page` … | Yes |
| `preview.html` | Open in a browser; swatches are read from the live variables | Yes |

Regenerate after changing `theme.css`: `npm run design:portable`
(`npm run design:portable:check` fails if the files are stale).

## Use

```html
<link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="components.css">
<body class="ds-root"><button class="ds-btn ds-btn--primary">احجز</button>
```

## Principles (each came from a defect in the source)

1. **Two roles for sand.** 50–300 are neutral surfaces; 400–900 are warm brand. Never step across the seam.
2. **Use semantic tokens in product code** (`--ds-text-muted`); primitives only to define them.
3. **Floors, not preferences:** text ≥ 11px (Arabic dots vanish below), tap targets ≥ 24px (WCAG 2.5.8), fields ≥ 16px (iOS zoom).
4. **Looser leading as type shrinks** — Arabic descenders. Display 22–46px; body 11–20px.
5. **Control borders ≥ 3:1** (`--ds-border-control`); card hairlines stay quiet (`--ds-border-subtle`).
6. **White-on-colour buttons use 600+** (`sea-600` 5.0:1; `sea-500` fails at 3.3:1).
7. **Shadows are ink-tinted, layered contact + ambient**; offsets grow faster than blur.
8. **Density comes from space, not from shrinking targets.** Gutter 10→16px, rhythm 8→12px.
9. **Motion is short and respects `prefers-reduced-motion`.**
10. **Category colour is hue-only:** hero grounds and tints share lightness and chroma, so no category shouts.

## Not included (deliberately)

Dark mode (the product ships light only), icons (`docs/icons.md`), and the
شوق face and call sheet (product-specific).
