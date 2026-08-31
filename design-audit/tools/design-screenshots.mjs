#!/usr/bin/env node
/**
 * Design-audit screenshot driver — Muster Consulting Tool.
 *
 * Captures the numbered shot list from design-audit.md §10 into
 * design-audit/screenshots/NN-name.png.
 *
 * Usage:
 *   node design-screenshots.mjs [--base http://127.0.0.1:8399]
 *                               [--password design-audit]
 *                               [--only 3,4] [--skip 20,21]
 *                               [--out ../screenshots]
 *
 * Design decisions (per PLAYBOOK.md):
 *  - numbered ids: cheap re-verification of one screen (--only 16,17)
 *  - tolerant steps: failures log a warning and write NN-name.partial.png
 *  - the SPA has a single password login — we log in fresh each run
 *    (no storage-state file needed; token lives in localStorage)
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const BASE = arg('base', 'http://127.0.0.1:8399');
const PASSWORD = arg('password', process.env.ADMIN_PASSWORD || 'design-audit');
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), arg('out', '../screenshots'));
const only = arg('only', '') ? arg('only', '').split(',').map(Number) : null;
const skip = arg('skip', '') ? arg('skip', '').split(',').map(Number) : [];

const DESKTOP = { width: 1440, height: 940 };
const MOBILE = { width: 390, height: 844 };

/** Shot list — ids are STABLE; add new shots at the end, never renumber. */
const SHOTS = [
  { id: 1,  name: 'dashboard',            page: 'dashboard', fullPage: true },
  { id: 2,  name: 'financial-overview',   page: 'budget', fullPage: true },
  { id: 3,  name: 'budget-balances',      page: 'cash',
    after: async (p) => {
      await p.evaluate(() => document.getElementById('balances-groups')?.scrollIntoView());
      await p.waitForTimeout(300);
    } },
  { id: 4,  name: 'bills',                page: 'accounting' },
  { id: 5,  name: 'bills-form',           page: 'accounting-form' },
  { id: 6,  name: 'obligations',          page: 'obligations' },
  { id: 7,  name: 'calendar',             page: 'calendar' },
  { id: 8,  name: 'payroll',              page: 'payroll', fullPage: true },
  { id: 9,  name: 'income',               page: 'invoices' },   // merged into Invoices & Income
  { id: 10, name: 'reports',              page: 'reports', fullPage: true },
  { id: 11, name: 'dividends',            page: 'dividends', fullPage: true },
  { id: 12, name: 'invoices',             page: 'invoices' },
  { id: 13, name: 'customers',            page: 'customers' },
  { id: 14, name: 'expenses',             page: 'expenses', fullPage: true },
  { id: 15, name: 'trips',                page: 'trips' },
  { id: 16, name: 'bank',                 page: 'bank' },
  { id: 17, name: 'bank-expanded',        page: 'bank',
    after: async (p) => {                       // expand first statement row
      await p.click('#bank-tbody tr td:first-child', { timeout: 4000 });
      await p.waitForTimeout(1500);
    }, fullPage: true },
  { id: 18, name: 'docs',                 page: 'docs', fullPage: true },
  { id: 19, name: 'checklist',            page: 'test-procedure', fullPage: true },
  { id: 20, name: 'dark-dashboard',       page: 'dashboard', theme: 'dark', fullPage: true },
  { id: 21, name: 'dark-bank',            page: 'bank', theme: 'dark' },
  { id: 22, name: 'dark-calendar',        page: 'calendar', theme: 'dark' },
  { id: 23, name: 'mobile-dashboard',     page: 'dashboard', viewport: MOBILE, mobile: true },
  { id: 24, name: 'mobile-bank',          page: 'bank', viewport: MOBILE, mobile: true, fullPage: true },
  { id: 25, name: 'dialog-log-transfer',  page: 'bank',
    after: async (p) => {
      await p.evaluate(() => document.getElementById('transfer-dialog').classList.add('show'));
      await p.waitForTimeout(300);
    } },
  { id: 26, name: 'dialog-payslip-upload', page: 'payroll',
    after: async (p) => {
      await p.evaluate(() => openUploadPayslip());
      await p.waitForTimeout(300);
    } },
  { id: 27, name: 'ai-chat',              page: 'dashboard',
    after: async (p) => {
      await p.evaluate(() => document.getElementById('ai-chat-panel').classList.add('open'));
      await p.waitForTimeout(400);
    } },
  { id: 28, name: 'bills-form-fx',        page: 'accounting-form',
    after: async (p) => {
      await p.evaluate(() => {
        document.getElementById('acct-amount').value = '169.20';
        document.getElementById('acct-currency').value = 'EUR';
        document.getElementById('acct-fx-rate').value = '0.95';
        updateAcctFx();
      });
      await p.waitForTimeout(200);
    } },
  { id: 29, name: 'dialog-reimburse',     page: 'accounting',
    after: async (p) => {
      await p.evaluate(() => openReimburseDialog());
      await p.waitForTimeout(600);
    } },
  { id: 30, name: 'cash-plan',            page: 'cash',
    after: async (p) => {
      await p.evaluate(() => document.querySelector('#payroll-cash-plan')?.scrollIntoView());
      await p.waitForTimeout(300);
    } },
  { id: 31, name: 'cash-allocation',      page: 'cash' },
];

async function login(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#login-password', PASSWORD, { timeout: 8000 });
  await page.click('#login-btn');
  await page.waitForSelector('#app-sidebar', { state: 'visible', timeout: 8000 });
}

async function capture(browser, shot) {
  const ctx = await browser.newContext({
    viewport: shot.viewport || DESKTOP,
    isMobile: !!shot.mobile,
    hasTouch: !!shot.mobile,
    colorScheme: shot.theme === 'dark' ? 'dark' : 'light',
  });
  const page = await ctx.newPage();
  const file = `${OUT}/${String(shot.id).padStart(2, '0')}-${shot.name}`;
  let partial = false;
  try {
    await login(page);
    if (shot.theme === 'dark') {
      // apply AFTER load — the app stamps data-theme from localStorage
      await page.evaluate(() => {
        localStorage.setItem('theme', 'dark');
        document.documentElement.setAttribute('data-theme', 'dark');
      });
    }
    await page.evaluate((pg) => navigateTo(pg), shot.page);
    await page.waitForTimeout(1800);            // data fetches settle
    if (shot.after) {
      try { await shot.after(page); }
      catch (e) { console.warn(`  ⚠ [${shot.id}] after-step failed: ${String(e).slice(0, 120)}`); partial = true; }
    }
    await page.screenshot({ path: `${file}${partial ? '.partial' : ''}.png`, fullPage: !!shot.fullPage });
    console.log(`  ✓ ${shot.id} ${shot.name}${partial ? ' (partial)' : ''}`);
  } catch (e) {
    console.warn(`  ✗ [${shot.id}] ${shot.name}: ${String(e).slice(0, 160)}`);
    try { await page.screenshot({ path: `${file}.partial.png` }); } catch {}
  } finally {
    await ctx.close();
  }
}

(async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const list = SHOTS.filter(s => (!only || only.includes(s.id)) && !skip.includes(s.id));
  console.log(`Capturing ${list.length} shots from ${BASE} → ${OUT}`);
  for (const shot of list) await capture(browser, shot);
  await browser.close();
})();
