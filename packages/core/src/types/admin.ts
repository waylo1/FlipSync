/**
 * Contrat GET /admin/overview — SSOT partagée api ↔ web. Ne jamais recopier ces
 * types côté front : la console Mission Control (apps/web) doit importer ceux-ci
 * plutôt que retaper le payload à la main (cf. TECH_GOVERNANCE.md §1/§3).
 */

export type ConnectorState = 'MISSING' | 'MOCK' | 'LIVE'

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
