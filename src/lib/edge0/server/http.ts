// Shared HTTP plumbing for the /api/v1 OpenAI-compatible routes:
// CORS (IDE extensions and browser clients hit this from other origins),
// optional bearer auth, and OpenAI-shaped error bodies.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
 * POC auth: open by default; set EDGE0_API_KEY to require `Authorization: Bearer <key>`.
 * Returns an error Response when rejected, or null when allowed.
 */
export function checkAuth(req: Request): Response | null {
  const key = process.env.EDGE0_API_KEY;
  if (!key) return null;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${key}`) return null;
  return oaError("Invalid API key. Set Authorization: Bearer <EDGE0_API_KEY>.", "invalid_request_error", "invalid_api_key", 401);
}

export function newCompletionId(): string {
  return `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
}
