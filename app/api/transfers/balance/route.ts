import { guard, json } from "@/server/http";
import { kontokorrentBalance } from "@/server/kontokorrent";
export const GET = guard(async () => json(kontokorrentBalance()));
