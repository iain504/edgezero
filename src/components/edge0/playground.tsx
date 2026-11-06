"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Activity,
  ArrowUp,
  Cpu,
  HardDrive,
  History,
  Loader2,
  MemoryStick,
  Plus,
  Radio,
  Square,
  Trash2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { TIERS, getTier, type TierId } from "@/lib/edge0/tiers";
import { Panel, TierBadge, formatTime } from "./shared";

// ---------------------------------------------------------------- types

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  telemetry?: Telemetry | null;
  streaming?: boolean;
}

interface Telemetry {
  tokens?: number;
  tokPerSec?: number;
  peakRamGiB?: number;
  ssdMB?: number;
  hitRate?: number;
  prerouterAcc?: number;
  prerouter?: boolean;
  tier?: string;
  truncated?: boolean;
}

interface LayerRoute {
  l: number;
  s: number[];
  p: number[];
  h: number;
  m: number;
}

interface Live {
  tps: number;
  ram: number;
  peak: number;
  ssdMB: number;
  ssdMbps: number;
  hit: number;
  acc: number;
  pool: number;
  miss: number;
  tok: number;
  phase: "idle" | "prefill" | "decode";
}

const INITIAL_LIVE: Live = {
  tps: 0, ram: 0, peak: 0, ssdMB: 0, ssdMbps: 0, hit: 0, acc: 0, pool: 0, miss: 0, tok: 0,
  phase: "idle",
};

const SUGGESTIONS = [
  "Explain how SSD expert offload keeps RAM flat.",
  "Write a haiku about the memory wall.",
  "What does the prerouter predict, exactly?",
];

// ------------------------------------------------------------- heatmap

function RoutingHeatmap({ routes, tierId }: { routes: LayerRoute[]; tierId: TierId }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cfg = getTier(tierId);
  const cellW = 3;
  const cellH = 4;
  const width = cfg.experts * cellW;
  const height = cfg.layers * cellH;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#101013";
    ctx.fillRect(0, 0, width, height);
    // faint resident texture
    ctx.fillStyle = "#1d1d22";
    for (let l = 0; l < cfg.layers; l++) {
      for (let e = 0; e < cfg.experts; e++) {
        if ((e * 7 + l * 13) % 11 < 3) {
          ctx.fillRect(e * cellW, l * cellH, cellW - 1, cellH - 1);
        }
      }
    }
    const byLayer = new Map(routes.map((r) => [r.l, r]));
    for (const r of routes) {
      for (const e of r.p) {
        ctx.fillStyle = "rgba(52, 211, 153, 0.85)";
        ctx.fillRect(e * cellW, r.l * cellH, cellW - 1, cellH - 1);
      }
      for (const e of r.s) {
        ctx.fillStyle = "#fbbf24";
        ctx.fillRect(e * cellW, r.l * cellH, cellW - 1, cellH - 1);
      }
      void byLayer;
    }
  }, [routes, cfg, width, height]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="h-auto w-full rounded-md border border-zinc-800/80"
        style={{ imageRendering: "pixelated" }}
        aria-label="Per-layer expert routing heatmap"
        role="img"
      />
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-amber-400" /> selected (top-{cfg.topK})</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-emerald-400/85" /> prerouter prediction</span>
        <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-[2px] bg-zinc-700" /> resident-ish</span>
        <span className="ml-auto text-zinc-600">{cfg.layers} layers × {cfg.experts} experts</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ sparkline

function Sparkline({ samples }: { samples: number[] }) {
  const w = 320;
  const h = 56;
  const max = Math.max(60, ...samples);
  const pts = samples.length
    ? samples.map((v, i) => `${(i / Math.max(1, samples.length - 1)) * w},${h - (v / max) * (h - 6) - 3}`).join(" ")
    : "";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-14 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="ssdFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(251,191,36,0.35)" />
          <stop offset="100%" stopColor="rgba(251,191,36,0)" />
        </linearGradient>
      </defs>
      {pts ? (
        <>
          <polyline points={`0,${h} ${pts} ${w},${h}`} fill="url(#ssdFill)" stroke="none" />
          <polyline points={pts} fill="none" stroke="#fbbf24" strokeWidth="1.6" />
        </>
      ) : null}
      <text x={w - 2} y={12} textAnchor="end" fill="#71717a" fontSize="9" fontFamily="monospace">
        {max.toFixed(0)} MB/s
      </text>
    </svg>
  );
}

