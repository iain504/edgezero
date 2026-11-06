"use client";

import { useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";

export function SectionTitle({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="mb-8">
      <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.25em] text-amber-400/90">
        {kicker}
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-zinc-100 sm:text-3xl">{title}</h2>
      {sub ? <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">{sub}</p> : null}
    </div>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`edge0-panel rounded-xl ${className}`}>{children}</div>;
}

export function CodeBlock({ code, title }: { code: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard unavailable
    }
  };
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/80">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
          {title ? (
            <span className="ml-3 font-mono text-[11px] text-zinc-500">{title}</span>
          ) : null}
        </div>
        <button
          onClick={copy}
          aria-label="Copy code"
          className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <pre className="edge0-scroll overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-zinc-300">
        {code}
      </pre>
    </div>
  );
}

export function StatChip({
  label,
  value,
  unit,
  tone = "amber",
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: "amber" | "emerald" | "zinc" | "orange";
}) {
  const tones: Record<string, string> = {
    amber: "text-amber-300 border-amber-400/25 bg-amber-400/5",
    emerald: "text-emerald-300 border-emerald-400/25 bg-emerald-400/5",
    zinc: "text-zinc-300 border-zinc-700 bg-zinc-800/40",
    orange: "text-orange-300 border-orange-400/25 bg-orange-400/5",
  };
  return (
    <div className={`rounded-lg border px-3 py-2 ${tones[tone]}`}>
      <div className="font-mono text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-semibold leading-none">
        {value}
        {unit ? <span className="ml-1 text-[11px] font-normal opacity-70">{unit}</span> : null}
      </div>
    </div>
  );
}

export function TierBadge({ tier }: { tier: string }) {
  const is35 = tier.includes("35");
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] ${
        is35
          ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
          : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      }`}
    >
      {tier}
    </span>
  );
}

export function formatTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
