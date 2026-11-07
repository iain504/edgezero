"use client";

import { useEffect, useState } from "react";
import { Cpu, FlaskConical, Github, Github as GithubIcon, LayoutGrid, LineChart, Plug, Workflow } from "lucide-react";
import { REPO_URL } from "@/lib/edge0/tiers";
import { Overview } from "./overview";
import { Playground } from "./playground";
import { Pipeline } from "./pipeline";
import { Benchmarks } from "./benchmarks";
import { ApiServer } from "./api-server";

type View = "overview" | "playground" | "pipeline" | "benchmarks" | "api";

const NAV: { id: View; label: string; icon: typeof LayoutGrid }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "playground", label: "Playground", icon: Cpu },
  { id: "pipeline", label: "Pipeline", icon: Workflow },
  { id: "benchmarks", label: "Benchmarks", icon: LineChart },
  { id: "api", label: "API Server", icon: Plug },
];

export function Edge0App() {
  const [view, setView] = useState<View>("overview");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="edge0-root flex min-h-screen flex-col text-zinc-200">
      {/* ------------------------------------------------------- nav ---- */}
      <header
        className={`sticky top-0 z-50 border-b transition-colors duration-300 ${
          scrolled ? "border-zinc-800/80 bg-[#0a0a0c]/85 backdrop-blur-md" : "border-transparent bg-transparent"
        }`}
      >
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <button
            onClick={() => setView("overview")}
            className="group flex items-center gap-2.5"
            aria-label="edge0 home"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-400/40 bg-amber-400/10 font-mono text-[13px] font-bold text-amber-300 transition-shadow group-hover:edge0-glow-amber">
              e0
            </span>
            <span className="font-mono text-[15px] font-semibold tracking-tight text-zinc-100">
              edge0<span className="text-zinc-600">/workbench</span>
            </span>
          </button>

          <nav className="flex items-center gap-1 rounded-full border border-zinc-800/80 bg-zinc-900/40 p-1" aria-label="Primary">
            {NAV.map((n) => {
              const active = view === n.id;
              return (
                <button
                  key={n.id}
                  onClick={() => setView(n.id)}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12.5px] transition-colors sm:px-3.5 ${
                    active
                      ? "bg-amber-400 font-semibold text-zinc-950"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <n.icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{n.label}</span>
                </button>
              );
            })}
          </nav>

          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 font-mono text-[11px] text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-100"
            aria-label="View Edge0 on GitHub"
          >
            <GithubIcon className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Edge0-AI/Edge0</span>
          </a>
        </div>
      </header>

      {/* ------------------------------------------------------ views ---- */}
      <main className="flex-1">
        {view === "overview" ? <Overview onNavigate={setView} /> : null}
        {view === "playground" ? <Playground /> : null}
        {view === "pipeline" ? <Pipeline /> : null}
        {view === "benchmarks" ? <Benchmarks /> : null}
        {view === "api" ? <ApiServer /> : null}
      </main>

      {/* ---------------------------------------------------- footer ---- */}
      <footer className="mt-auto border-t border-zinc-800/70 bg-zinc-950/60">
        <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-between gap-3 px-4 py-5 pb-[max(20px,env(safe-area-inset-bottom))] sm:flex-row sm:px-6">
          <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-600">
            <FlaskConical className="h-3.5 w-3.5 text-amber-400/60" />
            an interactive study of{" "}
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="text-zinc-400 underline-offset-2 hover:text-amber-300 hover:underline">
              github.com/Edge0-AI/Edge0
            </a>
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px] text-zinc-600">
            <span>engine simulated · metrics modeled from arXiv:2609.18063</span>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-zinc-500 hover:text-zinc-200">
              <Github className="h-3 w-3" /> Apache-2.0
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
