"use client";

// API Server tab — everything needed to point VS Code (Continue / Cline /
// any OpenAI client) at the local edge0-compatible endpoint: connection
// status, copy-ready config, live request log, and an in-page test console.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Plug,
  RadioTower,
  Server,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import { TIERS } from "@/lib/edge0/tiers";
import { Panel, SectionTitle, CodeBlock, StatChip, TierBadge, formatTime } from "./shared";

interface RequestRecord {
  id: string;
  ts: string;
  route: string;
  model: string;
  stream: boolean;
  client: string;
  promptTokens: number;
  completionTokens: number;
  tokPerSec: number;
  ttftMs: number;
  durationMs: number;
  status: number;
  engine?: "hosted-standin" | "offline-template";
  error?: string;
}

interface InsightsPayload {
  requests: RequestRecord[];
  stats: {
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    avgTokPerSec: number;
    avgTtftMs: number;
  };
  auth?: {
    mode: "bearer" | "open";
    apiKey?: string;
    masked?: string;
    envVar?: string;
  };
  engine?: {
    status: "hosted" | "offline";
    lastHostedOkAt: string | null;
    lastOfflineAt: string | null;
    offlineStreak: number;
    hostedOkCount: number;
    offlineCount: number;
  };
}

interface HealthInfo {
  ok: boolean;
  ms: number;
  models: string[];
  auth: string;
}

const DEFAULT_PROMPT =
  "Write a Pine Script v5 strategy: EMA 9/21 crossover with ATR-based stops. Keep it minimal.";

