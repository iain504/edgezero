"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Gauge, HardDrive, Info, MemoryStick, Timer } from "lucide-react";
import { BENCH_NOTE, QUALITY, TEST_MACHINE, TIERS, type TierId } from "@/lib/edge0/tiers";
import { Panel, SectionTitle } from "./shared";

const tooltipStyle = {
  backgroundColor: "#18181b",
  border: "1px solid #3f3f46",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#e4e4e7",
};

export function Benchmarks() {
  const tiers: TierId[] = ["edge0-35b", "edge0-8b"];

  const speedData = tiers.map((id) => {
    const t = TIERS[id];
    return {
      tier: t.name,
      decodeMin: t.decodeRange[0],
      decodeMax: t.decodeRange[1],
      prefillCold: t.prefillCold,
      prefillWarm: t.prefillWarm,
      peakRam: t.peakRamGiB,
      disk: t.diskGB,
    };
  });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6">
      <SectionTitle
        kicker="Benchmarks"
        title="The numbers behind the memory wall"
        sub={`All measurements by the Edge0 team with OpenCompass and python/examples/bench.py on a ${TEST_MACHINE}. Quality compares edge0 (int4 + trained adapters + prerouter) against the original fp16 base models; max 100.`}
      />

      {/* -------------------------------------------------- quality ---- */}
      <Panel className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-200">Quality — edge0 int4 vs fp16 base</h3>
          <span className="font-mono text-[11px] text-zinc-600">higher is better</span>
        </div>
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={QUALITY} margin={{ top: 4, right: 8, left: -18, bottom: 0 }} barGap={3}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="bench" tick={{ fill: "#a1a1aa", fontSize: 11 }} axisLine={{ stroke: "#3f3f46" }} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(251,191,36,0.06)" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="e35" name="edge0-35b (int4)" fill="#fbbf24" radius={[3, 3, 0, 0]} maxBarSize={26} />
              <Bar dataKey="b35" name="Qwen3.6-35B-A3B (fp16)" fill="#52525b" radius={[3, 3, 0, 0]} maxBarSize={26} />
              <Bar dataKey="e8" name="edge0-8b (int4)" fill="#34d399" radius={[3, 3, 0, 0]} maxBarSize={26} />
              <Bar dataKey="b8" name="Ling 3.0 tiny (fp16)" fill="#3f3f46" radius={[3, 3, 0, 0]} maxBarSize={26} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="edge0-scroll mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left font-mono text-[12.5px]">
            <thead>
              <tr className="border-b border-zinc-800 text-[10.5px] uppercase tracking-wider text-zinc-500">
                <th className="py-2 pr-4 font-normal">Benchmark</th>
                <th className="px-3 py-2 text-right font-normal text-amber-300/90">edge0-35b</th>
                <th className="px-3 py-2 text-right font-normal">Qwen3.6 fp16</th>
                <th className="px-3 py-2 text-right font-normal text-emerald-300/90">edge0-8b</th>
                <th className="px-3 py-2 text-right font-normal">Ling fp16</th>
              </tr>
            </thead>
            <tbody>
              {QUALITY.map((r) => (
                <tr key={r.bench} className={`border-b border-zinc-800/50 last:border-0 ${r.bench === "Average" ? "bg-zinc-800/30" : ""}`}>
                  <td className="py-2 pr-4 text-zinc-300">{r.bench}</td>
                  <td className="px-3 py-2 text-right text-amber-200">{r.e35.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right text-zinc-500">{r.b35.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right text-emerald-200">{r.e8.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right text-zinc-500">{r.b8.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ------------------------------------------ speed + memory ---- */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel className="p-5">
          <div className="mb-1 flex items-center gap-2">
            <Timer className="h-4 w-4 text-amber-300" />
            <h3 className="text-sm font-semibold text-zinc-200">Throughput on {TEST_MACHINE.split(",")[0]}</h3>
          </div>
          <p className="mb-4 text-xs text-zinc-500">Decode range (prerouter on) vs prefill throughput, tok/s.</p>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={speedData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }} barGap={4}>
                <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="tier" tick={{ fill: "#a1a1aa", fontSize: 11, fontFamily: "monospace" }} axisLine={{ stroke: "#3f3f46" }} tickLine={false} />
                <YAxis tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(251,191,36,0.06)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="decodeMin" name="decode min" fill="#b45309" radius={[3, 3, 0, 0]} maxBarSize={30} />
                <Bar dataKey="decodeMax" name="decode max" fill="#fbbf24" radius={[3, 3, 0, 0]} maxBarSize={30} />
                <Bar dataKey="prefillCold" name="prefill cold" fill="#065f46" radius={[3, 3, 0, 0]} maxBarSize={30} />
                <Bar dataKey="prefillWarm" name="prefill warm" fill="#34d399" radius={[3, 3, 0, 0]} maxBarSize={30} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
            Cold prefill faults expert weights in from SSD; warm prefill rides the page cache —
            note the 8B tier jumping 500 → 1428 tok/s.
          </p>
        </Panel>

        <Panel className="p-5">
          <div className="mb-1 flex items-center gap-2">
            <MemoryStick className="h-4 w-4 text-emerald-300" />
            <h3 className="text-sm font-semibold text-zinc-200">Memory — disk vs peak RAM</h3>
          </div>
          <p className="mb-4 text-xs text-zinc-500">The whole point: resident memory is decoupled from parameter count.</p>
          <div className="space-y-5 py-2">
            {tiers.map((id) => {
              const t = TIERS[id];
              const pct = Math.round((t.peakRamGiB / t.diskGB) * 100);
              return (
                <div key={id}>
                  <div className="mb-1.5 flex items-center justify-between font-mono text-xs">
                    <span className="text-zinc-300">{t.name}</span>
                    <span className="text-zinc-500">
                      {t.peakRamGiB} GiB peak / {t.diskGB} GB checkpoint ={" "}
                      <span className="text-amber-300">{pct}%</span>
                    </span>
                  </div>
                  <div className="relative h-7 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950">
                    <div className="absolute inset-y-0 left-0 w-full bg-zinc-800/40" />
                    <div
                      className={`absolute inset-y-0 left-0 ${id === "edge0-35b" ? "bg-amber-400/80" : "bg-emerald-400/80"}`}
                      style={{ width: `${Math.max(6, pct)}%` }}
                    />
                    <div className="absolute inset-y-0 left-3 flex items-center font-mono text-[11px] font-semibold text-zinc-100">
                      {t.peakRamGiB} GiB resident
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Peak is <span className="font-mono text-zinc-400">mlx.core.get_peak_memory()</span> after decode —
              file-backed expert pages, tokenizer and interpreter add reclaimable RSS on top. The same 35B build
              runs on a 16 GB M2.
            </p>
          </div>
        </Panel>
      </div>

      {/* --------------------------------------------------- method ---- */}
      <Panel className="mt-6 p-5">
        <div className="flex items-start gap-3">
          <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <div>
            <h3 className="text-sm font-semibold text-zinc-200">Methodology</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{BENCH_NOTE}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {["prefill: full-layer path", "decode: staged + prerouter", "quality: OpenCompass", "3.3k-token prompt"].map((c) => (
                <span key={c} className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 font-mono text-[10.5px] text-zinc-400">
                  {c}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {tiers.map((id) => {
            const t = TIERS[id];
            return (
              <div key={id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/50 px-4 py-3">
                <HardDrive className="h-4 w-4 shrink-0 text-zinc-500" />
                <div className="min-w-0 font-mono text-[11.5px] text-zinc-400">
                  <span className="text-zinc-200">{t.name}</span> · {t.checkpoint} · {t.quantBits}-bit affine g64
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
