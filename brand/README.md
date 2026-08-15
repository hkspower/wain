# Brand source artwork

Master files the shipped logos were derived from. **Not deployed** — they live
here rather than in `sporta-web/public/` precisely so they do not end up in
`public_html`. `logo-original.png` alone is 522 kB, a third of the whole
uploadable package, and nothing on the site ever requests it.

What the site actually uses, in `sporta-web/public/`:

| File | Used for |
|---|---|
| `logo.png` | black wordmark, light backgrounds |
| `logo-white.png` | white wordmark, dark backgrounds (header, footer) |
| `favicon.png` | the S mark |
| `og-image.png` | social preview card |

If you regenerate any of those, export from the master here.
