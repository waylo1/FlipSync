import { memo } from "react";
import type { ServiceStatus, SystemHealth, SystemMetrics } from "../../services/api";

export interface HealthScoreProps {
  health: SystemHealth;
  metrics: SystemMetrics;
}

const SCORE_COLOR: Record<ServiceStatus, string> = {
  healthy: "text-nominal",
  warning: "text-watch",
  down: "text-alert",
};

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}min`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

/** Score global (0-100), version et uptime réels — cf. GET /admin/health + /admin/metrics. */
function HealthScoreImpl({ health, metrics }: HealthScoreProps) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2 font-mono text-xs">
      <div className="flex items-baseline gap-1">
        <span className={`text-lg font-bold tabular-nums ${SCORE_COLOR[health.overall]}`}>{health.score}</span>
        <span className="text-slate-500">/100</span>
      </div>
      <span className="h-4 w-px bg-slate-800" aria-hidden="true" />
      <span className="text-slate-400">
        v<span className="text-slate-200">{metrics.version}</span>
      </span>
      <span className="h-4 w-px bg-slate-800" aria-hidden="true" />
      <span className="text-slate-400">
        Uptime <span className="tabular-nums text-slate-200">{formatUptime(metrics.uptimeSec)}</span>
      </span>
    </div>
  );
}

export const HealthScore = memo(HealthScoreImpl);
export default HealthScore;
