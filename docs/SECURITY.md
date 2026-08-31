# Security & Data Protection

This document is for **you, the single user** of Muster Consulting Invoice Manager.
It explains where your data lives, what protects it, and what's still on you
to manage.

---

## Threat model in one paragraph

You're the only legitimate user. The app runs on your Mac. Your sensitive
data is the SQLite DB (`invoices.db`) and the document files in `documents/`.
The realistic threats are: (1) **someone gets physical access** to your Mac,
(2) **someone on the same local network** finds the running server,
(3) **you expose the app to the internet** (Cloudflare Tunnel etc.) and
someone brute-forces the password, (4) **a malicious browser extension or
script** runs in the tab and steals the session token, (5) **a third-party
LLM provider** (Anthropic/OpenAI) sees your data if you've switched away
from local Ollama.

Out of scope: nation-state attackers, supply-chain compromise of dependencies,
side-channel attacks. If those are in your threat model you have bigger
problems than this app.

---

## What's protected (defaults)

| Layer | Protection | Where it's enforced |
|---|---|---|
| **Bind address** | Server listens on `127.0.0.1` only by default — invisible to your local network | `app.py:HOST` |
| **Default password** | App **refuses to start** if `ADMIN_PASSWORD=demo` and `HOST != 127.0.0.1` (e.g. you tried to expose it before changing the password) | `auth.register()` |
| **Login brute-force** | Per-IP rate limit: 10 failed attempts per 15-minute rolling window → 429 | `auth.login` |
| **Session token** | 32-byte cryptographically-random `secrets.token_urlsafe`; 24h TTL by default; in-memory store (restart wipes all sessions) | `auth.login` + `auth.active_sessions` |
| **DB file permissions** | `chmod 600` on `invoices.db`; `chmod 700` on each `documents/*` folder — only your Unix user can read/write | `db.init_db()` |
| **Response headers** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` locks geolocation/camera/microphone, `Strict-Transport-Security` (HTTPS only) | `app.py:security_headers` middleware |
| **SQL injection** | Every query uses parameterized SQL (`?` placeholders) — no string concatenation, no raw query interface | All `routes_*.py` |
| **XSS in templates** | All user input rendered through `escapeHtml()` in the frontend | `static/js/*.js` |
| **AI write actions** | Model can only *propose* state changes (mark paid/unpaid) — actual mutation requires you click **Apply** in the chat UI; no INSERT/DELETE tool exposed | `llm_tools.py:propose_action` |
| **Auth bypass list** | Only `/`, `/api/login`, `/api/auth/check`, `/static/*`, `/share/{token}/...`, `/quick` skip auth. Everything else requires a valid Bearer token | `auth.auth_middleware` |
| **No CORS** | Default same-origin policy — no `Access-Control-Allow-Origin` is set | (not configured) |
| **No remote LLM by default** | `LLM_PROVIDER=ollama` keeps every request on `localhost:11434` | `llm.py` |

---

## What you must do

These are the human-side controls — the app can't enforce them for you.

### 1. Change the default password

Even on `127.0.0.1` it's smart hygiene. Put it in a `.env` file in the project
root (read automatically by `start.sh`):

```bash
echo 'ADMIN_PASSWORD=your-real-password-here' >> "~/swiss-gmbh-cockpit/.env"
```

The app already refuses to start with `demo` if you've changed `HOST`. Below
20 characters of entropy is risky if you ever expose the app — pick something
long.

### 2. Decide before you expose the app to the internet

The recommended setups, in order of safety:

| Setup | Safety | Notes |
|---|---|---|
| Localhost only (`HOST=127.0.0.1`, default) | 🟢 Highest | App is invisible to your network. Use this for daily work. |
| Cloudflare Tunnel + named tunnel + Cloudflare Access | 🟢 High | Adds Google/email OIDC on top of the password. See HOSTING.md. |
| Cloudflare Tunnel without Access (just trycloudflare URL) | 🟡 Medium | Anyone with the URL can attempt the password. **Required:** strong `ADMIN_PASSWORD` + rate limit (already on). |
| `HOST=0.0.0.0` on your laptop, no tunnel | 🔴 Low | Anyone on your wifi can poke the app. Only safe at home with a known network. |
| Listening on a public IP without HTTPS | ⛔ Don't | Token sent in plaintext. |

### 3. Back up regularly

The sidebar's **💾 Backup** icon downloads everything (DB + documents) as a
ZIP. **Heads-up:** the ZIP is **not encrypted**. Store backups somewhere safe
(external drive, encrypted cloud) and consider running:

```bash
zip -e cockpit_backup_encrypted.zip cockpit_backup_YYYY-MM-DD.zip
```

after download if you'll keep them in a less-trusted location.

### 4. Pick your LLM provider with care

- **`LLM_PROVIDER=ollama`** (default): All AI runs on your Mac. Zero data
  leaves your laptop.
- **`LLM_PROVIDER=anthropic`** or **`openai`**: Your data (questions, DB
  rows that match tool calls, document text in knowledge mode) is sent to a
  third party. Read their privacy policies if your financial data is
  sensitive.

### 5. Keep the OS-level encryption on

macOS **FileVault** (System Settings → Privacy & Security → FileVault)
encrypts everything at rest including `invoices.db`. With FileVault off,
anyone who lifts the disk reads your data trivially. The app's `chmod 600`
only protects against other logged-in users.

---

## Known limitations / what's NOT protected

- **No CSRF protection.** The frontend uses Bearer tokens in `localStorage`,
  not cookies, so traditional CSRF doesn't apply — but any XSS that grabs
  the token has full app access. Mitigation: keep dependencies up to date,
  don't paste random scripts into the dev console.
- **No 2FA.** Single password. If you need 2FA, put the app behind
  Cloudflare Access (which adds OIDC + WebAuthn).
- **Backups are unencrypted by default.** See #3 above.
- **Logs may contain bits of data.** Uvicorn logs request URLs (including
  query params like `?token=...`). Look at where you redirect logs in
  `start.sh` / launchd before sharing them.
- **Sessions are in-memory.** A server restart logs everyone (you) out.
  This is a feature for security but means you'll re-login on every
  redeploy.
- **AI chat history is browser-only.** Not persisted server-side; clearing
  the conversation removes it from memory. The model itself stores nothing.
- **No audit log.** The app doesn't record who marked which invoice paid
  when. Single-user, so usually unnecessary — git the `documents/` folder
  if you want history.
- **SQL access via Bash.** The `sqlite3` CLI bypasses every check above.
  Anyone with shell access to your Mac can read/modify the DB directly. The
  app can't help here; OS-level access control does.

---

## If something goes wrong

**Suspect a leaked password?**
1. Stop the app (`Ctrl+C`).
2. Edit `.env` and set a new `ADMIN_PASSWORD`.
3. Restart with `./start.sh` — all previously-issued tokens are invalidated
   (sessions are in-memory, wiped on restart).

**Suspect a tampered DB?**
1. Stop the app.
2. Restore the most recent backup ZIP.
3. Re-run `./start.sh` — the startup self-heal will reconcile the invoice ↔
   income link, budget ledger orphans, and recurring chains (see
   GUIDE.md § Data consistency).

**Suspect a compromised Mac?**
The DB and document files are unprotected against root / FileVault-decryption.
Treat the data as leaked. Rotate any sensitive entries (customer info,
account numbers, etc.) at their source.
