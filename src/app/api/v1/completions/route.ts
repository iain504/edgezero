// POST /api/v1/completions — OpenAI legacy text-completion endpoint.
// prompt (string | string[]) → text_completion; stream supported (SSE).
// Useful for simple IDE "continue this snippet" integrations.

import { NextRequest } from "next/server";
import { TierConfig, getTier } from "@/lib/edge0/tiers";
import {
  ChatMsg,
  countPromptTokens,
  generateReply,
  paceTokens,
  simulatedPrefillMs,
} from "@/lib/edge0/server/responder";
import {
  checkAuth,
  CORS_HEADERS,
  json,
  newCompletionId,
  oaError,
  preflight,
} from "@/lib/edge0/server/http";
import { recordRequest, shortClient } from "@/lib/edge0/server/registry";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const engineTag = (offline: boolean) => (offline ? "offline-template" : "hosted-standin") as const;

interface Body {
  model?: string;
  prompt?: string | string[];
  stream?: boolean;
  max_tokens?: number;
  suffix?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function OPTIONS() {
  return preflight();
}

export async function POST(req: NextRequest) {
  const denied = checkAuth(req);
  if (denied) return denied;

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return oaError("Invalid JSON body.", "invalid_request_error", "invalid_json", 400);
  }

  const prompt = Array.isArray(body.prompt) ? body.prompt.join("\n") : body.prompt;
  if (!prompt || !prompt.trim()) {
    return oaError("`prompt` must be a non-empty string.", "invalid_request_error", "invalid_prompt", 400);
  }

  const cfg: TierConfig = getTier(body.model ?? "edge0-35b");
  const id = newCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const model = cfg.id;
  const stream = body.stream === true;
  const maxTokens = typeof body.max_tokens === "number" && body.max_tokens > 0 ? body.max_tokens : undefined;

  // FIM-lite: if a suffix is provided, mention it so the stand-in model fills
  // between prefix and suffix (the real engine handles FIM natively).
  const msgs: ChatMsg[] = [{ role: "user", content: body.suffix ? `Complete the code between <PRE> and <SUF>.\n<PRE>${prompt}<SUF>${body.suffix}` : prompt }];
  const promptTokens = countPromptTokens(msgs);
  const client = shortClient(req.headers.get("user-agent"));
  const started = Date.now();

  // ---------------------------------------------------------- non-streaming
  if (!stream) {
    const { text, offline } = await generateReply(cfg, msgs);
    let out = "";
    let n = 0;
    let tps = cfg.decodeRange[0];
    for await (const t of paceTokens(cfg, text, { signal: req.signal, maxTokens })) {
      out += t.token;
      n++;
      tps = t.tps;
    }
    const totalMs = Date.now() - started;
    recordRequest({
      id,
      ts: new Date().toISOString(),
      route: "completions",
      model,
      stream: false,
      client,
      promptTokens,
      completionTokens: n,
      tokPerSec: +tps.toFixed(1),
      ttftMs: totalMs,
      durationMs: totalMs,
      status: 200,
      engine: engineTag(offline),
    });
    return json({
      id,
      object: "text_completion",
      created,
      model,
      system_fingerprint: offline ? "edge0-sim-offline" : "edge0-sim",
      choices: [
        {
          index: 0,
          text: out.trimEnd(),
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: n,
        total_tokens: promptTokens + n,
      },
      edge0: { tier: model, tok_per_sec: +tps.toFixed(1), completion_tokens: n, engine: offline ? "offline-template" : "hosted-standin" },
    });
  }

  // -------------------------------------------------------------- streaming
  const encoder = new TextEncoder();
  let cancelled = false;
  let nTokensOut = 0;
  let ttftMs = 0;
  let lastTps = cfg.decodeRange[0];
  let offline = false;

  const recordDone = (status: number, error?: string) => {
    recordRequest({
      id,
      ts: new Date().toISOString(),
      route: "completions",
      model,
      stream: true,
      client,
      promptTokens,
      completionTokens: nTokensOut,
      tokPerSec: +lastTps.toFixed(1),
      ttftMs: ttftMs || Date.now() - started,
      durationMs: Date.now() - started,
      status,
      engine: engineTag(offline),
      error,
    });
  };

  const signal = req.signal;
  signal.addEventListener("abort", () => {
    cancelled = true;
  });

  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        if (!cancelled) controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };
      const chunk = (text: string, finish: string | null, extra: Record<string, unknown> = {}) => ({
        id,
        object: "text_completion.chunk",
        created,
        model,
        system_fingerprint: offline ? "edge0-sim-offline" : "edge0-sim",
        choices: [{ index: 0, text, finish_reason: finish, logprobs: null }],
        ...extra,
      });

      try {
        send(chunk("", null));
        const reply = await generateReply(cfg, msgs);
        offline = reply.offline;
        await sleep(Math.min(simulatedPrefillMs(cfg, promptTokens), 1200));

        for await (const t of paceTokens(cfg, reply.text, { signal, maxTokens })) {
          if (cancelled) break;
          if (!ttftMs) ttftMs = Date.now() - started;
          lastTps = t.tps;
          nTokensOut++;
          send(chunk(t.token, null));
        }

        send(chunk("", "stop", {
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: nTokensOut,
            total_tokens: promptTokens + nTokensOut,
          },
          edge0: { tier: model, tok_per_sec: +lastTps.toFixed(1), ttft_ms: ttftMs, engine: offline ? "offline-template" : "hosted-standin" },
        }));
        send("[DONE]");
        recordDone(200);
      } catch (err) {
        recordDone(500, err instanceof Error ? err.message : "engine failure");
      } finally {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
      recordDone(499, "client disconnected");
    },
  });

  return new Response(sse, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...CORS_HEADERS,
    },
  });
}