// -------------------------------------------------------- markdown body

const mdComponents = {
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => <p className="mb-2.5 last:mb-0 leading-relaxed" {...props} />,
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => <ul className="mb-2.5 ml-4 list-disc space-y-1 last:mb-0" {...props} />,
  ol: (props: React.HTMLAttributes<HTMLOListElement>) => <ol className="mb-2.5 ml-4 list-decimal space-y-1 last:mb-0" {...props} />,
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className="mb-2 text-base font-semibold" {...props} />,
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h3 className="mb-2 text-base font-semibold" {...props} />,
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => <h4 className="mb-1.5 text-sm font-semibold" {...props} />,
  code: ({ className, children, ...rest }: React.HTMLAttributes<HTMLElement>) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return (
        <pre className="edge0-scroll mb-2.5 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/90 p-3 font-mono text-[11.5px] leading-relaxed text-zinc-300">
          <code {...rest}>{children}</code>
        </pre>
      );
    }
    return (
      <code className="rounded bg-zinc-800/80 px-1 py-0.5 font-mono text-[11.5px] text-amber-200" {...rest}>
        {children}
      </code>
    );
  },
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => <>{props.children}</>,
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a className="text-amber-300 underline underline-offset-2" target="_blank" rel="noreferrer" {...props} />,
  strong: (props: React.HTMLAttributes<HTMLElement>) => <strong className="font-semibold text-zinc-100" {...props} />,
};

// ------------------------------------------------------------- main view

interface SessionMeta {
  id: string;
  title: string;
  tier: string;
  messages: number;
  updatedAt: string;
}

