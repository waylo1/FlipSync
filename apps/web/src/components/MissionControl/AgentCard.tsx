import type { ReactNode } from "react";

export type AgentStatus = "OK" | "WATCH" | "ALERT";

export interface AgentMetric {
  label: string;
  value: string;
}

export interface AgentCardProps {
  name?: string;
  role?: string;
  description?: string;
  status?: AgentStatus;
  task?: string;
  metrics?: AgentMetric[];
  icon?: ReactNode;
}

const STATUS_TEXT: Record<AgentStatus, string> = {
  OK: "text-teal-400",
  WATCH: "text-yellow-500",
  ALERT: "text-red-500",
};

const STATUS_DOT: Record<AgentStatus, string> = {
  OK: "bg-teal-400",
  WATCH: "bg-yellow-500",
  ALERT: "bg-red-500",
};

const DEFAULT_METRICS: AgentMetric[] = [
  { label: "Uptime", value: "99.98%" },
  { label: "Tâches", value: "1 284" },
  { label: "Latence", value: "142 ms" },
  { label: "Queue", value: "3" },
];

const DEFAULT_ICON: ReactNode = (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="2 12 7 12 10 5 14 19 17 12 22 12" />
  </svg>
);

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

export function AgentCard({
  name = "Atlas",
  role = "Orchestrateur",
  description,
  status = "OK",
  task = "Standby",
  metrics = DEFAULT_METRICS,
  icon = DEFAULT_ICON,
}: AgentCardProps) {
  return (
    <article className="relative flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <span
        className={`absolute right-4 top-4 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest ${STATUS_TEXT[status]}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} aria-hidden="true" />
        {status}
      </span>

      <header className="flex items-center gap-3 pr-12">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-700 ring-1 ring-slate-600 font-mono text-xs font-bold text-slate-300"
          aria-hidden="true"
        >
          {initials(name)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold uppercase text-white">{name}</p>
          <p className="truncate text-xs text-teal-300">{role}</p>
        </div>
      </header>

      {description ? (
        <p className="text-[10px] leading-relaxed text-slate-400">{description}</p>
      ) : null}

      <div
        className={`my-2 flex h-16 items-center justify-center gap-3 border-y border-slate-800/50 px-1 ${STATUS_TEXT[status]}`}
      >
        {icon}
        <span className="truncate font-mono text-[10px] uppercase tracking-wide text-slate-300">
          {task}
        </span>
      </div>

      <ul className="flex flex-col gap-2 font-mono text-[10px]">
        {metrics.map((metric) => (
          <li
            key={metric.label}
            className="flex items-center justify-between border-b border-slate-800/30 pb-1"
          >
            <span className="uppercase text-slate-400">{metric.label}</span>
            <span className="max-w-[60%] truncate text-right text-white">{metric.value}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

export default AgentCard;
