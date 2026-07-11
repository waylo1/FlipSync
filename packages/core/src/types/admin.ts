/**
 * Contrat GET /admin/overview — SSOT partagée api ↔ web. Ne jamais recopier ces
 * types côté front : la console Mission Control (apps/web) doit importer ceux-ci
 * plutôt que retaper le payload à la main (cf. TECH_GOVERNANCE.md §1/§3).
 */

/**
 * État connecteur côté admin — MISSING/EXPIRED/AUTH_ERROR bloquent la
 * publication (alerte P1 Mission Control), MOCK = simulé (dev), LIVE = opérationnel.
 */
export type ConnectorState = 'MISSING' | 'MOCK' | 'LIVE' | 'EXPIRED' | 'AUTH_ERROR'

export interface AdminOverview {
  health: { status: 'ok'; ts: string }
  listings: { byStatus: Record<string, number>; total: number }
  ai: { processing: number; failed24h: number }
  marketplace: { vinted: ConnectorState; leboncoin: ConnectorState; publishFailed24h: number }
  wallet: { totalBalance: number; debited24h: number; refunded24h: number }
}

/**
 * Contrat GET /admin/health — état RÉEL des dépendances (pings live), pas un
 * statut décoratif. `down` = mesuré injoignable ; `warning` = dégradé/non vérifié
 * (ex: clé Stripe de test) ; `healthy` = ping OK.
 */
export type ServiceStatus = 'healthy' | 'warning' | 'down'

export interface ServiceHealth {
  id: string
  label: string
  status: ServiceStatus
  /** Latence du ping en ms (absente si le service n'est pas pingé ou est down). */
  latencyMs?: number
  detail?: string
}

export interface SystemHealth {
  ts: string
  overall: ServiceStatus
  /** Score 0–100 dérivé de l'état réel des services (formule côté serveur). */
  score: number
  services: ServiceHealth[]
}

/**
 * Contrat GET /admin/metrics — mesures RÉELLES du process Node (pas de simulation).
 * Trafic agrégé depuis le démarrage du process (reset au redémarrage — acceptable,
 * pas d'historique persistant en V1).
 */
export interface SystemMetrics {
  ts: string
  uptimeSec: number
  version: string
  process: {
    /** % d'usage CPU du process sur la fenêtre de mesure (0-100, peut dépasser 100 en multi-cœur). */
    cpuPercent: number
    memoryUsedMb: number
    memoryTotalMb: number
  }
  traffic: {
    requestCount: number
    errorCount: number
    /** Requêtes/min glissantes (fenêtre 60s). */
    requestsPerMinute: number
    p50LatencyMs: number
    p95LatencyMs: number
  }
}

/**
 * Contrat POST /admin/services/:id/restart — action déclenchée manuellement depuis
 * le dashboard. `started` confirme uniquement que la commande a été lancée, pas
 * que le service est sain (relire GET /admin/health juste après pour confirmer).
 */
export interface ServiceRestartResult {
  started: boolean
  detail: string
}

/**
 * Contrat GET /admin/actions/status — état des « Developer Actions », section
 * réservée au dev local (jamais en production). `enabled` reflète NODE_ENV côté
 * serveur ; le front doit masquer la section entière si `enabled` est faux.
 */
export interface DevActionsState {
  enabled: boolean
  ollama: OllamaStatus
  tunnel: TunnelStatus
}

export interface OllamaStatus {
  running: boolean
  version: string | null
  model: string
}

export interface TunnelStatus {
  active: boolean
  url: string | null
}

/** Contrat POST /admin/actions/restart-ollama. */
export interface RestartOllamaResult {
  ok: boolean
  detail: string
}

/** Contrat POST /admin/actions/start-tunnel | stop-tunnel. */
export interface TunnelActionResult {
  ok: boolean
  detail: string
  tunnel: TunnelStatus
}