export function Playground() {
  const { toast } = useToast();
  const [tierId, setTierId] = useState<TierId>("edge0-35b");
  const [prerouter, setPrerouter] = useState(true);
  const cfg = getTier(tierId);

  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [live, setLive] = useState<Live>(INITIAL_LIVE);
  const [routes, setRoutes] = useState<LayerRoute[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [spark, setSpark] = useState<number[]>([]);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      // offline is fine
    }
  }, []);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  const pushLog = useCallback((line: string) => {
    const ts = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs((prev) => [...prev.slice(-90), `${ts} ${line}`]);
  }, []);

  const loadSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}`);
      if (!res.ok) throw new Error("not found");
      const data = await res.json();
      setSessionId(id);
      setTierId((data.session.tier as TierId) ?? "edge0-35b");
      setMessages(
        data.messages.map((m: { id: string; role: string; content: string; telemetry: Telemetry | null }) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          telemetry: m.telemetry,
        }))
      );
      setRoutes([]);
      setLive(INITIAL_LIVE);
      setSpark([]);
      setLogs([`loaded session ${id.slice(0, 8)} · ${data.messages.length} messages`]);
    } catch {
      toast({ title: "Could not load session", variant: "destructive" });
    }
  }, [toast]);

  const newSession = useCallback(() => {
    abortRef.current?.abort();
    setSessionId(null);
    setMessages([]);
    setRoutes([]);
    setLive(INITIAL_LIVE);
    setSpark([]);
    setLogs([]);
  }, []);

  const deleteSession = useCallback(
    async (id: string) => {
      await fetch(`/api/sessions/${id}`, { method: "DELETE" }).catch(() => undefined);
      if (sessionId === id) newSession();
      refreshSessions();
    },
    [sessionId, newSession, refreshSessions]
  );

  // ------------------------------------------------------------- stream

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming) return;
      setInput("");

      const userMsg: ChatMsg = { id: `u-${Date.now()}`, role: "user", content };
      const assistantMsg: ChatMsg = { id: `a-${Date.now()}`, role: "assistant", content: "", streaming: true };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreaming(true);
      setRoutes([]);
      setLive({ ...INITIAL_LIVE, phase: "prefill" });
      setSpark([]);
      pushLog(`POST /v1/chat/completions · model=${cfg.name}${prerouter ? " · prerouter=on" : " · prerouter=off"}`);

      const controller = new AbortController();
      abortRef.current = controller;
      const history = [...messages.filter((m) => m.content), { role: "user" as const, content }];

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, tier: tierId, prerouter, messages: history }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`engine returned ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let acc = "";
        let finalTelemetry: Telemetry | null = null;
        let sid = sessionId;
        let tokCount = 0;

        const handleLine = (line: string) => {
          if (!line) return;
          let ev: Record<string, unknown>;
          try {
            ev = JSON.parse(line);
          } catch {
            return;
          }
          switch (ev.type) {
            case "session":
              sid = ev.sessionId as string;
              setSessionId(sid);
              break;
            case "prefill": {
              const cold = ev.cold as boolean;
              const rate = ev.rate as number;
              const n = ev.promptTokens as number;
              pushLog(
                cold
                  ? `prefill ${n} tok · cold pass (page cache empty)…`
                  : `prefill ${n} tok @ ${rate} tok/s (warm) · kv-cache ready`
              );
              break;
            }
            case "token": {
              acc += ev.text as string;
              tokCount = (ev.i as number) + 1;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: acc } : m))
              );
              setLive((prev) => ({
                ...prev,
                phase: "decode",
                tps: ev.tps as number,
                ram: ev.ram as number,
                peak: Math.max(prev.peak, ev.ram as number),
                ssdMB: ev.ssdMB as number,
                ssdMbps: ev.ssdMbps as number,
                hit: ev.hit as number,
                acc: ev.acc as number,
                pool: ev.pool as number,
                miss: ev.miss as number,
                tok: tokCount,
              }));
              setSpark((prev) => [...prev.slice(-59), ev.ssdMbps as number]);
              if (tokCount % 16 === 0) {
                pushLog(
                  `decode tok ${tokCount} · ${(ev.tps as number).toFixed(1)} tok/s · ram ${(ev.ram as number).toFixed(2)} GiB · ssd ${(ev.ssdMbps as number).toFixed(0)} MB/s`
                );
              }
              break;
            }
            case "route": {
              const rows = ev.layers as LayerRoute[];
              setRoutes(rows);
              const totalMiss = rows.reduce((n, r) => n + r.m, 0);
              const totalHit = rows.reduce((n, r) => n + r.h, 0);
              pushLog(`step ${ev.tok} · L${rows[rows.length - 1]?.l} · pool hit ${totalHit}/${totalHit + totalMiss} · ssd bundles ${totalMiss}`);
              break;
            }
            case "done": {
              finalTelemetry = ev.telemetry as Telemetry;
              pushLog(
                `done · ${finalTelemetry?.tokens} tok · ${finalTelemetry?.tokPerSec} tok/s · peak ${finalTelemetry?.peakRamGiB} GiB · hit ${((finalTelemetry?.hitRate ?? 0) * 100).toFixed(0)}%`
              );
              break;
            }
            case "error": {
              toast({ title: "Engine error", description: String(ev.message), variant: "destructive" });
              pushLog(`error · ${String(ev.message)}`);
              break;
            }
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) handleLine(line);
        }
        if (buf) handleLine(buf);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: acc, streaming: false, telemetry: finalTelemetry }
              : m
          )
        );
        refreshSessions();
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, content: acc + (aborted ? " ⏹" : ""), streaming: false }
              : m
          )
        );
        if (!aborted) {
          toast({
            title: "Stream failed",
            description: err instanceof Error ? err.message : "unknown error",
            variant: "destructive",
          });
          pushLog("stream aborted · connection lost");
        } else {
          pushLog("generation stopped by user");
        }
        refreshSessions();
      } finally {
        setStreaming(false);
        setLive((prev) => ({ ...prev, phase: "idle" }));
        abortRef.current = null;
      }
    },
    [cfg.name, messages, prerouter, pushLog, refreshSessions, sessionId, streaming, tierId, toast]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const ramPct = Math.min(100, (live.peak / cfg.peakRamGiB) * 100);
  const poolPct = cfg.cacheSlots ? Math.min(100, (live.pool / cfg.cacheSlots) * 100) : 0;

  const phaseBadge = useMemo(() => {
    switch (live.phase) {
      case "prefill":
        return { label: "prefill", cls: "bg-amber-400/10 text-amber-300 border-amber-400/30" };
      case "decode":
        return { label: "decode", cls: "bg-emerald-400/10 text-emerald-300 border-emerald-400/30" };
      default:
        return { label: "idle", cls: "bg-zinc-800/60 text-zinc-400 border-zinc-700" };
    }
  }, [live.phase]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      {/* header row */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-mono text-lg font-semibold text-zinc-100">
            edge0 <span className="text-zinc-500">serve</span>
          </h2>
          <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[10.5px] ${phaseBadge.cls}`}>
            {streaming ? <Loader2 className="h-3 w-3 animate-spin" /> : <Radio className="h-3 w-3" />}
            {streaming ? live.phase : phaseBadge.label}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Select value={tierId} onValueChange={(v) => setTierId(v as TierId)} disabled={streaming}>
            <SelectTrigger className="h-9 w-[190px] border-zinc-700 bg-zinc-950/60 font-mono text-[12px] text-zinc-200">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-zinc-700 bg-zinc-900">
              {Object.values(TIERS).map((t) => (
                <SelectItem key={t.id} value={t.id} className="font-mono text-[12px]">
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex h-9 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950/60 px-3">
            <span className="font-mono text-[11px] text-zinc-400">prerouter</span>
            <Switch checked={prerouter} onCheckedChange={setPrerouter} disabled={streaming} />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 border-zinc-700 bg-zinc-950/60 text-zinc-300 hover:bg-zinc-800">
                <History className="mr-1.5 h-3.5 w-3.5" /> Sessions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72 border-zinc-700 bg-zinc-900">
              {sessions.length === 0 ? (
                <div className="px-3 py-4 text-center font-mono text-[11px] text-zinc-500">no sessions yet</div>
              ) : (
                sessions.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    className="group cursor-pointer items-center gap-2 px-3 py-2"
                    onClick={() => loadSession(s.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12.5px] text-zinc-200">{s.title}</div>
                      <div className="font-mono text-[10px] text-zinc-500">
                        {s.tier} · {s.messages} msgs · {formatTime(s.updatedAt)}
                      </div>
                    </div>
                    <button
                      aria-label={`Delete session ${s.title}`}
                      className="rounded p-1 text-zinc-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteSession(s.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            size="sm"
            onClick={newSession}
            disabled={streaming}
            className="h-9 border-zinc-700 bg-zinc-950/60 text-zinc-300 hover:bg-zinc-800"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> New
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* ---------------------------------------------------- chat ---- */}
        <Panel className="flex h-[calc(100vh-230px)] min-h-[540px] flex-col">
          <div ref={scrollRef} className="edge0-scroll flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/25 bg-amber-400/10">
                  <Cpu className="h-7 w-7 text-amber-300" />
                </div>
                <h3 className="font-mono text-base font-semibold text-zinc-200">engine idle</h3>
                <p className="mt-1.5 max-w-sm text-[13px] text-zinc-500">
                  Chatting streams tokens through a simulated {cfg.name} decode loop — live routing,
                  LRU pool and SSD telemetry on the right.
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-zinc-700/80 bg-zinc-900/50 px-3.5 py-1.5 text-[12px] text-zinc-300 transition-colors hover:border-amber-400/40 hover:text-amber-200"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map((m) => (
                  <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                    <div
                      className={
                        m.role === "user"
                          ? "max-w-[85%] rounded-2xl rounded-br-md border border-amber-400/25 bg-amber-400/10 px-4 py-2.5 text-[13.5px] leading-relaxed text-zinc-100"
                          : "w-full max-w-[92%] rounded-2xl rounded-bl-md border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-[13.5px] text-zinc-200"
                      }
                    >
                      {m.role === "assistant" ? (
                        <>
                          <div className="mb-1.5 flex items-center gap-2">
                            <TierBadge tier={cfg.name} />
                            <span className="font-mono text-[10px] text-zinc-600">assistant</span>
                          </div>
                          <div className="[&>*:last-child]:mb-0">
                            <ReactMarkdown components={mdComponents}>{m.content}</ReactMarkdown>
                          </div>
                          {m.streaming ? <span className="edge0-caret" /> : null}
                          {m.telemetry && !m.streaming ? <TelemetryChips t={m.telemetry} /> : null}
                        </>
                      ) : (
                        m.content
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* composer */}
          <div className="border-t border-zinc-800/70 p-3 sm:p-4">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder={`Message ${cfg.name}…`}
                rows={1}
                disabled={streaming}
                className="edge0-scroll max-h-36 min-h-[44px] flex-1 resize-none border-zinc-700 bg-zinc-950/70 text-[13.5px] text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-amber-400/40"
              />
              {streaming ? (
                <Button
                  onClick={stop}
                  size="icon"
                  className="h-11 w-11 shrink-0 border border-red-400/40 bg-red-400/10 text-red-300 hover:bg-red-400/20"
                  aria-label="Stop generation"
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={() => send(input)}
                  disabled={!input.trim()}
                  size="icon"
                  className="h-11 w-11 shrink-0 bg-amber-400 text-zinc-950 hover:bg-amber-300 disabled:opacity-40"
                  aria-label="Send message"
                >
                  <ArrowUp className="h-4.5 w-4.5" />
                </Button>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-zinc-600">
              <span>
                {cfg.name} · {cfg.quantBits}-bit · LRU {cfg.cacheSlots} slots · K={cfg.topK}
              </span>
              <span>enter to send · shift+enter newline</span>
            </div>
          </div>
        </Panel>

        {/* ----------------------------------------------- telemetry ---- */}
        <div className="edge0-scroll flex flex-col gap-4 lg:max-h-[calc(100vh-230px)] lg:overflow-y-auto lg:pr-1">
          {/* live stats */}
          <Panel className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
                <Activity className="h-3.5 w-3.5 text-amber-300" /> engine telemetry
              </h3>
              <span className="font-mono text-[10px] text-zinc-600">
                tok {live.tok} · pool {live.pool}/{cfg.cacheSlots}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="tok/s" value={live.tps ? live.tps.toFixed(1) : "—"} tone="amber" icon={<Zap className="h-3 w-3" />} />
              <Stat label="ssd i/o" value={live.ssdMbps ? `${live.ssdMbps.toFixed(0)}` : "—"} unit="MB/s" tone="amber" icon={<HardDrive className="h-3 w-3" />} />
              <Stat label="ssd total" value={live.ssdMB ? live.ssdMB.toFixed(0) : "—"} unit="MB" tone="zinc" icon={<HardDrive className="h-3 w-3" />} />
              <Stat label="lru hit" value={live.hit ? `${(live.hit * 100).toFixed(0)}%` : "—"} tone="emerald" />
              <Stat label="pred acc" value={live.acc ? `${(live.acc * 100).toFixed(0)}%` : prerouter ? "—" : "off"} tone="emerald" />
              <Stat label="stall miss" value={live.miss !== undefined ? String(live.miss) : "—"} tone="orange" />
            </div>
            {/* RAM gauge */}
            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between font-mono text-[10.5px]">
                <span className="flex items-center gap-1.5 text-zinc-400">
                  <MemoryStick className="h-3 w-3" /> peak allocator memory
                </span>
                <span className="text-zinc-300">
                  {live.peak ? live.peak.toFixed(2) : "0.00"} / {cfg.peakRamGiB} GiB
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300 transition-[width] duration-300"
                  style={{ width: `${ramPct}%` }}
                />
              </div>
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between font-mono text-[10.5px]">
                  <span className="text-zinc-500">expert pool occupancy</span>
                  <span className="text-zinc-400">{poolPct.toFixed(0)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-emerald-400/80 transition-[width] duration-300" style={{ width: `${poolPct}%` }} />
                </div>
              </div>
            </div>
          </Panel>

          {/* routing heatmap */}
          <Panel className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
                <Radio className="h-3.5 w-3.5 text-emerald-300" /> routing map
              </h3>
              <span className="font-mono text-[10px] text-zinc-600">{routes.length ? `tok ${live.tok}` : "waiting…"}</span>
            </div>
            <RoutingHeatmap routes={routes} tierId={tierId} />
          </Panel>

          {/* ssd sparkline */}
          <Panel className="p-4">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
                <HardDrive className="h-3.5 w-3.5 text-amber-300" /> ssd read throughput
              </h3>
              <span className="font-mono text-[10px] text-zinc-600">last {spark.length || 0} samples</span>
            </div>
            <Sparkline samples={spark} />
          </Panel>

          {/* engine log */}
          <Panel className="flex min-h-[180px] flex-col p-4">
            <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-zinc-200">
              <Activity className="h-3.5 w-3.5 text-zinc-400" /> engine log
            </h3>
            <div ref={logRef} className="edge0-scroll max-h-52 flex-1 overflow-y-auto rounded-md border border-zinc-800/70 bg-zinc-950/80 p-2.5 font-mono text-[10px] leading-relaxed text-zinc-500">
              {logs.length === 0 ? (
                <span className="text-zinc-700">{"// waiting for first request…"}</span>
              ) : (
                logs.map((l, i) => (
                  <div key={i} className={i === logs.length - 1 ? "text-zinc-300" : ""}>
                    {l}
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  tone,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  tone: "amber" | "emerald" | "zinc" | "orange";
  icon?: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    amber: "text-amber-300",
    emerald: "text-emerald-300",
    zinc: "text-zinc-200",
    orange: "text-orange-300",
  };
  return (
    <div className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-2.5 py-2">
      <div className="flex items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-zinc-600">
        {icon}
        {label}
      </div>
      <div className={`mt-1 font-mono text-[15px] font-semibold leading-none ${tones[tone]}`}>
        {value}
        {unit ? <span className="ml-0.5 text-[9px] font-normal text-zinc-500">{unit}</span> : null}
      </div>
    </div>
  );
}

function TelemetryChips({ t }: { t: Telemetry }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-zinc-800/70 pt-2.5">
      {typeof t.tokPerSec === "number" ? (
        <Chip>{t.tokPerSec.toFixed(1)} tok/s</Chip>
      ) : null}
      {typeof t.tokens === "number" ? <Chip>{t.tokens} tok</Chip> : null}
      {typeof t.peakRamGiB === "number" ? <Chip>peak {t.peakRamGiB.toFixed(2)} GiB</Chip> : null}
      {typeof t.ssdMB === "number" ? <Chip>ssd {t.ssdMB.toFixed(0)} MB</Chip> : null}
      {typeof t.hitRate === "number" ? <Chip>hit {(t.hitRate * 100).toFixed(0)}%</Chip> : null}
      {typeof t.prerouterAcc === "number" && t.prerouter ? (
        <Chip>pred {(t.prerouterAcc * 100).toFixed(0)}%</Chip>
      ) : null}
      {t.truncated ? <Chip tone="orange">partial</Chip> : null}
    </div>
  );
}

function Chip({ children, tone = "zinc" }: { children: React.ReactNode; tone?: "zinc" | "orange" }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[9.5px] ${
        tone === "orange"
          ? "border-orange-400/30 bg-orange-400/10 text-orange-300"
          : "border-zinc-700/70 bg-zinc-800/40 text-zinc-400"
      }`}
    >
      {children}
    </span>
  );
}
