// GET /api/v1/insights — request log + aggregate stats + auth info for the
// workbench UI (operator dashboard). Not part of the OpenAI contract.
//
// The API key is surfaced here by design: this dashboard is the single
// operator's view of a POC endpoint. Rotate anytime via EDGE0_API_KEY.

import { getInsights } from "@/lib/edge0/server/registry";
import { json, preflight } from "@/lib/edge0/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskKey(key: string): string {
  return `${key.slice(0, 9)}…${key.slice(-4)}`;
}

export async function OPTIONS() {
  return preflight();
}

export async function GET() {
  const key = process.env.EDGE0_API_KEY;
  const auth = key
    ? { mode: "bearer" as const, apiKey: key, masked: maskKey(key), envVar: "EDGE0_API_KEY" }
    : { mode: "open" as const };

  return json({ ...getInsights(), auth }, 200, { "Cache-Control": "no-store" });
}
