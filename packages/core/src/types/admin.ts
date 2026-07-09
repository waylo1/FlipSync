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
