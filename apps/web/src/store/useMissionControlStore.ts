import { create } from "zustand";
import { api, ApiError, type AdminOverview } from "../services/api";

export type AgentStatus = "NOMINAL" | "WATCH" | "ALERT";

export interface AgentMetric {
  key: string;
  value: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  status: AgentStatus;
  currentTask: string;
  metrics: AgentMetric[];
}

export type LogLevel = "nominal" | "warning" | "alert";

export interface SystemLog {
  id: string;
  time: string;
  source: string;
  message: string;
  level: LogLevel;
}

export interface AlertP1 {
  id: string;
  agent: string;
  message: string;
  time: string;
}

/** AI_PROCESSING profond ou taux d'échec IA élevé → surveiller Orion. */
const AI_PROCESSING_WATCH_THRESHOLD = 5;
const AI_FAILED_WATCH_THRESHOLD = 3;

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Dérive les 6 cartes agent depuis les métriques réelles /admin/overview. */
function buildAgents(overview: AdminOverview): Agent[] {
  const { listings, ai, marketplace, wallet } = overview;

  const orionStatus: AgentStatus =
    ai.failed24h >= AI_FAILED_WATCH_THRESHOLD || ai.processing >= AI_PROCESSING_WATCH_THRESHOLD
      ? "WATCH"
      : "NOMINAL";

  const novaHasIssue = marketplace.vinted === "MISSING" || marketplace.leboncoin === "MISSING";
  const novaStatus: AgentStatus = novaHasIssue
    ? "ALERT"
    : marketplace.vinted === "MOCK" || marketplace.leboncoin === "MOCK"
      ? "WATCH"
      : "NOMINAL";

  return [
    {
      id: "atlas",
      name: "ATLAS",
      role: "Orchestrateur listings",
      description: "Pilote la machine à états ListingStatus, de PENDING_AUTH à PUBLISHED.",
      status: listings.total > 0 ? "NOMINAL" : "WATCH",
      currentTask: `${listings.byStatus.QUEUED ?? 0} en file, ${listings.byStatus.PUBLISHED ?? 0} publiées`,
      metrics: [
        { key: "Draft_Ready", value: String(listings.byStatus.DRAFT_READY ?? 0) },
        { key: "Queued", value: String(listings.byStatus.QUEUED ?? 0) },
        { key: "Publiées", value: String(listings.byStatus.PUBLISHED ?? 0) },
        { key: "AI_Failed", value: String(listings.byStatus.AI_FAILED ?? 0) },
      ],
    },
    {
      id: "vega",
      name: "VEGA",
      role: "Ingestion photos",
      description: "Reçoit les photos mobiles (resize 768px), vérifie le sha256 côté serveur.",
      status: "NOMINAL",
      currentTask: `${listings.byStatus.AUTHORIZED ?? 0} en attente de photos`,
      metrics: [
        { key: "Authorized", value: String(listings.byStatus.AUTHORIZED ?? 0) },
        { key: "Pending_Auth", value: String(listings.byStatus.PENDING_AUTH ?? 0) },
        { key: "Total listings", value: String(listings.total) },
        { key: "SHA256", value: "vérifié serveur" },
      ],
    },
    {
      id: "orion",
      name: "ORION",
      role: "Vision IA",
      description: "POST /ai/draft — Ollama qwen2.5vl:3b, sortie ListingDraft Zod.",
      status: orionStatus,
      currentTask: `${ai.processing} en traitement`,
      metrics: [
        { key: "AI_Processing", value: String(ai.processing) },
        { key: "Échecs 24h", value: String(ai.failed24h) },
        { key: "Draft_Ready", value: String(listings.byStatus.DRAFT_READY ?? 0) },
        { key: "Modèle", value: "qwen2.5vl:3b" },
      ],
    },
    {
      id: "lyra",
      name: "LYRA",
      role: "Auth magic link",
      description: "Envoi et vérification des magic links — token sha256 usage unique + TTL.",
      status: "NOMINAL",
      currentTask: "File d'envoi emails",
      metrics: [
        { key: "TTL", value: "15 min" },
        { key: "Usage", value: "unique" },
        { key: "Hash", value: "sha256" },
        { key: "Dev bypass", value: "hors prod" },
      ],
    },
    {
      id: "nova",
      name: "NOVA",
      role: "Publication marketplace",
      description: "Connecteurs officiels Vinted Pro & Leboncoin Partenaire via @flipsync/marketplace.",
      status: novaStatus,
      currentTask: novaHasIssue ? "Publish bloqué — credentials" : "Publication active",
      metrics: [
        { key: "Vinted", value: marketplace.vinted },
        { key: "Leboncoin", value: marketplace.leboncoin },
        { key: "Publish_Failed 24h", value: String(marketplace.publishFailed24h) },
        { key: "Published", value: String(listings.byStatus.PUBLISHED ?? 0) },
      ],
    },
    {
      id: "rhea",
      name: "RHEA",
      role: "Wallet & Stripe",
      description: "Authorize / commit en centimes, remboursement auto sur AI_FAILED et PUBLISH_FAILED.",
      status: "NOMINAL",
      currentTask: "Commits post USER_VALIDATED",
      metrics: [
        { key: "Solde total", value: `${wallet.totalBalance} c` },
        { key: "Débité 24h", value: `${wallet.debited24h} c` },
        { key: "Remboursé 24h", value: `${wallet.refunded24h} c` },
        { key: "Devise", value: "centimes" },
      ],
    },
  ];
}

