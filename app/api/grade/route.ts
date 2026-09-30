import { getCase } from "@/lib/evaluation/cases";
import { runPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const id = (body as { submissionId?: unknown } | null)?.submissionId;
  if (typeof id !== "string" || id === "") {
    return Response.json({ error: "body must be JSON {\"submissionId\": string}" }, { status: 400 });
  }
  const testCase = getCase(id);
  if (!testCase) return Response.json({ error: `unknown submission "${id}"` }, { status: 404 });
  try {
    return Response.json(await runPipeline(testCase));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
