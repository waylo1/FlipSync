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

interface StatusStyle {
  text: string;
  dot: string;
  ring: string;
  tint: string;
  /** Vide pour OK — le calme visuel EST le signal ; le bruit doit rester réservé aux anomalies. */
  glow: string;
  pulse: boolean;
}

const STATUS_STYLE: Record<AgentStatus, StatusStyle> = {
  OK: {
    text: "text-nominal",
    dot: "bg-nominal",
    ring: "ring-slate-800",
    tint: "",
    glow: "",
    pulse: false,
  },
  WATCH: {
    text: "text-watch",
    dot: "bg-watch",
    ring: "ring-watch/40",
    tint: "bg-watch/[0.04]",
    glow: "shadow-[0_0_20px_-8px_rgba(245,158,11,0.5)]",
    pulse: true,
  },
  ALERT: {
    text: "text-alert",
    dot: "bg-alert",
    ring: "ring-alert/50",
    tint: "bg-alert/[0.05]",
    glow: "shadow-[0_0_24px_-6px_rgba(239,68,68,0.6)]",
    pulse: true,
  },
};

/** Valeurs état-connecteur reconnues (cf. AdminOverview.marketplace) — rendues en pastille, pas en texte brut. */
const CONNECTOR_VALUES = ["LIVE", "MOCK", "MISSING"] as const;
type ConnectorValue = (typeof CONNECTOR_VALUES)[number];

const CONNECTOR_CHIP: Record<ConnectorValue, string> = {
  LIVE: "bg-nominal/10 text-nominal",
  MOCK: "bg-watch/10 text-watch",
  MISSING: "bg-alert/10 text-alert",
};

function isConnectorValue(value: string): value is ConnectorValue {
  return (CONNECTOR_VALUES as readonly string[]).includes(value);
}

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
  const style = STATUS_STYLE[status];

  return (
    <article
      className={`relative flex h-full flex-col gap-2 overflow-hidden rounded-xl border border-slate-800 p-3 ring-1 transition-shadow ${style.ring} ${style.tint} ${style.glow}`}
    >
      <span
        className={`absolute right-3 top-3 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest ${style.text}`}
      >
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          {style.pulse ? (
            <span className={`absolute inline-flex h-full w-full rounded-full ${style.dot} motion-safe:animate-pulse-ring`} />
          ) : null}
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${style.dot}`} />
        </span>
        {status}
      </span>

      <header className="flex shrink-0 items-center gap-3 pr-12">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-700 ring-1 ring-slate-600 font-mono text-xs font-bold text-slate-300"
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
        <p className="line-clamp-2 shrink-0 text-[10px] leading-relaxed text-slate-400">{description}</p>
      ) : null}

      <div className={`flex h-10 shrink-0 items-center gap-2 border-y border-slate-800/50 px-1 ${style.text}`}>
        {icon}
        <span className="truncate font-mono text-[10px] uppercase tracking-wide text-slate-300">{task}</span>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto font-mono text-[10px]">
        {metrics.map((metric) => (
          <li key={metric.label} className="flex shrink-0 items-start justify-between gap-2 border-b border-slate-800/30 pb-1">
            <span className="shrink-0 uppercase text-slate-400">{metric.label}</span>
            {isConnectorValue(metric.value) ? (
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${CONNECTOR_CHIP[metric.value]}`}>
                {metric.value}
              </span>
            ) : (
              <span className="text-right font-medium tabular-nums text-white">{metric.value}</span>
            )}
          </li>
        ))}
      </ul>
    </article>
  );
}

export default AgentCard;
