import type { ReactNode } from "react";
import { GitBranch, Image, Cpu, KeyRound, Send, Wallet } from "lucide-react";
import { AgentCard, type AgentCardProps, type AgentStatus as CardStatus } from "./AgentCard";
import { SystemHealthBar } from "./SystemHealthBar";
import { KpiStrip } from "./KpiStrip";
import { HealthScore } from "./HealthScore";
import { useMissionControlStore, type Agent, type AgentStatus } from "../../store/useMissionControlStore";

const LOG_LEVEL_STYLE = {
  nominal: { text: "text-nominal", bar: "bg-nominal" },
  warning: { text: "text-watch", bar: "bg-watch" },
  alert: { text: "text-alert", bar: "bg-alert" },
} as const;

const STATUS_TO_CARD: Record<AgentStatus, CardStatus> = {
  NOMINAL: "OK",
  WATCH: "WATCH",
  ALERT: "ALERT",
};

/** Icône par sous-système (agent.id est stable — cf. useMissionControlStore.buildAgents). */
const AGENT_ICON: Record<string, ReactNode> = {
  atlas: <GitBranch className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />,
  vega: <Image className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />,
  orion: <Cpu className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />,
  lyra: <KeyRound className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />,
  nova: <Send className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />,
  rhea: <Wallet className="h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />,
};

function toCardProps(agent: Agent): AgentCardProps {
  return {
    name: agent.name,
    role: agent.role,
    description: agent.description,
    status: STATUS_TO_CARD[agent.status],
    task: agent.currentTask,
    metrics: agent.metrics.map((metric) => ({ label: metric.key, value: metric.value })),
    icon: AGENT_ICON[agent.id],
  };
}

export function Dashboard() {
  const agents = useMissionControlStore((state) => state.agents);
  const logs = useMissionControlStore((state) => state.logs);
  const alerts = useMissionControlStore((state) => state.alerts);
  const overview = useMissionControlStore((state) => state.overview);
  const health = useMissionControlStore((state) => state.health);
  const metrics = useMissionControlStore((state) => state.metrics);
  const loading = useMissionControlStore((state) => state.loading);
  const error = useMissionControlStore((state) => state.error);
  const fetchAgents = useMissionControlStore((state) => state.fetchAgents);

  const queued = overview?.listings.byStatus.QUEUED ?? 0;
  const alertCount = alerts.length;

  return (
    <div className="flex h-screen w-full flex-col gap-4 overflow-hidden bg-slate-950 p-4 text-slate-100">
      <header className="flex h-10 items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full rounded-full bg-nominal motion-safe:animate-pulse-ring" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-nominal" />
          </span>
          <h1 className="font-sans text-sm font-bold uppercase tracking-widest text-nominal">
            FlipSync <span className="text-slate-500">·</span> Mission Control
          </h1>
          <span className="rounded border border-nominal/30 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-nominal">
            Live
          </span>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-slate-400">
          <span className="rounded border border-slate-800 px-2 py-1">
            LISTINGS <span className="tabular-nums text-white">{overview?.listings.total ?? "—"}</span>
          </span>
          <span className="rounded border border-slate-800 px-2 py-1">
            QUEUE <span className="tabular-nums text-watch">{queued}</span>
          </span>
          <span className="rounded border border-slate-800 px-2 py-1">
            INCIDENTS{" "}
            <span className={`tabular-nums ${alertCount > 0 ? "text-alert" : "text-nominal"}`}>{alertCount}</span>
          </span>
          {overview ? (
            <span className="text-slate-600">
              MAJ{" "}
              <span className="tabular-nums">
                {new Date(overview.health.ts).toLocaleTimeString("fr-FR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void fetchAgents(false)}
            aria-label="Rafraîchir les métriques"
            className="rounded border border-slate-700 px-2 py-1 uppercase tracking-widest text-slate-300 transition-colors hover:border-nominal hover:text-nominal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nominal"
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </header>

      <div className="flex items-center justify-between gap-4">
        {health && metrics ? <HealthScore health={health} metrics={metrics} /> : null}
        {health ? <SystemHealthBar services={health.services} /> : null}
      </div>

      {metrics ? <KpiStrip metrics={metrics} /> : null}

      {error ? (
        <p className="rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 font-mono text-[11px] text-alert" role="alert">
          {error === "NO_AUTH_TOKEN"
            ? "VITE_ADMIN_TOKEN manquant — impossible d'interroger /admin/overview."
            : `Échec du chargement : ${error}`}
        </p>
      ) : null}

      <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
        Crew <span className="text-slate-700">/</span> <span className="text-nominal">FlipSync Agents</span>
      </p>

      <main className="grid min-h-0 flex-1 auto-rows-fr grid-cols-6 gap-4">
        {agents.length === 0 && !loading ? (
          <p className="col-span-6 flex items-center justify-center font-mono text-xs text-slate-600">
            Aucune donnée — clique Refresh
          </p>
        ) : (
          agents.map((agent) => <AgentCard key={agent.id} {...toCardProps(agent)} />)
        )}
      </main>

      <section className="grid h-1/3 min-h-0 grid-cols-3 gap-4" aria-live="polite">
        <div className="col-span-2 flex min-h-0 flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-sans text-[11px] font-bold uppercase tracking-widest text-nominal">Logs Système</h2>
          <ul className="flex flex-col gap-1.5 overflow-y-auto">
            {logs.map((log) => {
              const style = LOG_LEVEL_STYLE[log.level];
              return (
                <li key={log.id} className="flex items-baseline gap-3 border-l-2 border-slate-800 pl-2">
                  <span className={`h-full w-0.5 shrink-0 self-stretch rounded ${style.bar}`} aria-hidden="true" />
                  <span className="shrink-0 font-mono text-xs tabular-nums text-slate-500">{log.time}</span>
                  <span className={`w-14 shrink-0 font-mono text-xs uppercase ${style.text}`}>{log.source}</span>
                  <span className="truncate font-mono text-xs text-slate-300">{log.message}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex min-h-0 flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="flex items-center gap-2 font-sans text-[11px] font-bold uppercase tracking-widest text-alert">
            {alertCount > 0 ? (
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-alert motion-safe:animate-pulse-ring" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-alert" />
              </span>
            ) : null}
            Alertes P1
          </h2>
          <ul className="flex flex-col gap-2 overflow-y-auto font-mono text-xs">
            {alerts.length === 0 ? (
              <li className="text-slate-600">Aucune alerte P1</li>
            ) : (
              alerts.map((alert) => (
                <li key={alert.id} className="border-b border-slate-800/30 pb-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-alert">
                      {alert.id} · <span className="uppercase text-white">{alert.agent}</span>
                    </span>
                    <span className="tabular-nums text-slate-500">{alert.time}</span>
                  </div>
                  <p className="truncate text-slate-300">{alert.message}</p>
                </li>
              ))
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}

export default Dashboard;
