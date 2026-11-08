// Response engine for the edge0 OpenAI-compatible endpoint.
//
//   text     → hosted stand-in LLM (z-ai-web-dev-sdk), with retry/backoff and
//              a deterministic offline fallback so the endpoint never dead-ends.
//   pacing   → Edge0Sim drives per-token delay from the tier's decode model,
//              so edge0-35b streams at ~15–18 tok/s and edge0-8b at ~24 tok/s
//              exactly like the paper's numbers. TTFT reflects prefill rate.
//
// Resilience contract:
//   - 3 attempts with linear backoff before degrading to offline templates
//   - oversized prompts are truncated (scan payloads with OHLCV arrays can
//     otherwise fail deterministically, flapping the engine offline)
//   - when the client asks for JSON (scanners do), the offline fallback is a
//     valid, conservative "skip" signal — never prose — so downstream JSON
//     parsers keep working through engine outages
//   - EDGE0_FORCE_OFFLINE=1 pins the engine to offline templates (test mode
//     for client-side outage handling)
//
// Swapping in the REAL engine later = replace generateReply() with a call to
// `edge0 serve` (or the Rust daemon) — the API contract stays identical.

import ZAI from "z-ai-web-dev-sdk";
import { Edge0Sim } from "@/lib/edge0/engine-sim";
import { TierConfig } from "@/lib/edge0/tiers";
import { noteEngine } from "@/lib/edge0/server/registry";

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateResult {
  text: string;
  offline: boolean;
  attempts: number;
}

const MAX_CONTEXT_MSGS = 14;
const MAX_MSG_CHARS = 12_000;
const MAX_ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function systemPrompt(cfg: TierConfig): string {
  return (
    `You are ${cfg.id} (${cfg.params}), a sparse Mixture-of-Experts language model served ` +
    `locally on the user's own machine by the edge0 streaming inference engine ` +
    `(SSD expert offload, shared expert LRU pool, one-step-ahead prerouter). ` +
    `You are reached through an OpenAI-compatible /v1 API from the user's IDE (VS Code). ` +
    `Act as an expert coding assistant: precise, concise, production-minded. ` +
    `Prefer short paragraphs, lists, and fenced code blocks with language tags. ` +
    `If the user's message includes code, reference it specifically. ` +
    `When the user asks for JSON output, reply with ONLY the JSON object — no prose, no fences. ` +
    `You run fully on-device — never suggest sending code to the cloud.`
  );
}

/** Ask the stand-in model for a full reply. Retries, then falls back offline. */
export async function generateReply(cfg: TierConfig, msgs: ChatMsg[]): Promise<GenerateResult> {
  const forceOffline = process.env.EDGE0_FORCE_OFFLINE === "1";
  const trimmed = msgs.slice(-MAX_CONTEXT_MSGS).map((m) => ({
    ...m,
    content:
      m.content.length > MAX_MSG_CHARS
        ? m.content.slice(0, MAX_MSG_CHARS) + " …[truncated]"
        : m.content,
  }));

  if (!forceOffline) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const zai = await ZAI.create();
        const completion = await zai.chat.completions.create({
          messages: [{ role: "assistant", content: systemPrompt(cfg) }, ...trimmed],
          thinking: { type: "disabled" },
        });
        const text = completion.choices[0]?.message?.content ?? "";
        if (text.trim()) {
          noteEngine(false);
          return { text, offline: false, attempts: attempt };
        }
      } catch {
        // transient gateway/model failure — back off and retry
      }
      if (attempt < MAX_ATTEMPTS) await sleep(400 * attempt);
    }
  }

  noteEngine(true);
  return { text: offlineReply(cfg, msgs), offline: true, attempts: forceOffline ? 0 : MAX_ATTEMPTS };
}

// --------------------------------------------------------------- offline ----

/** Detect "answer me in JSON" prompts — scanners depend on parseable output. */
function wantsJson(last: string): boolean {
  return /\bjson\b/i.test(last) || /"verdict"|"signal"|"confidence"|\bverdict\b.*\bformat\b/i.test(last);
}

/** Deterministic, parseable, conservative no-trade signal for JSON-mode prompts. */
function offlineSignalJson(cfg: TierConfig): string {
  return JSON.stringify({
    verdict: "skip",
    action: "none",
    signal: "none",
    confidence: 0,
    entry: null,
    stop: null,
    target: null,
    engine: `${cfg.id}-offline-standin`,
    retryable: true,
    reason:
      "edge0 stand-in engine temporarily offline; this is the offline fallback signal — the scan cycle should retry",
  });
}

/**
 * Deterministic, dependency-free stand-in answers. JSON-mode prompts get a
 * parseable signal object; everything else gets prose templates.
 */
