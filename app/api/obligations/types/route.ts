import { guard, json } from "@/server/http";
import { obligationTypes } from "@/server/obligations";
export const GET = guard(async () => json(obligationTypes()));
