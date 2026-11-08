# edgezero · Edge0 Workbench

An interactive study and simulation of [Edge0-AI/Edge0](https://github.com/Edge0-AI/Edge0) — the SSD-streamed Mixture-of-Experts inference engine for on-device LLMs — bundled with a working **OpenAI-compatible API server** that IDEs like VS Code can consume today.

> **Faithful-in-spirit simulation.** Throughput, memory, expert-routing and SSD telemetry are modeled from the Edge0 technical report ([arXiv:2609.18063](https://arxiv.org/abs/2609.18063)). Response text on the API is produced by a hosted stand-in model; swapping in the real `edge0 serve` requires changing one function.

---

## What's inside

| Tab | What it shows |
|---|---|
| **Overview** | What Edge0 is: two tiers (`edge0-35b`, `edge0-8b`), the memory-wall problem, platform matrix and roadmap |
| **Playground** | Live chat against the simulated engine — per-token telemetry (tok/s, RAM, SSD MB/s, LRU hit rate, prerouter accuracy) |
| **Pipeline** | Frame-by-frame decode loop: top-K routing → prerouter prediction → staged slots → LRU pool → SSD streaming |
| **Benchmarks** | Quality vs base models (AIME, HumanEval, GPQA-Diamond, MMLU-Pro) + throughput/memory charts |
| **API Server** | Connection status, API key management, copy-ready VS Code configs, live request log, in-page test console |

## The API server (`/api/v1`)

An OpenAI wire-compatible endpoint with SSE streaming. Token pacing is driven by the Edge0 decode model, so `edge0-35b` streams at ~15–18 tok/s and `edge0-8b` at ~24 tok/s — the paper's measured ranges.

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/models` | List local tiers with tier metadata |
| `POST /api/v1/chat/completions` | Chat — `stream: true` (SSE) or `stream: false` (JSON) |
| `POST /api/v1/completions` | Legacy text completion, with FIM-lite `suffix` support |
| `GET /api/v1/health` | Liveness, engine + auth mode |
| `GET /api/v1/insights` | Operator dashboard feed: request log, stats, auth info |

**Auth** — set `EDGE0_API_KEY` in `.env.local` to lock the endpoint. Three accepted schemes:

```bash
Authorization: Bearer e0-sk-…   # OpenAI SDKs, Continue, Cline
X-Api-Key: e0-sk-…              # alternate header
?key=e0-sk-…                    # bare curl convenience
```

Unset = open (POC mode).

**Smoke test:**

```bash
curl http://localhost:3000/api/v1/chat/completions \
  -H "Authorization: Bearer $EDGE0_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"edge0-35b","stream":true,
       "messages":[{"role":"user","content":"Write a Pine Script EMA cross strategy"}]}'
```

## Connect VS Code

**Continue** (`config.json`):

```json
{
  "models": [
    {
      "title": "Edge0 35B (local)",
      "provider": "openai",
      "apiBase": "http://localhost:3000/api/v1",
      "apiKey": "<your EDGE0_API_KEY>",
      "model": "edge0-35b"
    }
  ]
}
```

**Cline** — API Provider → `OpenAI Compatible`, Base URL `http://localhost:3000/api/v1`, Model ID `edge0-35b` (smart) or `edge0-8b` (fast).

The API Server tab in the app auto-generates these snippets with your deployment's URL and key.

## Getting started

Prereqs: [Bun](https://bun.sh) (or Node 20+) and a Prisma-supported SQLite file.

```bash
bun install

# .env.local
DATABASE_URL=file:./db/custom.db
EDGE0_API_KEY=e0-sk-<your-random-hex>     # optional; omit for open endpoint

bun run db:push
bun run dev          # http://localhost:3000
```

## Project structure

```
src/
  app/
    page.tsx                     # renders the Edge0App workbench
    api/v1/
      models/route.ts            # GET  — OpenAI model listing
      chat/completions/route.ts  # POST — chat, SSE + JSON
      completions/route.ts       # POST — legacy completions
      health/route.ts            # GET  — liveness
      insights/route.ts          # GET  — dashboard telemetry
  lib/edge0/
    tiers.ts                     # tier specs, benchmark + platform data
    engine-sim.ts                # Edge0Sim — decode-loop simulation
    server/
      responder.ts               # stand-in generation + token pacing
      registry.ts                # in-memory request log
      http.ts                    # CORS, auth, OpenAI error bodies
  components/edge0/              # workbench views (overview, pipeline, …, api-server)
```

## How the simulation works

`Edge0Sim` (`src/lib/edge0/engine-sim.ts`) models the dynamics described in the Edge0 report:

- **Temporal-locality expert sampling** — autoregressive routing is sticky; adjacent steps reuse most experts
- **Shared expert LRU pool** — pool hits serve from RAM, misses stream from a modeled SSD
- **One-step-ahead prerouter** — predicts the next expert set so loads overlap compute; uncovered misses stall the step
- **Throughput/memory model** — per-step SSD load time, cold-start warm-up, KV growth, peak-RAM accounting

The API layer feeds this same simulator to pace token delivery, so latency feels like the real engine.

## Going real

Replace `generateReply()` in `src/lib/edge0/server/responder.ts` with a call to your local `edge0 serve` (Apple Silicon via MLX, or the Windows C++/Vulkan engine). The API contract, streaming format, pacing and all client configs stay identical.

## Credits

- [Edge0-AI/Edge0](https://github.com/Edge0-AI/Edge0) — the engine this workbench studies (Apache-2.0)
- [The Other Half of the Memory Wall](https://arxiv.org/abs/2609.18063) — Edge0 technical report
- Built with Next.js 16, TypeScript, Tailwind CSS 4, shadcn/ui, Prisma (SQLite), Recharts
