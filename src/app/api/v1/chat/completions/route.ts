// POST /api/v1/chat/completions — OpenAI-compatible chat endpoint.
//
// stream:true  → SSE (`data: {chunk}\n\n` … `data: [DONE]`), tokens paced by
//                the Edge0 decode model so edge0-35b/8b stream at real tok/s.
// stream:false → single chat.completion JSON.
//
// The final chunk (and non-streaming body) carries an `edge0` telemetry
// object + usage; standard OpenAI clients ignore the extra field.

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
  messages?: { role?: string; content?: unknown }[];
  stream?: boolean;
  max_tokens?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseMessages(raw: Body["messages"]): ChatMsg[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ChatMsg[] = [];
  for (const m of raw) {
    const role = m?.role;
    const content =
      typeof m?.content === "string"
        ? m.content
        : Array.isArray(m?.content)
          ? m.content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("")
          : "";
    if ((role === "system" || role === "user" || role === "assistant") && content.trim()) {
      out.push({ role, content });
    }
  }
  return out.length ? out : null;
}

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

  const cfg = getTier(body.model ?? "edge0-35b");
  const msgs = parseMessages(body.messages);
  if (!msgs) {
    return oaError(
      "`messages` must be a non-empty array of {role, content} with role system|user|assistant.",
      "invalid_request_error",
      "invalid_messages",
      400
    );
  }

  const stream = body.stream === true;
  const id = newCompletionId();
  const created = Math.floor(Date.now() / 1000);
  const model = cfg.id;
  const promptTokens = countPromptTokens(msgs);
  const client = shortClient(req.headers.get("user-agent"));
  const started = Date.now();
  const maxTokens = typeof body.max_tokens === "number" && body.max_tokens > 0 ? body.max_tokens : undefined;

  // ---------------------------------------------------------- non-streaming
  if (!stream) {
    const { text, offline } = await generateReply(cfg, msgs);
    const done = await collectText(cfg, text, maxTokens, req.signal, offline);
    const totalMs = Date.now() - started;
    recordRequest({
      id,
      ts: new Date().toISOString(),
      route: "chat",
      model,
      stream: false,
      client,
      promptTokens,
      completionTokens: done.nTokens,
      tokPerSec: done.tokPerSec,
      ttftMs: totalMs,
      durationMs: totalMs,
      status: 200,
      engine: engineTag(offline),
    });
    return json({
      id,
      object: "chat.completion",
      created,
      model,
      system_fingerprint: offline ? "edge0-sim-offline" : "edge0-sim",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: done.text },
          finish_reason: done.truncated ? "length" : "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: done.nTokens,
        total_tokens: promptTokens + done.nTokens,
      },
      edge0: done.telemetry,
    });
  }

  // -------------------------------------------------------------- streaming
  const encoder = new TextEncoder();
  let cancelled = false;
  let nTokensOut = 0;
  let firstTokenAt = 0;
  let ttftMs = 0;
  let lastTps = cfg.decodeRange[0];
  let lastHit = 0;
  let lastAcc = 0;
  let offline = false;

  const recordDone = (status: number, error?: string) => {
    recordRequest({
      id,
      ts: new Date().toISOString(),
      route: "chat",
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
      const chunk = (delta: Record<string, unknown>, finish: string | null, extra: Record<string, unknown> = {}) => ({
        id,
        object: "chat.completion.chunk",
        created,
        model,
        system_fingerprint: offline ? "edge0-sim-offline" : "edge0-sim",
        choices: [{ index: 0, delta, finish_reason: finish, logprobs: null }],
        ...extra,
      });

      try {
        send(chunk({ role: "assistant", content: "" }, null));

        // "prefill": the stand-in model call fills this window, exactly like
        // the engine's prompt ingest before the first decoded token.
        const reply = await generateReply(cfg, msgs);
        offline = reply.offline;
        await sleep(Math.min(simulatedPrefillMs(cfg, promptTokens), 1200));

        for await (const t of paceTokens(cfg, reply.text, { signal, maxTokens })) {
          if (cancelled) break;
          if (!firstTokenAt) {
            firstTokenAt = Date.now();
            ttftMs = firstTokenAt - started;
          }
          lastTps = t.tps;
          lastHit = t.hitRate;
          lastAcc = t.prerouterAcc;
          nTokensOut++;
          send(chunk({ content: t.token }, null));
        }

        const finishReason = maxTokens !== undefined && nTokensOut >= maxTokens ? "length" : "stop";
        send(
          chunk({}, finishReason, {
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: nTokensOut,
              total_tokens: promptTokens + nTokensOut,
            },
            edge0: {
              tier: model,
              tok_per_sec: +lastTps.toFixed(1),
              prompt_tokens: promptTokens,
              completion_tokens: nTokensOut,
              ttft_ms: ttftMs || Date.now() - started,
              hit_rate: +lastHit.toFixed(3),
              prerouter_acc: +lastAcc.toFixed(3),
              engine: offline ? "offline-template" : "hosted-standin",
            },
          })
        );
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

/** Non-streaming helper: pace through the sim (for honest telemetry) and join. */
async function collectText(
  cfg: TierConfig,
  text: string,
  maxTokens: number | undefined,
  signal: AbortSignal,
  offline: boolean
) {
  let out = "";
  let n = 0;
  let tps = cfg.decodeRange[0];
  let hit = 0;
  let acc = 0;
  for await (const t of paceTokens(cfg, text, { signal, maxTokens })) {
    out += t.token;
    n++;
    tps = t.tps;
    hit = t.hitRate;
    acc = t.prerouterAcc;
  }
  const allTokens = text.match(/\S+\s*|\s+/g) ?? [text];
  return {
    text: out.trimEnd(),
    nTokens: n,
    tokPerSec: +tps.toFixed(1),
    truncated: maxTokens !== undefined && allTokens.length > maxTokens,
    telemetry: {
      tier: cfg.id,
      tok_per_sec: +tps.toFixed(1),
      completion_tokens: n,
      hit_rate: +hit.toFixed(3),
      prerouter_acc: +acc.toFixed(3),
      engine: offline ? "offline-template" : "hosted-standin",
    },
  };
}
