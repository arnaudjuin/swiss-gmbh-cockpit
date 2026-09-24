import { guard, json } from "@/server/http";
import { llmStatus } from "@/server/llm";

export const GET = guard(async () => json(await llmStatus()));
