/**
 * Contrat GET /marketplace/status — SSOT partagée api ↔ mobile.
 *
 * Identifiants plateforme en littéraux (pas d'import de l'enum Marketplace :
 * @flipsync/marketplace dépend de core, l'inverse créerait un cycle). Les
 * valeurs sont le miroir exact de l'enum Marketplace du package marketplace.
 */

export type MarketplaceId = 'VINTED' | 'LEBONCOIN'

/**
 * État de connexion d'une plateforme, dérivé de mesures réelles :
 * - DISCONNECTED : aucun credential partenaire configuré.
 * - EXPIRED      : credential présent mais expiration atteinte (jamais envoyé).
 * - AUTH_ERROR   : la plateforme a refusé le credential (HTTP 401/403) au
 *                  dernier publish — effacé au prochain publish réussi.
 * - CONNECTED    : credential présent, utilisable, non refusé.
 */
export type MarketplaceConnectionState = 'CONNECTED' | 'DISCONNECTED' | 'EXPIRED' | 'AUTH_ERROR'

export interface MarketplaceConnection {
  marketplace: MarketplaceId
  state: MarketplaceConnectionState
  /** true si MARKETPLACE_MOCK force des publications simulées (dev uniquement). */
  mock: boolean
  /** Code SNAKE_CASE du dernier refus d'auth (ex: VINTED_HTTP_401) — null sinon. */
  detail: string | null
}

export interface MarketplaceStatusResponse {
  connections: MarketplaceConnection[]
}
