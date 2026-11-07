// In-memory request registry for the edge0 OpenAI-compatible endpoint.
// Kept on globalThis so the log survives Next.js dev-server HMR reloads.

export interface ApiRequestRecord {
  id: string;
  ts: string; // ISO timestamp
  route: "chat" | "completions";
  model: string;
  stream: boolean;
  client: string; // shortened user-agent
  promptTokens: number;
  completionTokens: number;
  tokPerSec: number; // simulated decode speed for this request
  ttftMs: number; // time to first token (incl. prefill window)
  durationMs: number;
  status: number;
  error?: string;
}

export interface Insights {
  requests: ApiRequestRecord[];
  stats: {
    totalRequests: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    avgTokPerSec: number;
    avgTtftMs: number;
  };
}

interface RegistryState {
  requests: ApiRequestRecord[];
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
}

const g = globalThis as unknown as { __edge0ApiRegistry?: RegistryState };

function state(): RegistryState {
  if (!g.__edge0ApiRegistry) {
    g.__edge0ApiRegistry = {
      requests: [],
      totalRequests: 0,
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
    };
  }
  return g.__edge0ApiRegistry;
}

const MAX_LOG = 80;

export function recordRequest(rec: ApiRequestRecord) {
  const s = state();
  s.requests.unshift(rec);
  if (s.requests.length > MAX_LOG) s.requests.length = MAX_LOG;
  s.totalRequests += 1;
  s.totalPromptTokens += rec.promptTokens;
  s.totalCompletionTokens += rec.completionTokens;
}

export function getInsights(): Insights {
  const s = state();
  const ok = s.requests.filter((r) => r.status === 200 && r.completionTokens > 0);
  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  return {
    requests: s.requests.slice(0, 50),
    stats: {
      totalRequests: s.totalRequests,
      totalPromptTokens: s.totalPromptTokens,
      totalCompletionTokens: s.totalCompletionTokens,
      avgTokPerSec: +avg(ok.map((r) => r.tokPerSec)).toFixed(1),
      avgTtftMs: Math.round(avg(ok.map((r) => r.ttftMs))),
    },
  };
}

/** Map a user-agent to a short client label for the log table. */
export function shortClient(ua: string | null): string {
  if (!ua) return "unknown";
  const s = ua.toLowerCase();
  if (s.includes("continue")) return "continue";
  if (s.includes("cline")) return "cline";
  if (s.includes("curl")) return "curl";
  if (s.includes("python")) return "python";
  if (s.includes("node")) return "node";
  if (s.includes("mozilla") || s.includes("chrome") || s.includes("safari")) return "browser";
  return ua.slice(0, 22);
}
