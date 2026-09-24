import { guard, json } from "@/server/http";

export const GET = guard(async () => json({ authenticated: true }));
