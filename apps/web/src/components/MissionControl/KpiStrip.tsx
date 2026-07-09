import { memo } from "react";
import type { SystemMetrics } from "../../services/api";

export interface KpiStripProps {
  metrics: SystemMetrics;
}

interface Kpi {
  label: string;
  value: string;
  alert?: boolean;
}

function buildKpis(metrics: SystemMetrics): Kpi[] {
  const { process: proc, traffic } = metrics;
  return [
    { label: "CPU", value: `${proc.cpuPercent}%`, alert: proc.cpuPercent >= 90 },
    { label: "RAM", value: `${proc.memoryUsedMb} Mo` },
    { label: "Req/min", value: String(traffic.requestsPerMinute) },
    { label: "Erreurs", value: String(traffic.errorCount), alert: traffic.errorCount > 0 },
    { label: "p50", value: `${traffic.p50LatencyMs}ms` },
    { label: "p95", value: `${traffic.p95LatencyMs}ms`, alert: traffic.p95LatencyMs >= 1000 },
  ];
}

/** Bandeau de métriques process réelles (CPU/RAM/trafic) — cf. GET /admin/metrics. */
function KpiStripImpl({ metrics }: KpiStripProps) {
  const kpis = buildKpis(metrics);
  return (
    <ul className="grid grid-cols-6 gap-3" aria-label="Métriques système">
      {kpis.map((kpi) => (
        <li
          key={kpi.label}
          className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2 ${
            kpi.alert ? "border-alert/40 bg-alert/[0.05]" : "border-slate-800 bg-slate-900/50"
          }`}
        >
          <span className="font-mono text-[9px] uppercase tracking-widest text-slate-500">{kpi.label}</span>
          <span className={`font-mono text-sm font-bold tabular-nums ${kpi.alert ? "text-alert" : "text-white"}`}>
            {kpi.value}
          </span>
        </li>
      ))}
    </ul>
  );
}

export const KpiStrip = memo(KpiStripImpl);
export default KpiStrip;
