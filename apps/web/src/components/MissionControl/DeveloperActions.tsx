import { memo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, ApiError } from "../../services/api";
import type { DevActionsState } from "../../services/api";

export interface DeveloperActionsProps {
  state: DevActionsState;
  /** Refetch health+metrics+devActions après une action — évite d'attendre le prochain poll. */
  onActionDone: () => void;
}

type ActionState = "idle" | "pending" | "done" | "error";

function useAction(run: () => Promise<{ ok: boolean }>, onDone: () => void) {
  const [state, setState] = useState<ActionState>("idle");

  const trigger = async () => {
    setState("pending");
    try {
      const result = await run();
      setState(result.ok ? "done" : "error");
    } catch (err) {
      setState("error");
      if (!(err instanceof ApiError)) throw err;
    } finally {
      onDone();
    }
  };

  return { state, trigger };
}

function ActionButton({
  label,
  pendingLabel = "…",
  onClick,
  disabled,
}: {
  label: string;
  pendingLabel?: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-slate-700 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-slate-300 transition-colors hover:border-nominal hover:text-nominal disabled:cursor-not-allowed disabled:opacity-40"
    >
      {disabled ? pendingLabel : label}
    </button>
  );
}

function OllamaCard({ state, onActionDone }: { state: DevActionsState; onActionDone: () => void }) {
  const restart = useAction(() => api.restartOllama(), onActionDone);
  const { ollama } = state;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3 font-mono text-xs">
      <div className="flex items-center gap-2">
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${ollama.running ? "bg-nominal" : "bg-alert"}`} />
        </span>
        <span className="font-sans text-[11px] font-bold uppercase tracking-widest text-slate-200">Ollama</span>
        <span className={ollama.running ? "text-nominal" : "text-alert"}>{ollama.running ? "running" : "down"}</span>
      </div>
      <dl className="flex flex-col gap-0.5 text-slate-500">
        <div className="flex justify-between">
          <dt>Version</dt>
          <dd className="text-slate-300">{ollama.version ?? "—"}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Model</dt>
          <dd className="text-slate-300">{ollama.model}</dd>
        </div>
      </dl>
      <div className="flex gap-2 border-t border-slate-800 pt-2">
        <ActionButton
          label="Restart"
          pendingLabel={restart.state === "pending" ? "…" : restart.state === "error" ? "échec" : "Restart"}
          onClick={() => void restart.trigger()}
          disabled={restart.state === "pending"}
        />
      </div>
    </div>
  );
}

function TunnelCard({ state, onActionDone }: { state: DevActionsState; onActionDone: () => void }) {
  const start = useAction(() => api.startTunnel(), onActionDone);
  const stop = useAction(() => api.stopTunnel(), onActionDone);
  const [copied, setCopied] = useState(false);
  const { tunnel } = state;
  const pending = start.state === "pending" || stop.state === "pending";

  const copy = async () => {
    if (!tunnel.url) return;
    await navigator.clipboard.writeText(tunnel.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-900/50 p-3 font-mono text-xs">
      <div className="flex items-center gap-2">
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${tunnel.active ? "bg-nominal" : "bg-slate-600"}`} />
        </span>
        <span className="font-sans text-[11px] font-bold uppercase tracking-widest text-slate-200">Tunnel</span>
        <span className={tunnel.active ? "text-nominal" : "text-slate-500"}>{tunnel.active ? "active" : "inactive"}</span>
      </div>

      {tunnel.active && tunnel.url ? (
        <div className="flex items-center gap-3">
          <QRCodeSVG value={tunnel.url} size={72} bgColor="transparent" fgColor="#e2e8f0" />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate text-slate-300" title={tunnel.url}>
              {tunnel.url}
            </span>
            <div className="flex gap-2">
              <ActionButton label={copied ? "copié" : "Copier"} onClick={() => void copy()} disabled={false} />
              <a
                href={tunnel.url}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-300 transition-colors hover:border-nominal hover:text-nominal"
              >
                Ouvrir
              </a>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex gap-2 border-t border-slate-800 pt-2">
        {tunnel.active ? (
          <ActionButton
            label="Stop Tunnel"
            pendingLabel={stop.state === "pending" ? "…" : "Stop Tunnel"}
            onClick={() => void stop.trigger()}
            disabled={pending}
          />
        ) : (
          <ActionButton
            label="Start Tunnel"
            pendingLabel={start.state === "pending" ? "…" : start.state === "error" ? "échec" : "Start Tunnel"}
            onClick={() => void start.trigger()}
            disabled={pending}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Developer Actions — réservé au dev local (state.enabled reflète NODE_ENV côté
 * serveur, jamais actif en production). Aucune commande shell exécutée ici : les
 * boutons appellent /admin/actions/* qui exécutent et journalisent côté serveur.
 */
function DeveloperActionsImpl({ state, onActionDone }: DeveloperActionsProps) {
  if (!state.enabled) return null;

  return (
    <section className="flex flex-col gap-2" aria-label="Developer Actions">
      <p className="font-mono text-[10px] uppercase tracking-widest text-slate-500">
        Developer Actions <span className="text-slate-700">/</span> <span className="text-watch">dev only</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <OllamaCard state={state} onActionDone={onActionDone} />
        <TunnelCard state={state} onActionDone={onActionDone} />
      </div>
    </section>
  );
}

export const DeveloperActions = memo(DeveloperActionsImpl);
export default DeveloperActions;
