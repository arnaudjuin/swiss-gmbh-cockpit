# Design system

`canonical.css` is the single source of truth for the UI: tokens (§1) and the
full primitive set (§2–§13) — buttons, chips, panels, stats, meters, tables,
forms/dialogs, notices, calendar, responsive rules, data-viz tokens, page
search and the recap tiles. `static/app.css` carries the same rules in the
live app; change them here first, then mirror.

`references/*.html` are static build-target pages (dashboard, bills, bank,
forms) composed only from canonical classes — open them in a browser to see
what every primitive should look like in both themes.

The rules that keep it coherent (no new hex literals, color = meaning only,
`tabular-nums` for every CHF figure, both themes always, …) live in
[CONTRIBUTING.md](../CONTRIBUTING.md).
