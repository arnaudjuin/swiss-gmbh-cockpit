import { guard, json } from "@/server/http";
import { effectiveCash } from "@/server/cash";

export const GET = guard(async () => json(effectiveCash()));
