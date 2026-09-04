import { NextRequest } from "next/server";
import { guard, json, err } from "@/server/http";
import { decodeBytes, parseCamt053 } from "@/server/camt";

export const POST = guard(async (req: NextRequest) => {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file || !file.name) return err(400, "No file uploaded");
  const raw = Buffer.from(await file.arrayBuffer());
  return json(parseCamt053(decodeBytes(raw)));
});
