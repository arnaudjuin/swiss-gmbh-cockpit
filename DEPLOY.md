# Deployment

Single-tenant by design: one password, one SQLite file, one process. Keep it
on localhost, a private network, or behind an authenticated tunnel.

The app ships as a **full-stack Next.js application** (`cockpit-next/`) —
every endpoint is served by Node, and the schema self-installs on an empty
database. The original FastAPI implementation remains in the repo as the
reference the TypeScript port is parity-tested against.

## Local (development / personal use)

```bash
cd cockpit-next
npm install
npm run build
npm run seed                       # fictional demo data — skip for a blank install
ADMIN_PASSWORD=change-me npm start # http://127.0.0.1:3000
```

`npm run dev` gives the hot-reloading dev server. `npm run smoke` boots a
scratch database, seeds it through the API, and sweeps every route for 500s.

Running the Python reference instead:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python seed_demo.py
ADMIN_PASSWORD=change-me .venv/bin/python app.py       # http://127.0.0.1:8000
```

## Docker

```bash
docker compose up --build          # → http://127.0.0.1:3000
```

`docker-compose.yml` persists the database and uploaded documents in the
`./data` bind mount and seeds demo data on first start (set `SEED_DEMO=0` to
start blank). Set `ADMIN_PASSWORD` in the environment or an `.env` file.
The FastAPI reference image still builds via `Dockerfile.fastapi`.

## Exposing it (only after changing the password)

- **Caddy** (automatic HTTPS): see `Caddyfile`, point it at `localhost:3000`.
- **Cloudflare Tunnel** (no open ports): `cloudflared tunnel --url
  http://localhost:3000`, or a named tunnel — walkthrough in
  `docs/HOSTING.md`.
- Add Cloudflare Access / any auth proxy in front for a second factor.

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `ADMIN_PASSWORD` | `demo` | change it for anything non-local |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | bind (Docker entrypoint) |
| `DB_PATH` | `../invoices.db` | the SQLite file (self-installs when empty) |
| `DOCS_DIR` | `../documents` | uploaded files (receipts, PDFs, statements) |
| `DOCS_MD_DIR` | `../docs` | in-app documentation markdown |
| `LLM_PROVIDER` + key | off | optional AI chat: `ollama`, `anthropic`, `openai` |
| `SEED_DEMO` (docker) | `1` | seed fictional data on first start |
| `API_URL` (build time) | — | legacy hybrid mode: FastAPI target for unported routes (none remain) |

## Backups

`GET /api/backup` writes a zip of the DB + documents to
`documents/backups/` (the newest three are kept) and downloads it. Cron-friendly:

```bash
curl -H "Authorization: Bearer $TOKEN" -o backup.zip http://127.0.0.1:3000/api/backup
```
