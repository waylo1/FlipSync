/**
 * Client HTTP → API Fastify FlipSync, scope /admin uniquement (console interne).
 * Toutes les valeurs monétaires transitent en CENTIMES (Int) — cf. CLAUDE.md.
 */
import type { AdminOverview, DevActionsState, RestartOllamaResult, SystemHealth, SystemMetrics, TunnelActionResult } from '@flipsync/core'

export const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/**
 * Token admin — obtenu hors-app (dev-token ou magic link) et collé en env local
 * (VITE_ADMIN_TOKEN). Pas d'écran de login dans cette console v1 : lecture seule,
 * réservée aux emails listés côté serveur (ADMIN_EMAILS).
 */
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? "";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(code);
    this.name = "ApiError";
  }
}

async function request<T>(path: string): Promise<T> {
  if (!ADMIN_TOKEN) throw new ApiError("NO_AUTH_TOKEN", 401);

  const res = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });

  if (!res.ok) {
    let code = "INTERNAL_ERROR";
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string") code = body.error;
    } catch {
      // corps non-JSON — on garde INTERNAL_ERROR
    }
    throw new ApiError(code, res.status);
  }

  return (await res.json()) as T;
}

/**
 * Variant pour les routes /admin/actions/* : le corps (ok/detail/tunnel) est
 * significatif même en 403/502 — pas de throw sur !res.ok, seulement sur
 * l'absence de token ou une réponse non-JSON (panne réseau réelle).
 */
async function postAction<T>(path: string): Promise<T> {
  if (!ADMIN_TOKEN) throw new ApiError("NO_AUTH_TOKEN", 401);

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });

  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError("INTERNAL_ERROR", res.status);
  }
}

export type {
  AdminOverview,
  ConnectorState,
  DevActionsState,
  OllamaStatus,
  RestartOllamaResult,
  ServiceHealth,
  ServiceStatus,
  SystemHealth,
  SystemMetrics,
  TunnelActionResult,
  TunnelStatus,
} from "@flipsync/core";

export const api = {
  getOverview: () => request<AdminOverview>("/admin/overview"),
  getHealth: () => request<SystemHealth>("/admin/health"),
  getMetrics: () => request<SystemMetrics>("/admin/metrics"),
  getDevActionsStatus: () => request<DevActionsState>("/admin/actions/status"),
  restartOllama: () => postAction<RestartOllamaResult>("/admin/actions/restart-ollama"),
  startTunnel: () => postAction<TunnelActionResult>("/admin/actions/start-tunnel"),
  stopTunnel: () => postAction<TunnelActionResult>("/admin/actions/stop-tunnel"),
};
