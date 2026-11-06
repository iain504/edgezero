// Shared Edge0 domain data — tier specs, benchmark numbers, platform matrix.
// Faithful to github.com/Edge0-AI/Edge0 (README + docs) as of the 2026-09-30 release.

export type TierId = "edge0-35b" | "edge0-8b";

export interface TierConfig {
  id: TierId;
  name: string;
  checkpoint: string;
  params: string;
  baseFamily: string;
  routerKind: string;
  layers: number;
  experts: number;
  topK: number;
  startLayer: number;
  heads: number;
  quantBits: number;
  diskGB: number;
  /** per-expert weight bundle (gate/up/down @ 4-bit), MB */
  bundleMB: number;
  /** shared expert LRU slots (SharedExpertCache capacity) */
  cacheSlots: number;
  /** staged double-buffer slots per layer */
  stagedSlots: number;
  /** compute-bound decode ceiling, tok/s */
  computeTops: number;
  /** measured decode range with prerouter, tok/s */
  decodeRange: [number, number];
  prefillCold: number;
  prefillWarm: number;
  peakRamGiB: number;
  prerouterAcc: number;
  /** fixed runtime footprint (runtime + activations + buffers), GiB */
  ramBaseGiB: number;
}

export const TIERS: Record<TierId, TierConfig> = {
  "edge0-35b": {
    id: "edge0-35b",
    name: "edge0-35b",
    checkpoint: "Edge0/Edge0-35B-A3B-preview",
    params: "35B total · ~3B active",
    baseFamily: "Qwen3.6-35B-A3B",
    routerKind: "SOFTMAX_TOPK",
    layers: 40,
    experts: 256,
    topK: 4,
    startLayer: 7,
    heads: 33,
    quantBits: 4,
    diskGB: 23,
    bundleMB: 1.21,
    cacheSlots: 320,
    stagedSlots: 8,
    computeTops: 18,
    decodeRange: [14.9, 17.7],
    prefillCold: 113,
    prefillWarm: 140,
    peakRamGiB: 2.9,
    prerouterAcc: 0.93,
    ramBaseGiB: 1.6,
  },
  "edge0-8b": {
    id: "edge0-8b",
    name: "edge0-8b",
    checkpoint: "Edge0/Edge0-8B-A1B-preview",
    params: "8B total · ~1B active",
    baseFamily: "Ling 3.0 (bailing hybrid)",
    routerKind: "SIGMOID_GROUP",
    layers: 24,
    experts: 128,
    topK: 8,
    startLayer: 7,
    heads: 16,
    quantBits: 4,
    diskGB: 4.2,
    bundleMB: 1.37,
    cacheSlots: 320,
    stagedSlots: 8,
    computeTops: 30,
    decodeRange: [23.9, 25.3],
    prefillCold: 500,
    prefillWarm: 1428,
    peakRamGiB: 1.0,
    prerouterAcc: 0.9,
    ramBaseGiB: 0.4,
  },
};

export function getTier(id: string): TierConfig {
  return TIERS[(id as TierId) in TIERS ? (id as TierId) : "edge0-35b"];
}

// ---------------------------------------------------------------- benchmarks

export interface QualityRow {
  bench: string;
  e35: number;
  b35: number;
  e8: number;
  b8: number;
}

export const QUALITY: QualityRow[] = [
  { bench: "AIME 2026", e35: 86.6, b35: 92.7, e8: 63.3, b8: 73.3 },
  { bench: "HumanEval", e35: 90.9, b35: 95.1, e8: 91.5, b8: 92.7 },
  { bench: "GPQA-Diamond", e35: 79.8, b35: 81.8, e8: 70.7, b8: 71.2 },
  { bench: "MMLU-Pro", e35: 81.0, b35: 84.6, e8: 70.1, b8: 65.8 },
  { bench: "IFBench", e35: 57.9, b35: 61.7, e8: 53.9, b8: 60.6 },
  { bench: "Average", e35: 79.2, b35: 83.2, e8: 69.9, b8: 72.7 },
];

export const TEST_MACHINE = "Mac mini M4 Pro, 24 GB";

export const BENCH_NOTE =
  "Measured with python/examples/bench.py — 3.3k-token prompt prefill → 10 warmup steps → 200 timed decode tokens, 2 runs per tier. Peak memory is mlx.core.get_peak_memory() after decode, not process RSS.";

// ---------------------------------------------------------------- platforms

export interface Platform {
  name: string;
  dir: string;
  stack: string;
  target: string;
  status: "available" | "open-sourced";
}

export const PLATFORMS: Platform[] = [
  { name: "Python", dir: "python/", stack: "Python + MLX", target: "macOS · Apple Silicon", status: "available" },
  { name: "macOS", dir: "macos/", stack: "Rust", target: "CLI / daemon / desktop app", status: "open-sourced" },
  { name: "iOS", dir: "ios/", stack: "Swift + MLX Swift", target: "on-device iPhone app", status: "open-sourced" },
  { name: "Android", dir: "android/", stack: "Kotlin + native engine", target: "on-device app + engine", status: "open-sourced" },
  { name: "Windows", dir: "windows/", stack: "C++ + Vulkan", target: "desktop app + native engine", status: "open-sourced" },
];

// ---------------------------------------------------------------- roadmap

export const ROADMAP: { title: string; detail: string }[] = [
  {
    title: "Unified inference framework",
    detail:
      "One access layer across chat / serve / on-device use; the runtime auto-adapts to iOS, macOS, Android, Windows and Python, building on the platform engines already open-sourced.",
  },
  {
    title: "CUDA backend for Python",
    detail:
      "Reserved slot at python/src/edge0/backends/cuda/ — core code needs zero changes thanks to the backend facade.",
  },
  {
    title: "Next-gen architecture support",
    detail:
      "Qwen3.8-Flash class: hybrid linear attention (GDN + QSA), gated multi-branch residual and N-gram embedding topologies — O(1)-state attention keeps long thinking from becoming a KV-cache problem.",
  },
  {
    title: "Latent thinking + batched expert pre-prediction",
    detail:
      "Move expert routing from per-position to once per block, with cross-block prefetch inside the current block's compute window — measured as end-to-end thinking-phase time at matched accuracy.",
  },
  { title: "More tiers & adapter releases", detail: "Additional model tiers on the existing checkpoint + LoRA + prerouter pipeline." },
];

export const NEWS: { date: string; text: string }[] = [
  { date: "2026-09-30", text: "Inference engines for iOS, macOS, Android and Windows open-sourced in-repo." },
  { date: "2026-09-16", text: "Technical report on arXiv: The Other Half of the Memory Wall (2609.18063)." },
  { date: "2026-09-08", text: "Initial open-source release with edge0-35b / edge0-8b preview tiers." },
];

export const REPO_URL = "https://github.com/Edge0-AI/Edge0";
export const PAPER_URL = "https://arxiv.org/abs/2609.18063";
export const HF_35B = "https://huggingface.co/Edge0/Edge0-35B-A3B-preview";
export const HF_8B = "https://huggingface.co/Edge0/Edge0-8B-A1B-preview";