function buildLogs(overview: AdminOverview): SystemLog[] {
  const { health, ai, marketplace, wallet } = overview;
  const now = timeLabel(health.ts);
  const logs: SystemLog[] = [
    { id: "health", time: now, source: "Atlas", message: `Healthcheck : ${health.status}`, level: "nominal" },
  ];

  if (ai.failed24h > 0) {
    logs.push({
      id: "ai-failed",
      time: now,
      source: "Orion",
      message: `${ai.failed24h} échec(s) IA sur les dernières 24h`,
      level: ai.failed24h >= AI_FAILED_WATCH_THRESHOLD ? "alert" : "warning",
    });
  } else {
    logs.push({ id: "ai-ok", time: now, source: "Orion", message: "Aucun échec IA sur 24h", level: "nominal" });
  }

  if (marketplace.publishFailed24h > 0) {
    logs.push({
      id: "publish-failed",
      time: now,
      source: "Nova",
      message: `${marketplace.publishFailed24h} publication(s) échouée(s) sur 24h`,
      level: "alert",
    });
  }

  logs.push({
    id: "wallet",
    time: now,
    source: "Rhea",
    message: `${wallet.debited24h} c débités, ${wallet.refunded24h} c remboursés (24h)`,
    level: "nominal",
  });

  return logs;
}

function buildAlerts(overview: AdminOverview): AlertP1[] {
  const { marketplace, ai } = overview;
  const alerts: AlertP1[] = [];
  const now = timeLabel(overview.health.ts);

  if (marketplace.vinted === "MISSING") {
    alerts.push({ id: "P1-vinted", agent: "Nova", message: "Credentials Vinted manquants — publication bloquée", time: now });
  }
  if (marketplace.leboncoin === "MISSING") {
    alerts.push({ id: "P1-lbc", agent: "Nova", message: "Credentials Leboncoin manquants — publication bloquée", time: now });
  }
  if (ai.failed24h >= AI_FAILED_WATCH_THRESHOLD) {
    alerts.push({ id: "P1-ai", agent: "Orion", message: `Taux d'échec IA élevé (${ai.failed24h} sur 24h)`, time: now });
  }

  return alerts;
}

/** Rythme par défaut du panel Logs/Alertes si l'appelant n'en précise pas. */
export const DEFAULT_POLL_INTERVAL_MS = 15_000;

interface MissionControlState {
  overview: AdminOverview | null;
  agents: Agent[];
  logs: SystemLog[];
  alerts: AlertP1[];
  loading: boolean;
  error: string | null;
  /** Id renvoyé par setInterval — null si aucun polling actif (cf. stopPolling). */
  intervalId: ReturnType<typeof setInterval> | null;
  /** silent=true (poll de fond) : ne touche pas `loading`, les données affichées restent stables. */
  fetchAgents: (silent?: boolean) => Promise<void>;
  /** Premier fetch immédiat + refetch toutes les intervalMs. Ré-appeler remplace le polling en cours. */
  startPolling: (intervalMs: number) => void;
  /** Coupe le polling en cours (clearInterval) — no-op si aucun n'est actif. */
  stopPolling: () => void;
}

export const useMissionControlStore = create<MissionControlState>()((set, get) => ({
  overview: null,
  agents: [],
  logs: [],
  alerts: [],
  loading: false,
  error: null,
  intervalId: null,
  fetchAgents: async (silent = false) => {
    if (!silent) set({ loading: true, error: null });
    try {
      const overview = await api.getOverview();
      set({
        overview,
        agents: buildAgents(overview),
        logs: buildLogs(overview),
        alerts: buildAlerts(overview),
        loading: false,
        error: null,
      });
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "NETWORK_ERROR";
      // Poll silencieux : on garde les données déjà affichées, seule l'erreur est notée.
      set({ error: code, loading: false });
    }
  },
  startPolling: (intervalMs: number) => {
    // Évite d'empiler plusieurs setInterval si startPolling est rappelé (ex: changement de rythme).
    get().stopPolling();
    void get().fetchAgents(false);
    const intervalId = setInterval(() => void get().fetchAgents(true), intervalMs);
    set({ intervalId });
  },
  stopPolling: () => {
    const { intervalId } = get();
    if (intervalId !== null) {
      clearInterval(intervalId);
      set({ intervalId: null });
    }
  },
}));
