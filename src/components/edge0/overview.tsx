"use client";

import Image from "next/image";
import {
  ArrowRight,
  ArrowUpRight,
  Battery,
  Cpu,
  Database,
  Download,
  FileText,
  Github,
  HardDrive,
  Layers,
  Play,
  Sparkles,
  Terminal,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  HF_35B,
  HF_8B,
  NEWS,
  PAPER_URL,
  PLATFORMS,
  QUALITY,
  REPO_URL,
  ROADMAP,
  TIERS,
  type TierId,
} from "@/lib/edge0/tiers";
import { CodeBlock, Panel, SectionTitle } from "./shared";

const MECHANISMS = [
  {
    icon: HardDrive,
    title: "SSD expert offload",
    tag: "streaming/",
    body: "Expert weights stay on storage and are mmapped in byte-range on demand. Peak memory is bounded by the active expert set — not the 35B parameter count. A cross-layer LRU (SharedExpertCache) + hot-set pinning turns tens of MB per step into almost nothing.",
    points: ["~310 MB MoE weights per layer @ 4-bit", "staged double buffering for decode", "full-layer path for fast prefill"],
  },
  {
    icon: Zap,
    title: "Prerouter",
    tag: "prerouter/",
    body: "A trained per-layer head predicts the next token's expert routing one step ahead (double shift: prev-layer + prev-token), so expert loads overlap the forward pass instead of stalling it — up to +59% decode throughput.",
    points: ["fc1 → erf-gelu → fc2 heads @ 512 fp16", "staged_replace: zero drop by construction", "pin_bonus keeps soon-needed experts resident"],
  },
  {
    icon: Sparkles,
    title: "Recover-LoRA",
    tag: "adapters/",
    body: "The int4 base stays frozen and read-only; LoRA adapters distilled from the FP teacher recover most of the quantization loss — 3.9 pts average gap for 35B, 2.8 for 8B. One base serves many adapter sets, unmerged.",
    points: ["safetensors adapters with provenance", "model + adapters in one directory", "MMLU-Pro lands above the fp16 base on 8B"],
  },
];

const EXEC_PATHS = [
  { name: "full-layer", role: "prefill workhorse", detail: "whole-layer load, gather-sort + scatter-unsort" },
  { name: "staged", role: "decode workhorse", detail: "fixed-slot double buffers, zero host sync per layer" },
  { name: "hot", role: "LRU-resident top-N", detail: "decayed counts pin the hottest experts per layer" },
  { name: "exact", role: "correctness baseline", detail: "on-demand bundle gather, always bit-exact" },
];

