#!/bin/bash
# Regenerate server/schema.ts from the live database schema.
cd "$(dirname "$0")/.." && python3 - <<'EOF'
import subprocess, json
ddl = subprocess.run(["sqlite3", "../invoices.db", ".schema"], capture_output=True, text=True).stdout
stmts, cur = [], []
for line in ddl.splitlines():
    cur.append(line)
    if line.rstrip().endswith(";"):
        s = "\n".join(cur).strip(); cur = []
        if "sqlite_sequence" in s or "ts_sessions" in s: continue
        stmts.append(s.rstrip(";"))
src = open("server/schema.ts").read()
head = src.split("export const SCHEMA")[0]
tail = "export const SINGLETON_SEEDS" + src.split("export const SINGLETON_SEEDS")[1]
open("server/schema.ts","w").write(head + "export const SCHEMA: string[] = " + json.dumps(stmts, indent=2) + ";\n\n" + tail)
print("regenerated", len(stmts), "statements")
EOF
