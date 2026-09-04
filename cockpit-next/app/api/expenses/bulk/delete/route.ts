import { NextRequest } from "next/server";
import { guard, json } from "@/server/http";
import { db } from "@/server/db";
import { DIRS, deleteStored } from "@/server/files";

export const POST = guard(async (req: NextRequest) => {
  const body = await req.json();
  const ids: number[] = body.ids ?? [];
  for (const eid of ids) {
    const row: any = db().prepare("SELECT scan_file FROM expenses WHERE id = ?").get(eid);
    if (row?.scan_file) deleteStored(DIRS.scans, row.scan_file);
    db().prepare("DELETE FROM expenses WHERE id = ?").run(eid);
  }
  return json({ deleted: ids.length });
});