export function Overview({ onNavigate }: { onNavigate: (v: "playground" | "pipeline" | "benchmarks") => void }) {
  const tiers: TierId[] = ["edge0-35b", "edge0-8b"];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      {/* ------------------------------------------------ hero ---- */}
      <section className="grid items-center gap-8 pb-14 pt-10 lg:grid-cols-[1.05fr_1fr] lg:pt-16">
        <div>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-300 hover:bg-amber-400/15">
              open-source · Apache-2.0
            </Badge>
            <Badge variant="outline" className="border-zinc-700 text-zinc-400">
              macOS · iOS · Android · Windows · Python
            </Badge>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-zinc-50 sm:text-5xl lg:text-6xl">
            Run 35B MoE models
            <br />
            in <span className="font-mono text-amber-400">~2.5 GB</span> of RAM
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-zinc-400">
            <span className="font-mono text-zinc-200">edge0</span> is an open-source streaming MoE
            inference framework. Weights stream from SSD while a trained router predicts loads a
            step ahead — the production-proven recipe of{" "}
            <span className="text-zinc-200">SSD expert offload + Recover-LoRA + prerouter</span>,
            generalized into one framework for every device.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={() => onNavigate("playground")}
              className="edge0-glow-amber bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300"
            >
              <Play className="mr-1.5 h-4 w-4" /> Launch the engine
            </Button>
            <Button
              size="lg"
              variant="outline"
              onClick={() => onNavigate("pipeline")}
              className="border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:bg-zinc-800 hover:text-zinc-100"
            >
              See the pipeline <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-1.5 rounded-md px-3 font-mono text-xs text-zinc-500 transition-colors hover:text-zinc-200"
            >
              <Github className="h-4 w-4" /> Edge0-AI/Edge0 <ArrowUpRight className="h-3 w-3" />
            </a>
          </div>
          <dl className="mt-9 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { k: "2.9 GiB", v: "peak RAM · 35B" },
              { k: "+59%", v: "decode w/ prerouter" },
              { k: "4-bit", v: "+ Recover-LoRA" },
              { k: "5", v: "platform engines" },
            ].map((s) => (
              <div key={s.k} className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2.5">
                <dt className="font-mono text-lg font-semibold text-amber-300">{s.k}</dt>
                <dd className="mt-0.5 text-[11px] leading-tight text-zinc-500">{s.v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <Panel className="relative overflow-hidden p-2">
          <div className="relative aspect-[2/1] w-full overflow-hidden rounded-lg">
            <Image
              src="/edge0-hero.png"
              alt="Expert weights streaming from SSD storage into an active memory grid"
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-zinc-950/70 via-transparent to-transparent" />
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between font-mono text-[10px] text-zinc-400">
              <span>weights: SSD → active set, on demand</span>
              <span className="text-amber-400/90">expert pool · LRU</span>
            </div>
          </div>
        </Panel>
      </section>

      {/* ------------------------------------------ mechanisms ---- */}
      <section className="border-t border-zinc-800/60 py-14">
        <SectionTitle
          kicker="Core mechanisms"
          title="One recipe, three moving parts"
          sub="Every edge0 tier ships as one unit: the checkpoint, the trained LoRA adapters and the trained prerouter heads — resolved automatically from the model directory."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {MECHANISMS.map((m) => (
            <Panel key={m.title} className="flex flex-col p-5 transition-colors hover:border-zinc-600">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-400/25 bg-amber-400/10">
                  <m.icon className="h-5 w-5 text-amber-300" />
                </div>
                <span className="font-mono text-[11px] text-zinc-600">{m.tag}</span>
              </div>
              <h3 className="text-base font-semibold text-zinc-100">{m.title}</h3>
              <p className="mt-2 flex-1 text-[13px] leading-relaxed text-zinc-400">{m.body}</p>
              <ul className="mt-4 space-y-1.5">
                {m.points.map((p) => (
                  <li key={p} className="flex items-start gap-2 font-mono text-[11px] text-zinc-500">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400/70" />
                    {p}
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </div>
      </section>

      {/* --------------------------------------- execution paths ---- */}
      <section className="border-t border-zinc-800/60 py-14">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <SectionTitle
              kicker="streaming/layer.py"
              title="Four execution paths, one layer state machine"
              sub="StreamingSwitchGLU picks the fastest path that is correct for the moment: prefill loads whole layers, decode lives in staged double buffers, hot experts stay pinned in the LRU, and exact is always the fallback."
            />
            <div className="space-y-2.5">
              {EXEC_PATHS.map((p, i) => (
                <div key={p.name} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                  <span className="font-mono text-xs text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-sm font-semibold text-amber-300">{p.name}</span>
                      <span className="text-[11px] text-zinc-500">{p.role}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-zinc-500">{p.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <CodeBlock
              title="terminal — serve like the README"
              code={`# resolve the tier from the checkpoint's config.json
$ edge0 serve models/edge0-35b

# OpenAI-compatible endpoint on :8000
$ curl http://127.0.0.1:8000/v1/chat/completions \\
    -H 'Content-Type: application/json' \\
    -d '{"model":"edge0-35b",
         "messages":[{"role":"user","content":"Hello!"}],
         "max_tokens":32}'`}
            />
            <CodeBlock
              title="python — transformers-style usage"
              code={`from edge0 import AutoEngine

engine = AutoEngine.from_pretrained("models/edge0-35b")
# tier auto-detected · LoRA + prerouter load automatically
engine.close()   # release mmaps / expert cache`}
            />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- models ---- */}
      <section className="border-t border-zinc-800/60 py-14">
        <SectionTitle
          kicker="Model tiers"
          title="Two end-to-end releases"
          sub="Each tier bundles the released checkpoint, trained LoRA adapters and trained prerouter heads as one runnable unit — 4-bit affine, group size 64."
        />
        <div className="grid gap-4 md:grid-cols-2">
          {tiers.map((id) => {
            const t = TIERS[id];
            const hf = id === "edge0-35b" ? HF_35B : HF_8B;
            return (
              <Panel key={id} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-mono text-lg font-semibold text-zinc-100">{t.name}</h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      {t.params} · built on {t.baseFamily}
                    </p>
                  </div>
                  <a
                    href={hf}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2.5 py-1 font-mono text-[11px] text-zinc-300 transition-colors hover:border-amber-400/40 hover:text-amber-300"
                  >
                    <Download className="h-3 w-3" /> Hugging Face
                  </a>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { k: "layers", v: t.layers },
                    { k: "experts", v: t.experts },
                    { k: "top-k", v: `K=${t.topK}` },
                    { k: "quant", v: `${t.quantBits}-bit` },
                    { k: "disk", v: `~${t.diskGB} GB` },
                    { k: "peak RAM", v: `${t.peakRamGiB} GiB` },
                    { k: "decode", v: `${t.decodeRange[0]}–${t.decodeRange[1]} tok/s` },
                    { k: "router", v: t.routerKind },
                  ].map((s) => (
                    <div key={s.k} className="rounded-md border border-zinc-800/80 bg-zinc-950/50 px-2.5 py-2">
                      <div className="font-mono text-[9.5px] uppercase tracking-wider text-zinc-600">{s.k}</div>
                      <div className="mt-0.5 font-mono text-[12.5px] font-medium text-zinc-200">{s.v}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            );
          })}
        </div>
      </section>

      {/* ---------------------------------------------- quality mini ---- */}
      <section className="border-t border-zinc-800/60 py-14">
        <div className="grid gap-8 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <SectionTitle
              kicker="Quality"
              title="The 4-bit loss is small"
              sub="OpenCompass, identical settings for edge0 (int4 + adapters + prerouter) and the fp16 base models. Max 100 — the average gap is 3.9 points for 35B, 2.8 for 8B."
            />
            <Button
              variant="outline"
              onClick={() => onNavigate("benchmarks")}
              className="border-zinc-700 bg-zinc-900/60 text-zinc-200 hover:bg-zinc-800"
            >
              <FileText className="mr-1.5 h-4 w-4" /> Full benchmark dashboard
            </Button>
          </div>
          <Panel className="overflow-hidden">
            <table className="w-full text-left font-mono text-[12.5px]">
              <thead>
                <tr className="border-b border-zinc-800 text-[10.5px] uppercase tracking-wider text-zinc-500">
                  <th className="px-4 py-2.5 font-normal">Benchmark</th>
                  <th className="px-3 py-2.5 text-right font-normal text-amber-300/90">35B int4</th>
                  <th className="px-3 py-2.5 text-right font-normal">35B fp16</th>
                  <th className="px-3 py-2.5 text-right font-normal text-emerald-300/90">8B int4</th>
                  <th className="px-4 py-2.5 text-right font-normal">8B fp16</th>
                </tr>
              </thead>
              <tbody>
                {QUALITY.map((r) => (
                  <tr key={r.bench} className="border-b border-zinc-800/50 last:border-0">
                    <td className="px-4 py-2 text-zinc-300">{r.bench}</td>
                    <td className="px-3 py-2 text-right text-amber-200">{r.e35.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right text-zinc-500">{r.b35.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right text-emerald-200">{r.e8.toFixed(1)}</td>
                    <td className="px-4 py-2 text-right text-zinc-500">{r.b8.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      </section>

      {/* ---------------------------------------------- platforms ---- */}
      <section className="border-t border-zinc-800/60 py-14">
        <SectionTitle
          kicker="Platforms"
          title="One repo, one recipe, per-platform runtimes"
          sub="All four platform engines are open-sourced in-repo; the unified inference framework lands Q4 2026."
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {PLATFORMS.map((p) => (
            <Panel key={p.name} className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-100">{p.name}</span>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${p.status === "available" ? "bg-emerald-400" : "bg-amber-400"}`}
                />
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-zinc-400">{p.stack}</div>
              <div className="mt-0.5 font-mono text-[11px] text-zinc-600">{p.target}</div>
              <div className="mt-3 font-mono text-[10.5px] text-zinc-600">
                {p.dir} ·{" "}
                <span className={p.status === "available" ? "text-emerald-400/80" : "text-amber-400/80"}>
                  {p.status === "available" ? "available now" : "open-sourced"}
                </span>
              </div>
            </Panel>
          ))}
        </div>
      </section>

      {/* ------------------------------------------ roadmap + news ---- */}
      <section className="border-t border-zinc-800/60 py-14">
        <div className="grid gap-10 lg:grid-cols-[1.25fr_1fr]">
          <div>
            <SectionTitle kicker="Roadmap · Q4 2026" title="What's next" />
            <ol className="relative space-y-5 border-l border-zinc-800 pl-6">
              {ROADMAP.map((r, i) => (
                <li key={r.title} className="relative">
                  <span className="absolute -left-[30.5px] top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-amber-400/50 bg-zinc-950">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  </span>
                  <h4 className="text-sm font-semibold text-zinc-100">
                    <span className="mr-2 font-mono text-xs text-zinc-600">{String(i + 1).padStart(2, "0")}</span>
                    {r.title}
                  </h4>
                  <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">{r.detail}</p>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <SectionTitle kicker="News" title="Release timeline" />
            <div className="space-y-3">
              {NEWS.map((n) => (
                <Panel key={n.date} className="flex items-start gap-3 p-4">
                  <span className="mt-0.5 font-mono text-[11px] text-amber-400/80">{n.date}</span>
                  <span className="text-[13px] leading-relaxed text-zinc-300">{n.text}</span>
                </Panel>
              ))}
              <a
                href={PAPER_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3 transition-colors hover:border-amber-400/30"
              >
                <span className="flex items-center gap-2.5 text-[13px] text-zinc-200">
                  <FileText className="h-4 w-4 text-amber-300" />
                  The Other Half of the Memory Wall — arXiv 2609.18063
                </span>
                <ArrowUpRight className="h-3.5 w-3.5 text-zinc-500" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- try band ---- */}
      <section className="border-t border-zinc-800/60 pt-14">
        <Panel className="edge0-glow-amber relative overflow-hidden p-6 sm:p-8">
          <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-amber-400/90">
                <Terminal className="h-3.5 w-3.5" /> simulated workbench
              </div>
              <h3 className="mt-2 text-xl font-semibold text-zinc-100">
                Drive the virtual engine — telemetry, routing maps and all.
              </h3>
              <p className="mt-1.5 max-w-xl text-sm text-zinc-400">
                The Playground streams tokens through a simulated edge0 decode loop: LRU expert pool,
                staged slots, prerouter predictions and SSD I/O — with the real mechanics modeled from
                the paper. No 23 GB download required.
              </p>
            </div>
            <div className="flex shrink-0 gap-3">
              <Button
                size="lg"
                onClick={() => onNavigate("playground")}
                className="bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300"
              >
                <Play className="mr-1.5 h-4 w-4" /> Playground
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => onNavigate("benchmarks")}
                className="border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800"
              >
                <Battery className="mr-1.5 h-4 w-4" /> Benchmarks
              </Button>
            </div>
          </div>
          <Cpu className="pointer-events-none absolute -right-8 -top-8 h-44 w-44 text-amber-400/5" />
          <Database className="pointer-events-none absolute -bottom-10 right-32 h-32 w-32 text-emerald-400/5" />
          <Layers className="pointer-events-none absolute -bottom-8 right-4 h-24 w-24 text-zinc-700/20" />
        </Panel>
      </section>
    </div>
  );
}
