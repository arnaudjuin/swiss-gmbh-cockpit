#!/usr/bin/env node
// Node smoke test — port of tests/test_smoke.py. Boots a production server
// on a FRESH scratch database (schema self-installs), logs in, sweeps every
// GET route discovered from app/api/** for 500s, and runs a few write
// round-trips. Run after `npm run build`:  npm run smoke
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { waitReady, seed } from "./seed-demo.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3998;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "test_smoke_password";

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-smoke-"));
const child = spawn(path.join(ROOT, "node_modules", ".bin", "next"), ["start", "-p", String(PORT)], {
  cwd: ROOT, stdio: "ignore",
  env: { ...process.env, ADMIN_PASSWORD: PASSWORD, API_URL: "http://127.0.0.1:9",
    DB_PATH: path.join(scratch, "invoices.db"), DOCS_DIR: path.join(scratch, "documents") },
});

let failures = 0, checks = 0;
const ok = (cond, label) => {
  checks++;
  if (cond) return;
  failures++;
  console.error(`FAIL  ${label}`);
};

// Discover GET-able routes from the filesystem, like test_smoke does from app.routes.
function apiRoutes() {
  const out = [];
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      if (fs.statSync(fp).isDirectory()) walk(fp);
      else if (name === "route.ts") out.push(path.relative(path.join(ROOT, "app"), dir).split(path.sep).join("/"));
    }
  };
  walk(path.join(ROOT, "app", "api"));
  return out;
}

function fillParams(route) {
  if (route.includes("[token]")) return null;
  let url = "/" + route;
  url = url.replace(/\[id\]/g, "999999")
           .replace(/\[year\]/g, "2099")
           .replace(/\[month\]/g, "1")
           .replace(/\[quarter\]/g, "1")
           .replace(/\[name\]/g, "MANUAL.md");
  if (url.includes("[")) return null;
  return url;
}

try {
  await waitReady(BASE);

  // ── auth flow ──
  let r = await fetch(`${BASE}/api/login`, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ password: "wrong" }) });
  ok(r.status === 401, "wrong password → 401");
  r = await fetch(`${BASE}/api/login`, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) });
  ok(r.status === 200, "login → 200");
  const token = (await r.json()).token;
  const H = { Authorization: `Bearer ${token}` };
  ok((await fetch(`${BASE}/api/auth/check`, { headers: H })).status === 200, "auth check → 200");
  ok((await fetch(`${BASE}/api/dashboard`)).status === 401, "unauthenticated → 401");

  // ── seed the fresh DB through the API (proves the whole write path) ──
  ok(await seed(BASE, PASSWORD) === true, "demo seed on fresh DB");

  // ── GET sweep: no route may 500 ──
  const routes = apiRoutes();
  ok(routes.length > 90, `route count ${routes.length} > 90`);
  for (const route of routes) {
    const filled = fillParams(route);
    if (!filled) continue;
    let url = filled;
    if (url === "/api/search") url += "?q=test";
    const resp = await fetch(BASE + url, { headers: H });
    ok(resp.status !== 500, `GET ${url} → 500`);
    if (resp.status === 500) console.error("      body:", (await resp.text()).slice(0, 200));
  }

  // ── customer CRUD round trip ──
  const marker = "smoke-test-temp-customer";
  r = await fetch(`${BASE}/api/customers`, { method: "POST",
    headers: { ...H, "content-type": "application/json" },
    body: JSON.stringify({ name: marker, address: "Test 1", city: "Zurich",
      country: "Switzerland", email: "smoke@test.local" }) });
  ok(r.status === 200, "customer create");
  const custId = (await r.json()).id;
  let names = (await (await fetch(`${BASE}/api/customers`, { headers: H })).json()).map(c => c.name);
  ok(names.includes(marker), "customer appears in list");
  r = await fetch(`${BASE}/api/customers/${custId}`, { method: "PUT",
    headers: { ...H, "content-type": "application/json" },
    body: JSON.stringify({ name: marker + "-updated", address: "Test 2", city: "Bern",
      country: "Switzerland", email: "smoke@test.local" }) });
  ok(r.status === 200, "customer update");
  ok((await fetch(`${BASE}/api/customers/${custId}`, { method: "DELETE", headers: H })).status === 200, "customer delete");
  names = (await (await fetch(`${BASE}/api/customers`, { headers: H })).json()).map(c => c.name);
  ok(!names.includes(marker) && !names.includes(marker + "-updated"), "customer gone");

  // ── preferences round trip ──
  const snapshot = await (await fetch(`${BASE}/api/preferences`, { headers: H })).json();
  const sample = { _smoke_test: { a: 1, b: [2, 3] } };
  r = await fetch(`${BASE}/api/preferences`, { method: "PUT",
    headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(sample) });
  ok(r.status === 200, "preferences put");
  ok(JSON.stringify(await (await fetch(`${BASE}/api/preferences`, { headers: H })).json())
     === JSON.stringify(sample), "preferences round-trip");
  r = await fetch(`${BASE}/api/preferences`, { method: "PUT",
    headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(["not", "a", "dict"]) });
  ok(r.status === 400, "preferences rejects non-dict");
  await fetch(`${BASE}/api/preferences`, { method: "PUT",
    headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(snapshot) });

  // ── invoice PDF exists for a seeded invoice ──
  const invs = await (await fetch(`${BASE}/api/invoices`, { headers: H })).json();
  ok(invs.length > 0, "seeded invoices present");
  r = await fetch(`${BASE}/api/invoices/${invs[0].id}/pdf`, { headers: H });
  ok(r.status === 200 && (r.headers.get("content-type") || "").includes("pdf"), "invoice pdf serves");

  // ── logout ──
  ok((await fetch(`${BASE}/api/logout`, { method: "POST", headers: H })).status === 200, "logout → 200");
} finally {
  child.kill();
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
console.log("SMOKE OK");
