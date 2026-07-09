import { memo, useEffect, useState } from "react";
import { api, ApiError } from "../../services/api";
import type { DevSessionDetail, DevSessionEvent, DevSessionSummary, DevSessionExportFormat } from "../../services/api";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function fmtDuration(startedAt: string, endedAt: string | null): string {
  if (!endedAt) return "en cours";
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  const sec = Math.round(ms / 1000);
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}min ${sec % 60}s`;
}

const EVENT_TYPE_STYLE: Record<string, string> = {
  navigation: "text-nominal",
  action: "text-slate-300",
  api_call: "text-watch",
  error: "text-alert",
  console: "text-watch",
  device_info: "text-slate-500",
};

function eventSummary(event: DevSessionEvent): string {
  const p = event.payload as Record<string, unknown>;
  switch (event.type) {
    case "navigation":
      return String(p.screen ?? "");
    case "action":
      return `${p.component ?? "?"} · ${p.action ?? "?"}`;
    case "api_call":
      return `${p.method ?? "?"} ${p.url ?? "?"} → ${p.statusCode ?? "?"} (${p.durationMs ?? "?"}ms)`;
    case "error":
      return String(p.message ?? "");
    case "console":
      return `[${p.level ?? "?"}] ${p.message ?? ""}`;
    case "device_info":
      return `${p.platform ?? "?"} ${p.osVersion ?? ""} · app ${p.appVersion ?? "?"}`;
    default:
      return JSON.stringify(p);
  }
}

const EXPORTS: { format: DevSessionExportFormat; label: string }[] = [
  { format: "events", label: "events.json" },
  { format: "report", label: "report.md" },
  { format: "llm-context", label: "llm-context.json" },
  { format: "llm-prompt", label: "llm-prompt.md" },
];

function SessionRow({ session, onSelect }: { session: DevSessionSummary; onSelect: (id: string) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(session.id)}
        aria-label={`Ouvrir la session ${session.id}`}
        className="flex w-full items-center justify-between gap-3 rounded border border-slate-800 px-3 py-2 text-left font-mono text-xs transition-colors hover:border-nominal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nominal"
      >
        <span className="flex items-center gap-3">
          <span className="text-slate-500">{fmtTime(session.startedAt)}</span>
          <span className="text-slate-300">{session.platform ?? "—"}</span>
          <span className="text-slate-600">{fmtDuration(session.startedAt, session.endedAt)}</span>
        </span>
        <span className="flex items-center gap-3 tabular-nums">
          <span className="text-slate-400">{session.eventCount} évts</span>
          <span className={session.errorCount > 0 ? "text-alert" : "text-slate-600"}>{session.errorCount} err</span>
          <span className="text-slate-500">{session.apiCallCount} api</span>
        </span>
      </button>
    </li>
  );
}

const MemoSessionRow = memo(SessionRow);

function SessionDetailView({ detail, onBack }: { detail: DevSessionDetail; onBack: () => void }) {
  const [pending, setPending] = useState<DevSessionExportFormat | null>(null);

  const download = async (format: DevSessionExportFormat) => {
    setPending(format);
    try {
      await api.downloadDevSessionExport(detail.id, format);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          aria-label="Retour à la liste des sessions"
          className="rounded border border-slate-700 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-slate-300 transition-colors hover:border-nominal hover:text-nominal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nominal"
        >
          ← Sessions
        </button>
        <div className="flex gap-2">
          {EXPORTS.map(({ format, label }) => (
            <button
              key={format}
              type="button"
              onClick={() => void download(format)}
              disabled={pending === format}
              aria-label={`Télécharger ${label}`}
              className="rounded border border-slate-700 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-slate-300 transition-colors hover:border-nominal hover:text-nominal disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nominal"
            >
              {pending === format ? "…" : label}
            </button>
          ))}
        </div>
      </div>

      <dl className="grid grid-cols-4 gap-3 font-mono text-[11px] text-slate-500">
        <div>
          <dt>Démarrée</dt>
          <dd className="tabular-nums text-slate-300">{fmtTime(detail.startedAt)}</dd>
        </div>
        <div>
          <dt>Durée</dt>
          <dd className="text-slate-300">{fmtDuration(detail.startedAt, detail.endedAt)}</dd>
        </div>
        <div>
          <dt>Plateforme</dt>
          <dd className="text-slate-300">{detail.platform ?? "—"}</dd>
        </div>
        <div>
          <dt>Événements</dt>
          <dd className="tabular-nums text-slate-300">
            {detail.eventCount} ({detail.errorCount} err, {detail.apiCallCount} api)
          </dd>
        </div>
      </dl>

      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto font-mono text-xs">
        {detail.events.map((event, i) => (
          <li key={i} className="flex items-baseline gap-3 border-l-2 border-slate-800 pl-2">
            <span className="shrink-0 tabular-nums text-slate-600">{fmtTime(event.ts)}</span>
            <span className={`w-16 shrink-0 uppercase ${EVENT_TYPE_STYLE[event.type] ?? "text-slate-400"}`}>
              {event.type}
            </span>
            <span className="truncate text-slate-300">{eventSummary(event)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Onglet Developer Sessions — Developer Control Center. Liste + timeline +
 * exports. Auto-contenu (fetch propre), pas branché sur le polling Mission
 * Control : consultation ponctuelle, pas un flux temps réel.
 */
function DeveloperSessionsImpl() {
  const [sessions, setSessions] = useState<DevSessionSummary[] | null>(null);
  const [detail, setDetail] = useState<DevSessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setSessions(await api.getDevSessions());
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "NETWORK_ERROR");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const openSession = async (id: string) => {
    setError(null);
    try {
      setDetail(await api.getDevSessionDetail(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.code : "NETWORK_ERROR");
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4" aria-label="Developer Sessions">
      <div className="flex items-center justify-between">
        <h2 className="font-sans text-[11px] font-bold uppercase tracking-widest text-nominal">Developer Sessions</h2>
        {!detail ? (
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Rafraîchir la liste des sessions"
            className="rounded border border-slate-700 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-slate-300 transition-colors hover:border-nominal hover:text-nominal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nominal"
          >
            Refresh
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded border border-alert/40 bg-alert/10 px-3 py-2 font-mono text-[11px] text-alert" role="alert">
          {error}
        </p>
      ) : null}

      {detail ? (
        <SessionDetailView detail={detail} onBack={() => setDetail(null)} />
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {sessions === null ? (
            <li className="font-mono text-xs text-slate-600">Chargement…</li>
          ) : sessions.length === 0 ? (
            <li className="font-mono text-xs text-slate-600">Aucune session enregistrée</li>
          ) : (
            sessions.map((session) => (
              <MemoSessionRow key={session.id} session={session} onSelect={(id) => void openSession(id)} />
            ))
          )}
        </ul>
      )}
    </section>
  );
}

export const DeveloperSessions = memo(DeveloperSessionsImpl);
export default DeveloperSessions;
