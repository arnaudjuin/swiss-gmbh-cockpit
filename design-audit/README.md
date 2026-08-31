# Design audit harness

Playwright-based screenshot sweep used to verify UI changes against the
design system — both themes, desktop + mobile.

```bash
design-audit/tools/run-audit.sh              # all ~31 shots
design-audit/tools/run-audit.sh --only 1,20  # a subset (ids in design-screenshots.mjs)
```

`run-audit.sh` boots the app on a throwaway port (`:8399`, password
`design-audit`) against the repo's `invoices.db`, captures every page defined
in `tools/design-screenshots.mjs` into `screenshots/` (gitignored), and shuts
the server down. Compare the output against `design-system/references/` after
any UI change; the shot list covers each page, dark mode and a 390×844 mobile
viewport.
