"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Line,
  LineChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Gauge, HardDrive, Pause, Play, Wand2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TIERS, getTier, type TierId } from "@/lib/edge0/tiers";
import { Panel, SectionTitle } from "./shared";

// ------------------------------------------------------------------ model

const OVERHEAD: Record<TierId, number> = { "edge0-35b": 1.18, "edge0-8b": 1.12 };

function hitRateFor(cfg: { cacheSlots: number; experts: number }) {
  return Math.min(0.88, (cfg.cacheSlots / cfg.experts) * 0.65);
}

/** modeled decode tok/s — pipeline view of the memory wall */
function modelTps(cfg: (typeof TIERS)["edge0-35b"], bwGBs: number, prerouter: boolean) {
  const hit = hitRateFor(cfg);
  const missesPerStep = cfg.layers * cfg.topK * (1 - hit);
  const loadSec = (missesPerStep * cfg.bundleMB) / 1024 / bwGBs;
  const tCompute = (1 / cfg.computeTops) * OVERHEAD[cfg.id];
  if (prerouter) {
    // prediction lets loads overlap compute; only the small uncovered
    // fraction (prediction slips) stalls the step
    const stall = loadSec * 0.08;
    return 1 / (Math.max(tCompute, loadSec) + stall);
  }
  return 1 / (tCompute + loadSec);
}

// ------------------------------------------------------------------- view

const WORDS = [
  "the", "expert", "pool", "serves", "staged", "slots", "while", "prerouter",
  "predicts", "next", "token", "routing", "weights", "stream", "from", "ssd",
  "into", "resident", "memory", "decode", "overlaps", "loads", "with", "compute",
];

type Phase = "predict" | "stream" | "compute" | "emit";
const PHASES: { id: Phase; ms: number; label: string }[] = [
  { id: "predict", ms: 300, label: "prerouter · predict next set" },
  { id: "stream", ms: 420, label: "SSD → expert pool (LRU)" },
  { id: "compute", ms: 340, label: "staged slots → MoE forward" },
  { id: "emit", ms: 180, label: "sample → emit token" },
];

interface SlotState {
  id: number;
  fresh: boolean;
}

