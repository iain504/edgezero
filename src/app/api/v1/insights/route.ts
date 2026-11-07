// GET /api/v1/insights — request log + aggregate stats for the workbench UI.
// (Not part of the OpenAI contract; this is the endpoint's own telemetry.)

import { getInsights } from "@/lib/edge0/server/registry";
import { json, preflight } from "@/lib/edge0/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return preflight();
}

export async function GET() {
  return json(getInsights(), 200, { "Cache-Control": "no-store" });
}
