import { memo, useState } from "react";
import { api, ApiError } from "../../services/api";
import type { ServiceHealth, ServiceStatus } from "../../services/api";

export interface SystemHealthBarProps {
  services: ServiceHealth[];
  /** Rafraîchit health+metrics après une action — évite d'attendre le prochain poll. */
  onActionDone?: () => void;
}

type RestartState = "idle" | "pending" | "done" | "error";

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

/** Bouton de relance — visible uniquement sur le service inference (seul process local relançable). */
function RestartButton({ onDone }: { onDone?: () => void }) {
  const [state, setState] = useState<RestartState>("idle");

  const restart = async () => {
    setState("pending");
    try {
      const result = await api.restartOllama();
      setState(result.started ? "done" : "error");
    } catch (err) {
      setState("error");
      if (!(err instanceof ApiError)) throw err;
    } finally {
      onDone?.();
    }
  };

  const label = state === "pending" ? "…" : state === "done" ? "envoyé" : state === "error" ? "échec" : "relancer";

  return (
    <button
      type="button"
      onClick={restart}
      disabled={state === "pending"}
      className="rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 hover:border-slate-500 hover:text-slate-200 disabled:opacity-50"
      aria-label="Relancer Ollama"
    >
      {label}
    </button>
  );
}

/** Barre de statut des dépendances réelles (DB, IA, Stripe...) — cf. GET /admin/health. */
function SystemHealthBarImpl({ services, onActionDone }: SystemHealthBarProps) {
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
          {service.id === "inference" ? <RestartButton onDone={onActionDone} /> : null}
        </li>
      ))}
    </ul>
  );
}

export const SystemHealthBar = memo(SystemHealthBarImpl);
export default SystemHealthBar;