export function Pipeline() {
  const [tierId, setTierId] = useState<TierId>("edge0-35b");
  const [prerouter, setPrerouter] = useState(true);
  const [bw, setBw] = useState(1.2);
  const [running, setRunning] = useState(true);

  const cfg = TIERS[tierId];

  const [phaseIdx, setPhaseIdx] = useState(0);
  const [layer, setLayer] = useState(0);
  const [step, setStep] = useState(0);
  const [poolSlots, setPoolSlots] = useState<SlotState[]>(() =>
    Array.from({ length: 16 }, (_, i) => ({ id: (i * 17) % 256, fresh: false }))
  );
  const [staged, setStaged] = useState<(number | null)[]>(Array(8).fill(null));
  const [tokens, setTokens] = useState<string[]>([]);
  const [mbRead, setMbRead] = useState(0);
  const [hits, setHits] = useState(0);
  const [lookups, setLookups] = useState(0);

  const wordIdx = useRef(0);
  const expertSeq = useRef(1);

  const tps = useMemo(
    () => modelTps(cfg, bw, prerouter) * (0.97 + ((step * 7919) % 53) / 53 * 0.06),
    [cfg, bw, prerouter, step]
  );
  const hitRate = Math.min(0.92, hitRateFor(cfg) * (0.85 + Math.min(0.15, step / 120)));

  const chartData = useMemo(() => {
    const pts: { bw: number; on: number; off: number }[] = [];
    for (let b = 0.2; b <= 3.21; b += 0.15) {
      pts.push({
        bw: +b.toFixed(2),
        on: +modelTps(cfg, b, true).toFixed(1),
        off: +modelTps(cfg, b, false).toFixed(1),
      });
    }
    return pts;
  }, [cfg]);

  // ------------------------------------------------------ animation loop
  useEffect(() => {
    if (!running) return;
    const phase = PHASES[phaseIdx];
    const timer = setTimeout(() => {
      const next = (phaseIdx + 1) % PHASES.length;
      if (phase.id === "predict") {
        // prerouter fills the staged slots with the predicted set
        const K = Math.min(8, cfg.topK + 2);
        const nextStaged = Array.from({ length: 8 }, (_, i) =>
          i < K ? expertSeq.current++ : null
        );
        setStaged(nextStaged);
        setLookups((n) => n + cfg.topK);
      }
      if (phase.id === "stream") {
        // pull the missing bundles from SSD into the shared LRU pool
        const missCount = 2 + Math.floor(Math.random() * 3);
        setPoolSlots((prev) => {
          const arr = [...prev];
          const idxs = new Set<number>();
          while (idxs.size < missCount) idxs.add(Math.floor(Math.random() * arr.length));
          for (const i of idxs) arr[i] = { id: expertSeq.current++, fresh: true };
          return arr.map((s, i) => (idxs.has(i) ? s : { ...s, fresh: false }));
        });
        setMbRead((m) => m + missCount * cfg.bundleMB);
        setHits((h) => h + cfg.topK - missCount);
      }
      if (phase.id === "compute") {
        setStaged((prev) => prev.map((v) => (v !== null ? -v : v)) as (number | null)[]);
        setLayer((l) => (l + 1) % cfg.layers);
      }
      if (phase.id === "emit") {
        const tok = WORDS[wordIdx.current % WORDS.length];
        wordIdx.current++;
        setTokens((prev) => [...prev.slice(-13), tok]);
        setStaged(Array(8).fill(null));
        setStep((s) => s + 1);
      }
      setPhaseIdx(next);
    }, phase.ms);
    return () => clearTimeout(timer);
  }, [phaseIdx, running, cfg]);

  const phase = PHASES[phaseIdx];
  const poolFresh = poolSlots.filter((s) => s.fresh).length;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6">
      <SectionTitle
        kicker="Pipeline"
        title="Inside one decode step"
        sub="A stylized walk through the memory wall: the prerouter predicts the next expert set while the current token still computes, SSD bundles stream into the shared LRU pool, staged slots go live, and a token comes out. Metrics are modeled from the technical report."
      />

      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        {/* ------------------------------------------------ animation ---- */}
        <Panel className="flex flex-col p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-500">
              <span
                className={`edge0-pulse-dot inline-block h-1.5 w-1.5 rounded-full ${running ? "bg-emerald-400" : "bg-zinc-600"}`}
              />
              {running ? phase.label : "paused"}
            </div>
            <button
              onClick={() => setRunning((r) => !r)}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800"
            >
              {running ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
              {running ? "pause" : "run"}
            </button>
          </div>

          {/* stages */}
          <div className="grid grid-cols-[auto_1fr_auto] items-stretch gap-2 sm:gap-3">
            {/* SSD column */}
            <div className="flex w-24 flex-col rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5 sm:w-28">
              <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                <HardDrive className="h-3 w-3" /> SSD
              </div>
              <div className="flex flex-1 flex-col justify-center gap-1.5">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={`h-4 rounded-sm border ${
                      phase.id === "stream" && i < 2
                        ? "border-amber-400/60 bg-amber-400/20"
                        : "border-zinc-800 bg-zinc-900/60"
                    }`}
                  >
                    <div className="h-full w-full rounded-sm bg-[repeating-linear-gradient(90deg,transparent_0_6px,rgba(251,191,36,0.14)_6px_8px)]" />
                  </div>
                ))}
              </div>
              <div className="mt-2 font-mono text-[9.5px] text-zinc-600">{cfg.diskGB} GB · 4-bit</div>
            </div>

            {/* stream lane + pool */}
            <div className="flex flex-col gap-2">
              {/* flying particles */}
              <div className="relative h-7 overflow-hidden rounded-md border border-zinc-800/70 bg-zinc-950/50">
                {phase.id === "stream" && running
                  ? [0, 1, 2].map((i) => (
                      <span
                        key={`${step}-${i}`}
                        className="edge0-fly absolute top-1/2 h-1.5 w-6 -translate-y-1/2 rounded-full bg-amber-400/90"
                        style={{
                          left: "6%",
                          ["--fly-dx" as string]: "1200%",
                          ["--fly-dur" as string]: `${0.42 + i * 0.1}s`,
                          animationDelay: `${i * 0.12}s`,
                        }}
                      />
                    ))
                  : null}
                <span className="absolute inset-0 flex items-center justify-center font-mono text-[9.5px] text-zinc-600">
                  expert bundles · {cfg.bundleMB} MB each · PCIe / USB4
                </span>
              </div>
              {/* shared LRU pool */}
              <div className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  <span>shared expert pool · LRU</span>
                  <span className="text-zinc-600">
                    {cfg.cacheSlots} slots · hit {(hitRate * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="grid grid-cols-8 gap-1.5">
                  {poolSlots.map((s, i) => (
                    <div
                      key={i}
                      className={`flex h-7 items-center justify-center rounded border font-mono text-[9px] transition-colors duration-300 ${
                        s.fresh
                          ? "border-amber-400/70 bg-amber-400/15 text-amber-300"
                          : "border-zinc-800 bg-zinc-900/60 text-zinc-600"
                      }`}
                    >
                      e{s.id}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* staged + emit column */}
            <div className="flex w-28 flex-col gap-2 sm:w-32">
              <div className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                <div className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  <Wand2 className={`h-3 w-3 ${prerouter ? "text-emerald-400" : "text-zinc-600"}`} /> staged
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {staged.map((v, i) => (
                    <div
                      key={i}
                      className={`flex h-5.5 items-center justify-center rounded border py-1 font-mono text-[8.5px] transition-colors duration-200 ${
                        v === null
                          ? "border-zinc-800 bg-zinc-900/40 text-zinc-700"
                          : v > 0
                            ? "border-emerald-400/60 bg-emerald-400/15 text-emerald-300"
                            : "border-amber-400/70 bg-amber-400/20 text-amber-300"
                      }`}
                    >
                      {v === null ? "·" : `e${Math.abs(v)}`}
                    </div>
                  ))}
                </div>
                <div className="mt-2 font-mono text-[9.5px] leading-tight text-zinc-600">
                  {prerouter ? (
                    <span className="text-emerald-400/80">staged_replace · zero drop</span>
                  ) : (
                    <span>serial route → load</span>
                  )}
                </div>
              </div>
              {/* token ticker */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2.5">
                <div className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  tokens out
                </div>
                <div className="flex h-9 flex-wrap content-start gap-x-1 gap-y-0.5 overflow-hidden font-mono text-[10.5px] leading-tight text-zinc-300">
                  {tokens.slice(-10).map((t, i) => (
                    <span key={`${step}-${i}`} className={i === tokens.slice(-10).length - 1 ? "text-amber-300" : ""}>
                      {t}
                    </span>
                  ))}
                  {running ? <span className="edge0-caret !h-3 !w-[5px]" /> : null}
                </div>
              </div>
            </div>
          </div>

          {/* step counters */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { k: "step", v: step, tone: "text-zinc-200" },
              { k: "layer", v: `${layer + 1}/${cfg.layers}`, tone: "text-zinc-200" },
              { k: "decode", v: `${tps.toFixed(1)} tok/s`, tone: "text-amber-300" },
              { k: "ssd read", v: `${mbRead.toFixed(0)} MB`, tone: "text-zinc-200" },
            ].map((s) => (
              <div key={s.k} className="rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2">
                <div className="font-mono text-[9.5px] uppercase tracking-wider text-zinc-600">{s.k}</div>
                <div className={`mt-0.5 font-mono text-sm font-semibold ${s.tone}`}>{s.v}</div>
              </div>
            ))}
          </div>
        </Panel>

        {/* -------------------------------------------------- controls ---- */}
        <div className="flex flex-col gap-6">
          <Panel className="p-5">
            <h3 className="mb-4 text-sm font-semibold text-zinc-200">Experiment</h3>
            <div className="space-y-5">
              <div>
                <div className="mb-1.5 font-mono text-[11px] uppercase tracking-wider text-zinc-500">tier</div>
                <Select value={tierId} onValueChange={(v) => { setTierId(v as TierId); setStep(0); setMbRead(0); setHits(0); }}>
                  <SelectTrigger className="border-zinc-700 bg-zinc-950/60 font-mono text-[13px] text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-700 bg-zinc-900">
                    {Object.values(TIERS).map((t) => (
                      <SelectItem key={t.id} value={t.id} className="font-mono text-[13px]">
                        {t.name} · {t.experts} experts · K={t.topK}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-medium text-zinc-200">Prerouter</div>
                  <div className="font-mono text-[10.5px] text-zinc-500">
                    {prerouter ? "predict one step ahead · overlap loads" : "wait for routing, then load"}
                  </div>
                </div>
                <Switch checked={prerouter} onCheckedChange={setPrerouter} />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">storage bandwidth</span>
                  <span className="font-mono text-[11px] text-amber-300">{bw.toFixed(1)} GB/s</span>
                </div>
                <Slider value={[bw]} min={0.2} max={3.2} step={0.1} onValueChange={([v]) => setBw(v)} />
                <div className="mt-1 flex justify-between font-mono text-[9.5px] text-zinc-600">
                  <span>slow external SSD</span>
                  <span>fast internal NVMe</span>
                </div>
              </div>
            </div>
          </Panel>

          <Panel className="p-5">
            <div className="mb-1 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <Gauge className="h-4 w-4 text-amber-300" /> Decode throughput vs storage
              </h3>
              <span className="font-mono text-[10.5px] text-zinc-600">modeled</span>
            </div>
            <p className="mb-3 text-xs text-zinc-500">
              The prerouter&apos;s edge grows as storage slows — then both curves collapse onto the
              same bandwidth ceiling.
            </p>
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="#27272a" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="bw"
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    axisLine={{ stroke: "#3f3f46" }}
                    tickLine={false}
                    tickFormatter={(v) => v.toFixed(1)}
                  />
                  <YAxis tick={{ fill: "#71717a", fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#18181b",
                      border: "1px solid #3f3f46",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    labelFormatter={(v) => `${Number(v).toFixed(2)} GB/s`}
                    formatter={(value: number, name) => [`${value} tok/s`, name === "on" ? "prerouter on" : "prerouter off"]}
                  />
                  <Line type="monotone" dataKey="on" stroke="#fbbf24" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="off" stroke="#71717a" strokeWidth={1.6} strokeDasharray="5 4" dot={false} />
                  <ReferenceDot x={+bw.toFixed(2)} y={+modelTps(cfg, bw, prerouter).toFixed(1)} r={4} fill="#fbbf24" stroke="#0a0a0c" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex items-center gap-4 font-mono text-[10.5px] text-zinc-500">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-amber-400" /> prerouter on</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t border-dashed border-zinc-500" /> prerouter off</span>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
