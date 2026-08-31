# Contributing — project rules

FastAPI + vanilla-JS SPA. One stylesheet (`static/app.css`); the page is
assembled from `templates/parts/10-shell…60-tail.html` in name order; UI is
rendered from template strings in
`static/js/01-core.js` … `09-misc.js` (classic scripts, shared globals,
loaded in order — init lives at the end of 09-misc.js). Tests: `.venv/bin/python -m pytest tests/test_smoke.py -q` — run
them after any backend or route change.

## Design system (hard rules)

The canonical system lives in `design-system/` (see `canonical.css`, `README.md`, `references/*.html`). ALL NEW UI follows these rules:

1. **Never invent new visual variants.** The primitives (canonical rev 2) are:
   `.btn` (`--primary --ghost --outline --danger --warn --ok --sm --icon
   --icon-danger`), `.info-btn`, `.seg`, `.chip` (`--ok --danger --warn
   --info --owner --expected --count --sm`; categories = neutral `.chip`),
   `.panel` (`--flush`), `.headline-panel` (`--sm`, `__value--*`, `__sub`,
   `__verify--*`), `.stat` (`--wide`, `__head`, `__label`, `__value--*`,
   `__hint`) + `.stats-grid`/`--lead`, `.meter`/`.meter__bar`,
   `.section-label`, `.hint`, `.money`/`.date`/`.ref`, `.t-*` color
   utilities, `.row-split`, `.cols-2`, `.table` (`--zebra --compact
   --sticky`, `__group`, `__total`) in `.table-card`, §9 forms
   (`.control`, `.field`, `.field__label`) + dialogs (`.modal__title`,
   `.form-actions`), §10 `.notice` (`--ok --warn --danger --info`) +
   `.empty-state`, §11 calendar family, §12 responsive shell. If a design
   needs something else, extend `canonical.css` in the right § — don't
   inline it.
2. **Use tokens, never hardcode.** No new hex/rgba literals in app code.
   Colors come from `--ok/--danger/--warn/--info/--owner` families
   (`-fill` = solid, `-text` = colored text, `-bg/-border` = tints),
   surfaces from `--bg/--card/--border`, radii from `--r-sm/--r-md/--r-lg`,
   mono from `--font-mono`.
3. **Color = meaning only.** Green success, red danger/owed-by-you, amber
   pending/warn, blue info/primary action, purple = owner/personal money
   (one purple family — never introduce another). Never color for
   decoration.
4. **No new inline `style="…"` for anything a primitive covers** — hint
   text is `.hint`, money cells are `.money`, split rows are `.row-split`,
   stat accents are `.stat--*` modifiers. (don't add inline styles)
5. **`.money` (mono, tabular, right-aligned) for every CHF value** in
   tables and stat rows.
6. **Nothing rounder than `--r-lg`** except `--r-full` pills/avatars.
7. **Both themes always**: any new color pair needs its `[data-theme="dark"]`
   counterpart (token-level, not per-component).
8. **Layout never scrolls the page sideways**: wide tables scroll inside
   `.table-card`; flex/grid children that hold content get `min-width: 0`.
9. Emoji icons are the app's icon language — keep them; don't mix in icon
   fonts or ad-hoc SVGs (the two sidebar-footer SVGs are grandfathered).
10. **Colored text uses `-text`, colored paint uses `-fill`.** Never
    `color: var(--*-fill)`, never `background: var(--*-text)`.
11. **Categories are neutral `.chip`.** Colour is only status, owner-money,
    or classification. One `--primary` button per page header; `--warn`
    only for pending, `--danger` only for destructive.
12. **All CHF figures get `tabular-nums`** — `.money` in tables, `.stat__value`
    and `.headline-panel__value` in cards. Dates and IBAN/refs use `.date` /
    `.ref`, never `.money` with a text-align override.
13. **Numbers must never truncate.** Stat values are fluid
    (`clamp`); if a value doesn't fit, widen the cell (`.stat--wide`) —
    don't shrink the number or clip it.
14. **Only two inline styles remain legal:** a live `width:` on `.meter__bar`
    and a `flex:1`-style layout hint inside a `.row-split`. Everything else
    that looks like styling is a missing modifier — add it to canonical.css.
15. **Every new tinted pair ships light + dark in §1**, and dark tints are
    translucent rgba over `--card`, not solid hexes.
16. **Check the theme toggle on the matching reference page** before opening
    a UI PR; dark is not a post-hoc pass.

After UI changes, verify with the screenshot tool:
`design-audit/tools/run-audit.sh --only <ids>` (shot list in
`design-audit/tools/design-screenshots.mjs`) and compare against
`design-system/references/`.

## Bookkeeping invariants (don't break these when touching money code)

- Invoice `subtotal` = revenue (net of VAT); `tax` belongs to the ESTV.
- Payroll cost = **issued payslips**, never `settings × months`.
- Obligations are the *payment* side of costs already in payroll/bills —
  never add them into P&L costs.
- Kontokorrent: salaries and personal-card-reimbursement transfers are
  excluded (wages / settlements); personal-card bills count only while
  `reimbursed_at IS NULL`.
- FastAPI route order: literal paths (`/accounting/vendors`) must be
  declared before parameterized ones (`/accounting/{id}`).
- Docs live in `docs/`; they feed the in-app viewer, the checklist parser
  and the AI chat knowledge base — keep paths in sync in `routes/docs.py`,
  `routes/test_procedure.py`, `routes/llm.py`.
