#!/usr/bin/env node
// Production entrypoint (used by Docker): start `next start`, wait for it,
// seed fictional demo data on an empty database (unless SEED_DEMO=0), then
// keep the server in the foreground.
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { waitReady, seed } from "./seed-demo.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT || "3000";
const HOST = process.env.HOST || "0.0.0.0";

const child = spawn(path.join(ROOT, "node_modules", ".bin", "next"),
  ["start", "-p", PORT, "-H", HOST], { cwd: ROOT, stdio: "inherit", env: process.env });
child.on("exit", code => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));

if ((process.env.SEED_DEMO ?? "1") === "1") {
  try {
    await waitReady(`http://127.0.0.1:${PORT}`);
    await seed(`http://127.0.0.1:${PORT}`);
  } catch (e) {
    console.error("Seeding skipped:", e.message);
  }
}
