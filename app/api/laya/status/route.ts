import { getLayaStatus, warmLaya } from "@/lib/laya/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  // Warm on the first status poll so the first grade request is fast (a failure is recorded in the status).
  if (getLayaStatus().state === "idle") warmLaya().catch(() => undefined);
  return Response.json(getLayaStatus());
}
