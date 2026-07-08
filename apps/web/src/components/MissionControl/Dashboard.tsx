import { AgentCard, type AgentCardProps, type AgentStatus as CardStatus } from "./AgentCard";
import { useMissionControlStore, type Agent, type AgentStatus } from "../../store/useMissionControlStore";

const LOG_LEVEL_TEXT = {
  nominal: "text-teal-400",
  warning: "text-yellow-500",
  alert: "text-red-500",
} as const;

const STATUS_TO_CARD: Record<AgentStatus, CardStatus> = {
  NOMINAL: "OK",
  WATCH: "WATCH",
  ALERT: "ALERT",
};

function toCardProps(agent: Agent): AgentCardProps {
  return {
    name: agent.name,
    role: agent.role,
    description: agent.description,
    status: STATUS_TO_CARD[agent.status],
    task: agent.currentTask,
    metrics: agent.metrics.map((metric) => ({ label: metric.key, value: metric.value })),
  };
}

export function Dashboard() {
  const agents = useMissionControlStore((state) => state.agents);
  const logs = useMissionControlStore((state) => state.logs);
  const alerts = useMissionControlStore((state) => state.alerts);
  const overview = useMissionControlStore((state) => state.overview);
  const loading = useMissionControlStore((state) => state.loading);
  const error = useMissionControlStore((state) => state.error);
  const fetchAgents = useMissionControlStore((state) => state.fetchAgents);

  const queued = overview?.listings.byStatus.QUEUED ?? 0;
  const alertCount = alerts.length;

  return (
    <div className="flex h-screen w-full flex-col gap-4 overflow-hidden bg-slate-950 p-4 text-slate-100">
      <header className="flex h-10 items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 rounded-full bg-teal-400" aria-hidden="true" />
          <h1 className="font-sans text-sm font-bold uppercase tracking-widest text-teal-400">
            FlipSync <span className="text-slate-500">·</span> Mission Control
          </h1>
        </div>
        <div className="flex items-center gap-6 font-mono text-xs text-slate-400">
          <span>
            LISTINGS <span className="text-white">{overview?.listings.total ?? "—"}</span>
          </span>
          <span>
            QUEUE <span className="text-yellow-500">{queued}</span>
          </span>
          <span>
            INCIDENTS <span className={alertCount > 0 ? "text-red-500" : "text-teal-400"}>{alertCount}</span>
          </span>
          {overview ? (
            <span className="text-slate-600">
              MAJ{" "}
              {new Date(overview.health.ts).toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void fetchAgents(false)}
            className="rounded border border-slate-700 px-2 py-1 uppercase tracking-widest text-slate-300 hover:border-teal-400 hover:text-teal-400"
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </header>

      {error ? (
        <p className="rounded-lg border border-red-900 bg-red-950/40 px-3 py-2 font-mono text-[11px] text-red-400">
          {error === "NO_AUTH_TOKEN"
            ? "VITE_ADMIN_TOKEN manquant — impossible d'interroger /admin/overview."
            : `Échec du chargement : ${error}`}
        </p>
      ) : null}

      <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
        Crew <span className="text-slate-700">/</span> <span className="text-teal-400">FlipSync Agents</span>
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

      <section className="grid h-1/3 min-h-0 grid-cols-3 gap-4">
        <div className="col-span-2 flex min-h-0 flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-sans text-[11px] font-bold uppercase tracking-widest text-teal-400">
            Logs Système
          </h2>
          <ul className="flex flex-col gap-2 overflow-hidden font-mono text-[10px]">
            {logs.map((log) => (
              <li key={log.id} className="flex items-baseline gap-3 border-b border-slate-800/30 pb-1">
                <span className="shrink-0 text-slate-500">{log.time}</span>
                <span className={`w-14 shrink-0 uppercase ${LOG_LEVEL_TEXT[log.level]}`}>{log.source}</span>
                <span className="truncate text-slate-300">{log.message}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex min-h-0 flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-sans text-[11px] font-bold uppercase tracking-widest text-red-500">Alertes P1</h2>
          <ul className="flex flex-col gap-2 overflow-hidden font-mono text-[10px]">
            {alerts.length === 0 ? (
              <li className="text-slate-600">Aucune alerte P1</li>
            ) : (
              alerts.map((alert) => (
                <li key={alert.id} className="border-b border-slate-800/30 pb-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-red-500">
                      {alert.id} · <span className="uppercase text-white">{alert.agent}</span>
                    </span>
                    <span className="text-slate-500">{alert.time}</span>
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
