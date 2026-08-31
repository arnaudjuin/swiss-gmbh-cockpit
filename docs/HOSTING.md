# Hosting Muster Consulting Manager

> **Before exposing the app to anyone outside your laptop**, read `SECURITY.md`.
> Short version: change `ADMIN_PASSWORD` away from `demo` first — the app
> will refuse to start if you bind it to anything other than `127.0.0.1`
> while the default password is in use.

## Quick option: Cloudflare Tunnel (free, no domain needed)

Get a public HTTPS URL pointing to your Mac in 2 minutes.

### 1. Install cloudflared

```bash
brew install cloudflared
```

### 2. Start the tunnel

In one terminal, start your app:
```bash
cd "~/swiss-gmbh-cockpit"
source .venv/bin/activate
export ADMIN_PASSWORD="your-secure-password"
python app.py
```

In another terminal:
```bash
cloudflared tunnel --url http://localhost:8000
```

Cloudflare prints a URL like:
```
https://random-name-xyz.trycloudflare.com
```

That URL works from anywhere — your phone, your accountant, etc. HTTPS included.

### 3. Open it on your phone

Visit the URL on your phone, log in with your `ADMIN_PASSWORD`. Add to home screen for app-like experience.

---

## Permanent option: Named tunnel with custom domain (free Cloudflare account)

If you have a domain on Cloudflare:

```bash
# One-time setup
cloudflared tunnel login
cloudflared tunnel create cockpit
cloudflared tunnel route dns cockpit invoices.yourdomain.com
```

Create `~/.cloudflared/config.yml`:
```yaml
tunnel: cockpit
credentials-file: ~/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: invoices.yourdomain.com
    service: http://localhost:8000
  - service: http_status:404
```

Then run:
```bash
cloudflared tunnel run cockpit
```

Set `SECURE_COOKIES=true` in your env when behind HTTPS.

---

## Run as a service (so it auto-starts)

Create `~/Library/LaunchAgents/com.cockpit.app.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.cockpit.app</string>
  <key>ProgramArguments</key>
  <array>
    <string>~/swiss-gmbh-cockpit/.venv/bin/python</string>
    <string>~/swiss-gmbh-cockpit/app.py</string>
  </array>
  <key>WorkingDirectory</key><string>~/swiss-gmbh-cockpit</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ADMIN_PASSWORD</key><string>your-secure-password</string>
    <!-- HOST=127.0.0.1 (the default) is recommended; only set 0.0.0.0 if you -->
    <!-- intentionally want the app reachable from your local network. -->
    <key>HOST</key><string>127.0.0.1</string>
    <key>PORT</key><string>8000</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/cockpit.log</string>
  <key>StandardErrorPath</key><string>/tmp/cockpit.err</string>
</dict>
</plist>
```

Then:
```bash
launchctl load ~/Library/LaunchAgents/com.cockpit.app.plist
```

The app starts automatically on login and restarts if it crashes.