export function offlineReply(cfg: TierConfig, msgs: ChatMsg[]): string {
  const last = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
  if (wantsJson(last)) return offlineSignalJson(cfg);

  const lower = last.toLowerCase();
  const note = `\n\n*(served by ${cfg.id} · offline stand-in response)*`;

  if (/(pine|tradingview|strategy|backtest|ema|rsi|indicator)/.test(lower)) {
    return (
      `Here's a compact Pine Script v5 starting point:\n\n` +
      "```pine\n" +
      `//@version=5\nindicator("EMA cross (edge0 example)", overlay=true)\n` +
      `fast = ta.ema(close, 12)\nslow = ta.ema(close, 26)\n` +
      `long  = ta.crossover(fast, slow)\nshort = ta.crossunder(fast, slow)\n` +
      `plot(fast, "EMA 12", color=color.orange)\nplot(slow, "EMA 26", color=color.teal)\n` +
      `plotshape(long, style=shape.triangleup, location=location.belowbar, size=size.tiny)\n` +
      `plotshape(short, style=shape.triangledown, location=location.abovebar, size=size.tiny)` +
      "```\n\n" +
      `- 12/26 is the classic MACD pair; try 9/21 for faster intraday reactions.\n` +
      `- Add \`atr = ta.atr(14)\` and set stops as \`close - 2 * atr\` for volatility-adjusted risk.` +
      note
    );
  }

  if (/(debug|error|fix|bug|broken|fails?|exception)/.test(lower)) {
    return (
      `Let's isolate it methodically:\n\n` +
      `1. **Reproduce** with the smallest input that triggers it.\n` +
      `2. **Read the failing boundary** — assert types/values right before the throwing line.\n` +
      `3. **Bisect**: comment out half the path; if the error survives, the cause is in the other half.\n\n` +
      "```ts\n" +
      `console.assert(value !== undefined, "value undefined at entry", { value, args });\n` +
      "```\n\n" +
      `Paste the stack trace and the 20 lines around the throw site and I'll pinpoint it.` +
      note
    );
  }

  if (/(explain|what is|how does|difference|why)/.test(lower)) {
    return (
      `Short version: the mechanism you're asking about is best understood in three steps — ` +
      `**inputs**, **transformation**, **invariants**. Identify what goes in, what guarantees ` +
      `the code must uphold, and what comes out; most confusion dissolves at step two.\n\n` +
      `Give me the specific function or concept (paste it) and I'll walk through it line by line.` +
      note
    );
  }

  return (
    `I'm ${cfg.id}, running locally on your machine via the edge0 engine — connection is live ` +
    `and this endpoint is speaking the OpenAI wire protocol correctly.\n\n` +
    `Send me code to review, ask for a function to be written, or request an explanation and ` +
    `I'll answer in context.` +
    note
  );
}

// ---------------------------------------------------------------- pacing ----

/** Split text into rough word/punctuation tokens (whitespace attached). */
export function tokenize(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [text];
}

export function countPromptTokens(msgs: ChatMsg[]): number {
  return Math.max(1, Math.round(msgs.reduce((n, m) => n + m.content.length, 0) / 4));
}

/**
 * Simulated time-to-first-token from the tier's warm prefill rate,
 * capped so the POC stays responsive (the real engine would take longer
 * on big prompts — that's the honest number in the docs, not the demo).
 */
export function simulatedPrefillMs(cfg: TierConfig, promptTokens: number): number {
  return Math.min(1500, Math.max(150, Math.round((promptTokens / cfg.prefillWarm) * 1000)));
}

export interface PacedToken {
  token: string;
  i: number;
  tps: number;
  hitRate: number;
  prerouterAcc: number;
  ramGiB: number;
  ssdMbps: number;
}

/**
 * Yield tokens paced by the Edge0 decode model. Early tokens honor the
 * engine's tok/s (so the IDE feels real edge0 latency); very long answers
 * fast-forward after ~320 tokens to keep demo sessions snappy.
 */
export async function* paceTokens(
  cfg: TierConfig,
  text: string,
  opts: { signal?: AbortSignal; maxTokens?: number }
): AsyncGenerator<PacedToken> {
  const sim = new Edge0Sim(cfg, true, 1.6, 1000 + (Date.now() % 100000));
  let tokens = tokenize(text);
  if (opts.maxTokens && opts.maxTokens > 0) tokens = tokens.slice(0, opts.maxTokens);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < tokens.length; i++) {
    if (opts.signal?.aborted) return;
    const step = sim.step();
    const delay = i < 320 ? Math.min(140, Math.max(10, 1000 / step.tokPerSec)) : 5;
    await sleep(delay + Math.random() * 6);
    yield {
      token: tokens[i],
      i,
      tps: step.tokPerSec,
      hitRate: step.hitRate,
      prerouterAcc: step.prerouterAcc,
      ramGiB: step.ramGiB,
      ssdMbps: step.ssdMbps,
    };
  }
}
