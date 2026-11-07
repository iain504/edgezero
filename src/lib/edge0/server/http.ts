// Shared HTTP plumbing for the /api/v1 OpenAI-compatible routes:
// CORS (IDE extensions and browser clients hit this from other origins),
// optional bearer auth, and OpenAI-shaped error bodies.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
  "Access-Control-Max-Age": "86400",
};

export function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...extraHeaders },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** OpenAI-style error body. */
export function oaError(message: string, type: string, code: string, status: number): Response {
  return json({ error: { message, type, code, param: null } }, status);
}

/**
 * Auth: set EDGE0_API_KEY (in .env.local) to lock the endpoint. Accepted:
 *   1. Authorization: Bearer <key>   (OpenAI SDKs, Continue, Cline)
 *   2. X-Api-Key: <key>              (some clients)
 *   3. ?key=<key>                    (bare curl smoke tests)
 * Open (no key required) while EDGE0_API_KEY is unset.
 * Returns an error Response when rejected, or null when allowed.
 */
export function checkAuth(req: Request): Response | null {
  const key = process.env.EDGE0_API_KEY;
  if (!key) return null;

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const xKey = req.headers.get("x-api-key")?.trim() ?? "";
  let qKey = "";
  try {
    qKey = new URL(req.url).searchParams.get("key")?.trim() ?? "";
  } catch {
    // malformed URL — fall through to rejection
  }

  if (bearer === key || xKey === key || qKey === key) return null;
  return oaError(
    "Invalid API key. Send Authorization: Bearer <key> (see the API Server tab for the key).",
    "invalid_request_error",
    "invalid_api_key",
    401
  );
}

export function newCompletionId(): string {
  return `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}
