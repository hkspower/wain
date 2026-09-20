# المهلب كود — Almuhallab Code

The website of **Almuhallab Code**, a software company in Kuwait, and **النوخذة**,
the unified system it built and runs.

Everything shipped lives in [`almuhallab/`](almuhallab/) — a static HTML5
Progressive Web App with no build step and no dependencies. See
[`almuhallab/README.md`](almuhallab/README.md) for the site map, the النوخذة
system, the Kuwaiti annual XBRL filing, and how to run and publish it.

## Layout

| Path | What |
|------|------|
| `almuhallab/` | the site and the system — the deployable folder |
| `design/` | test suite, screenshot capture, PDF sample builder, admin console test |
| `CLAUDE.md` | project rules: the locked identity, naming, colour method, working practice |

## Tests

```bash
python3 design/test_suite.py     # full system test, exits non-zero on failure
python3 design/admin_test.py     # admin console
python3 design/capture.py        # screenshots every page
python3 design/build_pdf.py      # composes the PDF sample
```
