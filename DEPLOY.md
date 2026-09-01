# Deployment

Single-tenant by design: one password, one SQLite file, one process. Keep it
on localhost, a private network, or behind an authenticated tunnel.

## Local (development / personal use)

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python seed_demo.py      # demo data — skip for a blank install
ADMIN_PASSWORD=change-me .venv/bin/python app.py       # http://127.0.0.1:8000
```

Optional Next.js frontend:

```bash
cd cockpit-next && npm install
npm run dev                        # http://localhost:3000 (proxies /api to :8000)
```

## Docker

```bash
docker compose up --build
# backend  → http://127.0.0.1:8000
# frontend → http://127.0.0.1:3000
```

`docker-compose.yml` persists the database and uploaded documents in the
`./data` bind mount and seeds demo data on first start (set `SEED_DEMO=0` to
start blank). Set `ADMIN_PASSWORD` in the environment or an `.env` file.

## Exposing it (only after changing the password)

The app refuses to bind `0.0.0.0` while the password is the default.

- **Caddy** (automatic HTTPS): see `Caddyfile`, point it at `localhost:8000`.
- **Cloudflare Tunnel** (no open ports): `cloudflared tunnel --url
  http://localhost:8000`, or a named tunnel — walkthrough in
  `docs/HOSTING.md`.
- Add Cloudflare Access / any auth proxy in front for a second factor.

## Environment variables

| Var | Default | Notes |
|---|---|---|
| `ADMIN_PASSWORD` | `demo` | required for anything non-local |
| `HOST` / `PORT` | `127.0.0.1` / `8000` | backend bind |
| `SESSION_TTL` | `86400` | seconds |
| `LLM_PROVIDER` / `ANTHROPIC_API_KEY` | off | optional AI chat |
| `API_URL` (cockpit-next, **build time**) | `http://127.0.0.1:8000` | backend the `/api` rewrite targets |
| `SEED_DEMO` (docker) | `1` | seed fictional data on first start |

## Backups

`GET /api/backup` writes a zip of the DB + documents to
`documents/backups/` (the newest three are kept) and downloads it. Cron-friendly:

```bash
curl -H "Authorization: Bearer $TOKEN" -o backup.zip http://127.0.0.1:8000/api/backup
```
