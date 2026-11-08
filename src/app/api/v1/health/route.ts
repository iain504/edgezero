// GET /api/v1/health — liveness + which tiers this endpoint serves.

import { TIERS } from "@/lib/edge0/tiers";
import { getEngineHealth } from "@/lib/edge0/server/registry";
import { CORS_HEADERS, json, preflight } from "@/lib/edge0/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return preflight();
}

export async function GET() {
  return json(
    {
      status: "ok",
      service: "edge0-openai-compatible",
      engine: "edge0-streaming-sim (stand-in for `edge0 serve`)",
      models: Object.keys(TIERS),
      defaultModel: "edge0-35b",
      contract: "OpenAI /v1 (chat.completions, completions, models)",
      auth: process.env.EDGE0_API_KEY ? "bearer" : "open",
      engine: getEngineHealth(),
      forcedOffline: process.env.EDGE0_FORCE_OFFLINE === "1",
      uptimeSec: Math.round(process.uptime()),
    },
    200,
    { "Cache-Control": "no-store", ...CORS_HEADERS }
  );
}