export function ApiServer() {
  const [origin, setOrigin] = useState("");
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [insights, setInsights] = useState<InsightsPayload | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);

  // test console
  const [model, setModel] = useState("edge0-35b");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [metrics, setMetrics] = useState<{ ttft: number; tokens: number; tps: number; totalMs: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const poll = useCallback(async () => {
    try {
      const [h, i] = await Promise.all([
        fetch("/api/v1/health", { cache: "no-store" }),
        fetch("/api/v1/insights", { cache: "no-store" }),
      ]);
      if (h.ok) {
        const t0 = performance.now();
        const j = await h.json();
        setHealth({ ok: true, ms: Math.round(performance.now() - t0), models: j.models ?? [], auth: j.auth ?? "open" });
      } else {
        setHealth((prev) => ({ ok: false, ms: prev?.ms ?? 0, models: prev?.models ?? [], auth: "?" }));
      }
      if (i.ok) setInsights(await i.json());
    } catch {
      setHealth((prev) => ({ ok: false, ms: prev?.ms ?? 0, models: prev?.models ?? [], auth: "?" }));
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [poll]);

  const base = origin ? `${origin}/api/v1` : "<this-deployment>/api/v1";
  const apiKey = insights?.auth?.apiKey ?? "";
  const authed = insights?.auth?.mode === "bearer" && !!apiKey;

  const copyKey = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 1600);
    } catch {
      // clipboard unavailable
    }
  };

  const continueConfig = useMemo(
    () =>
      JSON.stringify(
        {
          models: [
            {
              title: "Edge0 35B (local)",
              provider: "openai",
              apiBase: base,
              apiKey: authed ? apiKey : "local",
              model: "edge0-35b",
            },
            {
              title: "Edge0 8B (local, fast)",
              provider: "openai",
              apiBase: base,
              apiKey: authed ? apiKey : "local",
              model: "edge0-8b",
            },
          ],
        },
        null,
        2
      ),
    [base, authed, apiKey]
  );

  const clineConfig = `Provider:     OpenAI Compatible
Base URL:     ${base}
API Key:      ${authed ? apiKey : "local"}
Model ID:     edge0-35b        (smart)
              edge0-8b         (fast tier)`;

  const curlSmoke = `# 1) list models
curl "${base}/models${authed ? `?key=${apiKey}` : ""}"

# 2) streaming chat (SSE)
curl ${base}/chat/completions \\
  -H "Authorization: Bearer ${authed ? apiKey : "local"}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"edge0-35b","stream":true,
       "messages":[{"role":"user","content":"Write a Pine Script EMA cross strategy"}]}'`;

  async function runTest() {
    if (running) {
      abortRef.current?.abort();
      return;
    }
    setRunning(true);
    setOutput("");
    setMetrics(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const t0 = performance.now();
    let ttft = 0;
    let tokens = 0;
    let tps = 0;
    try {
      const res = await fetch(`${origin}/api/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authed ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({ model, stream: true, messages: [{ role: "user", content: prompt }] }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const j = JSON.parse(payload);
            const delta: unknown = j.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              if (!ttft) ttft = performance.now() - t0;
              setOutput((o) => o + delta);
            }
            const usage = j.usage;
            if (usage?.completion_tokens) tokens = usage.completion_tokens;
            const e0tps = j.edge0?.tok_per_sec;
            if (typeof e0tps === "number") tps = e0tps;
          } catch {
            // partial frame — wait for more bytes
          }
        }
      }
      setMetrics({ ttft: Math.round(ttft), tokens, tps, totalMs: Math.round(performance.now() - t0) });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setOutput((o) => o + `\n\n[error] ${e instanceof Error ? e.message : "request failed"}`);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const stats = insights?.stats;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-10 sm:px-6">
      <SectionTitle
        kicker="openai-compatible endpoint"
        title="Serve edge0 to your IDE"
        sub="This deployment exposes /api/v1 — an OpenAI wire-compatible API with SSE streaming, paced by the edge0 decode model. Point VS Code (Continue, Cline, any OpenAI client) at it and watch requests land live."
      />

      {insights?.engine?.status === "offline" ? (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-orange-400/40 bg-orange-400/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-orange-300" />
          <div className="text-[12.5px] leading-relaxed text-orange-200">
            <span className="font-semibold">Stand-in model unreachable</span> — requests retry 3× then fall back to
            offline templates. JSON-asking clients receive a valid{" "}
            <span className="font-mono">{"{verdict: \"skip\", retryable: true}"}</span> signal instead of prose,
            so scanners keep parsing. Auto-recovers on the next request once the gateway is back.
          </div>
        </div>
      ) : null}

      {/* ----------------------------------------------- connection status ---- */}
      <Panel className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-10 w-10 items-center justify-center rounded-lg border ${
                health?.ok
                  ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                  : "border-zinc-700 bg-zinc-800/50 text-zinc-500"
              }`}
            >
              {health?.ok ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
            </span>
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
                endpoint {health?.ok ? "reachable" : "checking…"}
                {health?.ok ? (
                  <span className="font-mono text-[11px] font-normal text-emerald-300/80">{health.ms} ms</span>
                ) : null}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-zinc-500">
                <span className="rounded border border-zinc-700 bg-zinc-900/80 px-1.5 py-0.5 text-amber-200">{base}</span>
                <span>auth: {health?.auth ?? "…"}</span>
                <span className="inline-flex items-center gap-1">
                  <Plug className="h-3 w-3" /> GET · POST, SSE
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {Object.values(TIERS).map((t) => (
              <TierBadge key={t.id} tier={t.id} />
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-amber-400/30 bg-amber-400/10">
            <KeyRound className="h-3.5 w-3.5 text-amber-300" />
          </span>
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">api key · {authed ? "required" : "open"}</div>
            <div className="mt-0.5 truncate font-mono text-[12px] text-amber-200">
              {!authed ? "no key set — endpoint is open" : showKey ? apiKey : insights?.auth?.masked}
            </div>
          </div>
          {authed ? (
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setShowKey((v) => !v)}
                aria-label={showKey ? "Hide API key" : "Reveal API key"}
                className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
              <button
                onClick={copyKey}
                aria-label="Copy API key"
                className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                {keyCopied ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatChip label="requests" value={stats?.totalRequests ?? 0} tone="amber" />
          <StatChip label="tokens served" value={(stats?.totalCompletionTokens ?? 0).toLocaleString()} tone="emerald" />
          <StatChip label="avg decode" value={stats?.avgTokPerSec ?? 0} unit="tok/s" tone="orange" />
          <StatChip label="avg TTFT" value={stats?.avgTtftMs ?? 0} unit="ms" tone="zinc" />
        </div>
      </Panel>

      {/* ----------------------------------------------------- IDE configs ---- */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel className="p-5">
          <div className="mb-1 flex items-center gap-2">
            <TerminalSquare className="h-4 w-4 text-amber-300" />
            <h3 className="text-sm font-semibold text-zinc-200">VS Code · Continue</h3>
          </div>
          <p className="mb-3 text-xs text-zinc-500">
            Install the <span className="font-mono text-zinc-300">Continue</span> extension, open{" "}
            <span className="font-mono text-zinc-300">config.yaml → edit JSON</span>, paste:
          </p>
          <CodeBlock title="continue config.json" code={continueConfig} />
        </Panel>

        <Panel className="p-5">
          <div className="mb-1 flex items-center gap-2">
            <Server className="h-4 w-4 text-amber-300" />
            <h3 className="text-sm font-semibold text-zinc-200">VS Code · Cline</h3>
          </div>
          <p className="mb-3 text-xs text-zinc-500">
            Cline settings → <span className="font-mono text-zinc-300">API Provider → OpenAI Compatible</span>:
          </p>
          <CodeBlock title="cline settings" code={clineConfig} />
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
            Any OpenAI SDK works the same way: set <span className="font-mono">base_url</span> to the endpoint above
            and pick a model id from <span className="font-mono">GET /models</span>.
          </p>
        </Panel>
      </div>

      <div className="mt-6">
        <CodeBlock title="smoke test — run anywhere (terminal, VS Code task)" code={curlSmoke} />
      </div>

      {/* --------------------------------------------------- request log ---- */}
      <Panel className="mt-6 p-5">
        <div className="mb-1 flex items-center gap-2">
          <RadioTower className="h-4 w-4 text-amber-300" />
          <h3 className="text-sm font-semibold text-zinc-200">Live request log</h3>
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10.5px] text-zinc-600">
            <Activity className="h-3 w-3 animate-pulse text-emerald-400" /> polling every 3 s
          </span>
        </div>
        <div className="edge0-scroll mt-3 max-h-96 overflow-y-auto">
          <table className="w-full min-w-[720px] text-left font-mono text-[12px]">
            <thead className="sticky top-0 bg-[#0d0d10]">
              <tr className="border-b border-zinc-800 text-[10.5px] uppercase tracking-wider text-zinc-500">
                <th className="py-2 pr-3 font-normal">time</th>
                <th className="px-2 py-2 font-normal">client</th>
                <th className="px-2 py-2 font-normal">route</th>
                <th className="px-2 py-2 font-normal">model</th>
                <th className="px-2 py-2 font-normal">mode</th>
                <th className="px-2 py-2 text-right font-normal">tok/s</th>
                <th className="px-2 py-2 text-right font-normal">ttft</th>
                <th className="px-2 py-2 text-right font-normal">tokens</th>
                <th className="px-2 py-2 text-right font-normal">status</th>
              </tr>
            </thead>
            <tbody>
              {(insights?.requests ?? []).length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-zinc-600">
                    no requests yet — run the curl test or the console below, then watch it land here
                  </td>
                </tr>
              ) : (
                insights?.requests.map((r) => (
                  <tr key={r.id + r.ts} className="border-b border-zinc-800/50 last:border-0">
                    <td className="py-2 pr-3 text-zinc-500">{formatTime(r.ts)}</td>
                    <td className="px-2 py-2 text-zinc-300">{r.client}</td>
                    <td className="px-2 py-2 text-zinc-400">/{r.route}</td>
                    <td className={`px-2 py-2 ${r.model.includes("35") ? "text-amber-200" : "text-emerald-200"}`}>
                      {r.model}
                      {r.engine === "offline-template" ? (
                        <span className="ml-1.5 rounded bg-orange-400/15 px-1 py-0.5 text-[9.5px] uppercase tracking-wide text-orange-300">
                          stand-in
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-zinc-500">{r.stream ? "SSE" : "json"}</td>
                    <td className="px-2 py-2 text-right text-orange-200">{r.tokPerSec.toFixed(1)}</td>
                    <td className="px-2 py-2 text-right text-zinc-500">{r.ttftMs} ms</td>
                    <td className="px-2 py-2 text-right text-zinc-400">
                      {r.promptTokens}→{r.completionTokens}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10.5px] ${
                          r.status === 200
                            ? "bg-emerald-400/10 text-emerald-300"
                            : r.status === 499
                              ? "bg-zinc-700/40 text-zinc-400"
                              : "bg-red-400/10 text-red-300"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ---------------------------------------------------- test console ---- */}
      <Panel className="mt-6 p-5">
        <div className="mb-1 flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-amber-300" />
          <h3 className="text-sm font-semibold text-zinc-200">Test console</h3>
          <span className="font-mono text-[10.5px] text-zinc-600">POST /api/v1/chat/completions · stream:true</span>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                aria-label="Model"
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 font-mono text-[12px] text-zinc-200 outline-none focus:border-amber-400/60"
              >
                {Object.keys(TIERS).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <button
                onClick={runTest}
                disabled={running && !abortRef.current}
                className={`rounded-lg px-4 py-1.5 font-mono text-[12px] font-semibold transition-colors ${
                  running
                    ? "border border-zinc-700 bg-zinc-800 text-zinc-300 hover:text-zinc-100"
                    : "bg-amber-400 text-zinc-950 hover:bg-amber-300"
                }`}
              >
                {running ? "streaming… (click to stop)" : "run request"}
              </button>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              aria-label="Prompt"
              className="edge0-scroll w-full resize-none rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 font-mono text-[12.5px] leading-relaxed text-zinc-300 outline-none focus:border-amber-400/50"
            />
            {metrics ? (
              <div className="mt-3 grid grid-cols-4 gap-2">
                <StatChip label="ttft" value={metrics.ttft} unit="ms" tone="zinc" />
                <StatChip label="tokens" value={metrics.tokens} tone="emerald" />
                <StatChip label="decode" value={metrics.tps} unit="tok/s" tone="orange" />
                <StatChip label="total" value={(metrics.totalMs / 1000).toFixed(1)} unit="s" tone="amber" />
              </div>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80">
            <pre className="edge0-scroll max-h-[280px] min-h-[200px] overflow-y-auto whitespace-pre-wrap p-3 font-mono text-[12px] leading-relaxed text-zinc-300">
              {output || "streamed response appears here…"}
            </pre>
          </div>
        </div>
      </Panel>

      {/* ------------------------------------------------ honest boundary ---- */}
      <div className="mt-6 rounded-xl border border-amber-400/25 bg-amber-400/5 p-4 text-[12.5px] leading-relaxed text-zinc-400">
        <span className="font-semibold text-amber-300">Real vs simulated.</span> The wire contract, model ids, SSE
        streaming, decode pacing (~15–18 tok/s on 35b, ~24 on 8b) and telemetry are modeled on Edge0 (arXiv:2609.18063).
        Response text comes from a hosted stand-in model — swap{" "}
        <span className="font-mono text-zinc-300">generateReply()</span> for your real{" "}
        <span className="font-mono text-zinc-300">edge0 serve</span> (Apple Silicon / Windows-Vulkan) and every client
        above keeps working unchanged. Auth: the endpoint requires{" "}
        <span className="font-mono text-zinc-300">Authorization: Bearer</span> (also accepts{" "}
        <span className="font-mono text-zinc-300">x-api-key</span> or{" "}
        <span className="font-mono text-zinc-300">?key=</span> for curl). Rotate the secret via{" "}
        <span className="font-mono text-zinc-300">EDGE0_API_KEY</span> in{" "}
        <span className="font-mono text-zinc-300">.env.local</span> + restart.
      </div>
    </div>
  );
}
