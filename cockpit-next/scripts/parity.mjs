#!/usr/bin/env node
// Diff the TypeScript backend against FastAPI on the same DB.
// Usage: PY=http://127.0.0.1:8001 TS=http://127.0.0.1:3100 node scripts/parity.mjs
const PY = process.env.PY || "http://127.0.0.1:8001";
const TS = process.env.TS || "http://127.0.0.1:3100";
const PASSWORD = process.env.ADMIN_PASSWORD || "demo";
const canon = (o) => { const walk = (v) => Array.isArray(v) ? v.map(walk)
  : (v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(k => [k, walk(v[k])]))
  : (typeof v === "number" ? Math.round(v * 100) / 100 : v)); return walk(o); };
const login = async (b) => (await (await fetch(b + "/api/login", { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) })).json()).token;
const get = async (b, t, p) => { const r = await fetch(b + "/api" + p, { headers: { Authorization: "Bearer " + t } });
  return r.ok ? r.json() : { __status: r.status }; };
const year = new Date().getFullYear();
const PATHS = ["/dashboard/overview", "/finance/forecast", `/reports/pl/${year}`, "/transfers/balance",
  "/reserves", "/obligations", "/obligations/types", "/runway", "/invoices", "/payroll/payslips",
  "/payroll/preview", "/bank-statements/latest", "/cash-balance", "/customers", "/expenses/reports",
  `/calendar?start=${year}-09-01&end=${year}-09-30`,
  "/search?q=" + encodeURIComponent("type:bill fuel >80") + "&limit=1000"];
const tPy = await login(PY), tTs = await login(TS);
let fail = 0;
for (const p of PATHS) {
  const [a, b] = await Promise.all([get(PY, tPy, p), get(TS, tTs, p)]);
  if (p.startsWith("/calendar")) for (const x of [a, b]) x.events?.sort((e, f) => (e.date + e.title).localeCompare(f.date + f.title));
  if (p.startsWith("/search")) a.results = (a.results || []).filter(r => ["invoice", "bill"].includes(r.type));
  const same = JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  console.log(same ? "ok  " : "DIFF", p);
  if (!same) fail++;
}
console.log(fail ? `${fail} DIFFS` : "full parity");
process.exit(fail ? 1 : 0);
