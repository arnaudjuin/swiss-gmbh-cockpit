import { guard, json } from "@/server/http";
import { BASE_OBLIGATION_TYPES } from "@/server/obligations";
export const GET = guard(async () => json(BASE_OBLIGATION_TYPES));
