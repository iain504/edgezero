// GET /api/v1/models — OpenAI-compatible model listing for the local edge0 tiers.

import { TIERS } from "@/lib/edge0/tiers";
import { checkAuth, json, preflight } from "@/lib/edge0/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return preflight();
}

export async function GET(req: Request) {
  const denied = checkAuth(req);
  if (denied) return denied;

  const created = Math.floor(Date.parse("2026-09-08T00:00:00Z") / 1000);
  const data = Object.values(TIERS).map((t) => ({
    id: t.id,
    object: "model",
    created,
    owned_by: "edge0-local",
    meta: {
      checkpoint: t.checkpoint,
      params: t.params,
      base_family: t.baseFamily,
      quant: `int${t.quantBits}`,
      disk_gb: t.diskGB,
      decode_range_tps: t.decodeRange,
      engine: "edge0-streaming-sim",
    },
  }));

  return json({ object: "list", data });
}
