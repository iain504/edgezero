import { NextRequest } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { getTier, TierId } from "@/lib/edge0/tiers";
import { Edge0Sim } from "@/lib/edge0/engine-sim";

export const runtime = "nodejs";
export const maxDuration = 120;

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `You are edge0-35b, a sparse Mixture-of-Experts model being served on-device by the edge0 streaming inference framework (SSD expert offload + prerouter + Recover-LoRA) on a Mac mini M4 Pro. You are a helpful, knowledgeable assistant. Keep answers focused and under ~220 words unless the user explicitly asks for depth or code. Use lightweight markdown (short paragraphs, lists, \`\`\` fences for code). Always answer in the user's language.`;

function tokenize(text: string): string[] {
  // split into word/punct tokens, keeping whitespace attached
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  let body: {
    sessionId?: string;
    tier?: string;
    prerouter?: boolean;
    messages?: IncomingMessage[];
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const cfg = getTier(body.tier ?? "edge0-35b");
  const prerouter = body.prerouter !== false;
  const incoming = (body.messages ?? []).filter(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()
  );
  const lastUser = [...incoming].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    return Response.json({ error: "messages must include a user message" }, { status: 400 });
  }
  if (incoming.length > 24) incoming.splice(0, incoming.length - 24);

  // ---- resolve or create the session ----
  let sessionId = body.sessionId;
  if (sessionId) {
    const existing = await db.chatSession.findUnique({ where: { id: sessionId } });
    if (!existing) sessionId = undefined;
  }
  if (!sessionId) {
    const title = lastUser.content.trim().slice(0, 60) || "New session";
    const created = await db.chatSession.create({ data: { title, tier: cfg.id } });
    sessionId = created.id;
  }
  const sid = sessionId;

  await db.message.create({
    data: { sessionId: sid, role: "user", content: lastUser.content.trim() },
  });

  // ---- ask the model (this latency doubles as the "prefill" window) ----
  const zai = await ZAI.create();
  const history = incoming.map((m) => ({ role: m.role, content: m.content }));
  const completionPromise = zai.chat.completions.create({
    messages: [{ role: "assistant", content: SYSTEM_PROMPT }, ...history],
    thinking: { type: "disabled" },
  });

  const encoder = new TextEncoder();
  const reqSignal = req.signal;
  let cancelled = false;
  let streamedText = "";
  reqSignal.addEventListener("abort", () => {
    cancelled = true;
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      let fullText = "";
      try {
        send({ type: "session", sessionId: sid, tier: cfg.id });

        // ---- prefill: prompt tokens stream through the layers ----
        const promptTokens = Math.round(
          incoming.reduce((n, m) => n + m.content.length, 0) / 4
        );
        const prefillRate = 0; // first request is cold (page cache empty)
        send({ type: "prefill", promptTokens, rate: prefillRate, cold: true });

        const completion = await completionPromise;
        fullText = completion.choices[0]?.message?.content ?? "";
        if (!fullText.trim()) fullText = "(empty response from the engine)";
        const warmRate = cfg.prefillWarm;
        send({ type: "prefill", promptTokens, rate: warmRate, cold: false });

        // ---- decode: stream tokens with simulated engine telemetry ----
        const sim = new Edge0Sim(cfg, prerouter, 1.6, 1000 + Date.now() % 100000);
        const tokens = tokenize(fullText);
        let lastRouteAt = -4;

        for (let i = 0; i < tokens.length; i++) {
          if (cancelled) break;
          const step = sim.step();
          // long answers fast-forward after ~350 tokens to keep UX snappy
          const delay = i < 350 ? 24 + Math.random() * 14 : 4;
          await sleep(delay);
          streamedText += tokens[i];
          send({
            type: "token",
            i,
            text: tokens[i],
            tps: +step.tokPerSec.toFixed(1),
            ram: +step.ramGiB.toFixed(2),
            ssdMB: +step.ssdMB.toFixed(1),
            ssdMbps: +step.ssdMbps.toFixed(0),
            hit: +step.hitRate.toFixed(3),
            acc: +step.prerouterAcc.toFixed(3),
            pool: step.poolUsed,
            miss: step.uncoveredMisses,
          });
          if (i - lastRouteAt >= 4 || i === tokens.length - 1) {
            lastRouteAt = i;
            send({
              type: "route",
              tok: i,
              layers: step.routes.map((r) => ({
                l: r.l,
                s: r.s,
                p: r.p,
                h: r.h,
                m: r.m,
              })),
            });
          }
        }

        const final = sim.step();
        const telemetry = {
          tokens: tokens.length,
          tokPerSec: +final.tokPerSec.toFixed(1),
          peakRamGiB: +final.ramGiB.toFixed(2),
          ssdMB: +final.ssdMB.toFixed(1),
          hitRate: +final.hitRate.toFixed(3),
          prerouterAcc: +final.prerouterAcc.toFixed(3),
          prerouter,
          tier: cfg.id,
        };
        send({ type: "done", telemetry });

        if (!cancelled) {
          await db.message.create({
            data: {
              sessionId: sid,
              role: "assistant",
              content: fullText,
              telemetry: JSON.stringify(telemetry),
            },
          });
          await db.chatSession.update({ where: { id: sid }, data: { updatedAt: new Date() } });
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "engine failure",
        });
      } finally {
        controller.close();
      }
    },
    cancel() {
      // client stopped the generation — persist whatever was decoded
      cancelled = true;
      const partial = streamedText.trim();
      if (partial) {
        void db.message
          .create({
            data: {
              sessionId: sid,
              role: "assistant",
              content: partial + " …",
              telemetry: JSON.stringify({ truncated: true, tier: cfg.id, prerouter }),
            },
          })
          .catch(() => undefined);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}

export type { TierId };
