// A faithful-in-spirit simulation of the edge0 streaming decode loop.
//
// This is NOT the real engine — it models the dynamics described in the
// Edge0 technical report (arXiv:2609.18063) and docs/ so a browser can show
// live-looking telemetry: per-layer expert routing, a cross-layer shared LRU
// expert pool, staged double-buffered slots, SSD read volume and the
// prerouter's one-step-ahead predictions.
//
//   token t → for each layer: sample top-K experts (with temporal locality)
//             → prerouter predicts the set one step ahead (staged_replace)
//             → pool hits serve from LRU; misses stream from "SSD"
//             → uncovered misses stall the step; covered loads overlap compute

import type { TierConfig } from "./tiers";

export interface LayerRoute {
  /** layer index */
  l: number;
  /** actually selected experts (sorted) */
  s: number[];
  /** prerouter-predicted experts for this layer (sorted) */
  p: number[];
  /** served from the LRU pool */
  h: number;
  /** streamed from SSD this step */
  m: number;
}

export interface StepResult {
  tokPerSec: number;
  ramGiB: number;
  ssdMB: number;
  ssdMbps: number;
  hitRate: number;
  prerouterAcc: number;
  poolUsed: number;
  uncoveredMisses: number;
  routes: LayerRoute[];
}

interface LayerState {
  /** previous token's chosen experts — autoregressive locality */
  lastSet: number[];
  /** ring buffer of recent picks */
  recent: number[];
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Edge0Sim {
  private rnd: () => number;
  private layers: LayerState[] = [];
  /** LRU pool of expert bundles keyed "layer:expert" — SharedExpertCache */
  private pool = new Map<string, number>();
  private tok = 0;
  // cumulative counters
  private ssdMBTotal = 0;
  private hitsTotal = 0;
  private lookupsTotal = 0;
  private correctTotal = 0;
  private predictedTotal = 0;
  private peakRam = 0;
  private lastMbps = 0;
  /** rolling decode speed (EMA) */
  private emaTps: number;

  constructor(
    private cfg: TierConfig,
    private prerouter: boolean,
    private ssdGBs = 1.6,
    seed = 42
  ) {
    this.rnd = mulberry32(seed);
    this.emaTps = cfg.decodeRange[1];
    for (let l = 0; l < cfg.layers; l++) {
      this.layers.push({ lastSet: [], recent: [] });
    }
  }

  /**
   * Sample this token's top-K with strong temporal locality: adjacent decode
   * steps reuse most of the same experts (autoregressive routing is sticky),
   * with a slowly moving recent window — this is what makes the LRU pool pay
   * off and the hot-stack/staged paths effective.
   */
  private sampleExperts(ls: LayerState): number[] {
    const K = this.cfg.topK;
    const picked = new Set<number>();
    const pickFrom = (arr: number[]) => arr[Math.floor(this.rnd() * arr.length)];
    let guard = 0;
    while (picked.size < K && guard++ < 64) {
      const r = this.rnd();
      if (r < 0.48 && ls.lastSet.length > 0) {
        picked.add(pickFrom(ls.lastSet));
      } else if (r < 0.86 && ls.recent.length > 0) {
        picked.add(pickFrom(ls.recent));
      } else {
        picked.add(Math.floor(this.rnd() * this.cfg.experts));
      }
    }
    while (picked.size < K) picked.add(Math.floor(this.rnd() * this.cfg.experts));
    const out = [...picked].sort((a, b) => a - b);
    // update locality state
    ls.lastSet = out;
    ls.recent = [...out, ...ls.recent].slice(0, 20);
    return out;
  }

  /** prerouter: predict next step's set from the current one (some slips) */
  private predict(actual: number[]): number[] {
    const acc = this.cfg.prerouterAcc;
    const out = actual.map((e) =>
      this.rnd() < acc ? e : Math.floor(this.rnd() * this.cfg.experts)
    );
    return [...new Set(out)].sort((a, b) => a - b);
  }

  private poolKey(l: number, e: number) {
    return `${l}:${e}`;
  }

  /**
   * Serve expert bundle (l, e) from the pool; on miss, stream it in from SSD
   * and insert with LRU eviction. Returns true when served without a load.
   */
  private ensure(l: number, e: number): boolean {
    const k = this.poolKey(l, e);
    if (this.pool.has(k)) {
      // refresh LRU order
      this.pool.delete(k);
      this.pool.set(k, 1);
      return true;
    }
    // stream from SSD → insert with LRU eviction
    if (this.pool.size >= this.cfg.cacheSlots) {
      const oldest = this.pool.keys().next().value as string | undefined;
      if (oldest !== undefined) this.pool.delete(oldest);
    }
    this.pool.set(k, 1);
    return false;
  }

  step(): StepResult {
    this.tok++;
    const cfg = this.cfg;

    // --- prediction pass (prerouter works one step ahead) ---
    const actuals: number[][] = [];
    const predicts: number[][] = [];
    for (let l = 0; l < cfg.layers; l++) {
      const a = this.sampleExperts(this.layers[l]);
      actuals.push(a);
      predicts.push(this.prerouter && l >= cfg.startLayer - 1 ? this.predict(a) : a);
    }

    // --- staged fill + execution pass against the pool ---
    let hits = 0;
    let misses = 0;
    let uncoveredMisses = 0;
    let correct = 0;
    let predicted = 0;
    const routes: LayerRoute[] = [];

    for (let l = 0; l < cfg.layers; l++) {
      const a = actuals[l];
      const p = predicts[l];
      const pSet = new Set(p);
      let lh = 0;
      let lm = 0;
      let lu = 0;
      for (const e of p) {
        predicted++;
        if (a.includes(e)) correct++;
      }
      for (const e of a) {
        const ok = this.ensure(l, e);
        if (ok) {
          lh++;
          hits++;
        } else {
          lm++;
          misses++;
          if (!pSet.has(e)) {
            lu++; // prediction didn't cover this expert → load stalls the step
            uncoveredMisses++;
          }
        }
      }
      // predicted-but-unselected prefetches also cost SSD bytes (overlap, no stall)
      let prefetch = 0;
      for (const e of p) {
        if (!a.includes(e) && this.ensure(l, e)) {
          // already resident
        } else if (!a.includes(e)) {
          prefetch++;
        }
      }
      misses += prefetch; // bytes moved, but overlapped with compute
      this.lookupsTotal += cfg.topK;
      routes.push({ l, s: a, p, h: lh, m: lm + prefetch });
    }

    // warm-up: the pool needs a few steps to learn the working set
    const warm = Math.min(1, this.tok / 12);
    this.hitsTotal += hits;
    const hitRate = this.lookupsTotal > 0 ? this.hitsTotal / this.lookupsTotal : 0;
    const effectiveHit = hitRate * (0.35 + 0.65 * warm);

    // --- throughput model ---
    // per-step load time from SSD for the *uncached* fraction of the step's
    // expert set; prerouter overlaps most of it with compute (staged slots
    // are already full when the layer executes).
    const stepMisses = misses;
    const uncovered = uncoveredMisses;
    const loadSec = (stepMisses * cfg.bundleMB) / 1024 / this.ssdGBs;
    const stallSec =
      (uncovered * cfg.bundleMB) / 1024 / this.ssdGBs;
    const tCompute = 1 / cfg.computeTops;
    const overlappedLoad = this.prerouter
      ? Math.max(0, loadSec - tCompute) * 0.35 + stallSec
      : loadSec;
    let tps = 1 / (tCompute + overlappedLoad);
    tps *= 0.97 + this.rnd() * 0.06; // measurement noise
    if (this.tok < 8) tps *= 0.82 + this.tok * 0.02; // cold start
    this.emaTps = this.emaTps * 0.9 + tps * 0.1;

    // --- memory model: runtime base + pool + staged stacks + KV growth ---
    const poolGiB = (this.pool.size * cfg.bundleMB) / 1024;
    const baseGiB = cfg.ramBaseGiB;
    const kvGiB = Math.min(0.6, (this.tok * 1.1) / 2048);
    const ramGiB = Math.min(cfg.peakRamGiB * 1.06, baseGiB + poolGiB + kvGiB);
    this.peakRam = Math.max(this.peakRam, ramGiB);

    // --- SSD accounting ---
    const stepMB = stepMisses * cfg.bundleMB;
    this.ssdMBTotal += stepMB;
    this.lastMbps = stepMB / Math.max(0.001, 1 / this.emaTps);

    this.correctTotal += correct;
    this.predictedTotal += predicted;
    const acc = this.predictedTotal > 0 ? this.correctTotal / this.predictedTotal : cfg.prerouterAcc;

    return {
      tokPerSec: this.emaTps,
      ramGiB: this.peakRam,
      ssdMB: this.ssdMBTotal,
      ssdMbps: this.lastMbps,
      hitRate: effectiveHit,
      prerouterAcc: this.prerouter ? acc : 0,
      poolUsed: this.pool.size,
      uncoveredMisses: uncovered,
      routes,
    };
  }

  get tokens() {
    return this.tok;
  }
}
