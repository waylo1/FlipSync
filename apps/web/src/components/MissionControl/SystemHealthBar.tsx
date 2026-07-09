import { memo } from "react";
import type { ServiceHealth, ServiceStatus } from "../../services/api";

export interface SystemHealthBarProps {
  services: ServiceHealth[];
}

const STATUS_DOT: Record<ServiceStatus, string> = {
  healthy: "bg-nominal",
  warning: "bg-watch",
  down: "bg-alert",
};

const STATUS_TEXT: Record<ServiceStatus, string> = {
  healthy: "text-nominal",
  warning: "text-watch",
  down: "text-alert",
};

/** Barre de statut des dépendances réelles (DB, IA, Stripe...) — cf. GET /admin/health. */
function SystemHealthBarImpl({ services }: SystemHealthBarProps) {
  return (
    <ul className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-widest" aria-label="État des services">
      {services.map((service) => (
        <li
          key={service.id}
          className="flex items-center gap-1.5 rounded border border-slate-800 px-2 py-1"
          title={service.detail ?? undefined}
        >
          <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
            <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${STATUS_DOT[service.status]}`} />
          </span>
          <span className="text-slate-300">{service.label}</span>
          <span className={STATUS_TEXT[service.status]} aria-label={`statut ${service.status}`}>
            {service.status}
          </span>
          {service.latencyMs !== undefined ? (
            <span className="tabular-nums text-slate-500">{service.latencyMs}ms</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export const SystemHealthBar = memo(SystemHealthBarImpl);
export default SystemHealthBar;
