/**
 * Contrat marketplace — SSOT partagée api ↔ mobile ↔ @flipsync/marketplace.
 *
 * L'enum Marketplace vit ICI (core, zéro dépendance runtime) et
 * @flipsync/marketplace la ré-exporte — une seule définition des plateformes,
 * plus de miroir manuel (fix F5, FLIPSYNC-AUDIT.md).
 */

/**
 * Plateformes de revente supportées par les connecteurs officiels.
 * EBAY/SHOPIFY : Core Sync Engine (ADR-009) — connecteurs bouchonnés
 * (CREDENTIALS_MISSING) tant que les accès partenaires ne sont pas configurés.
 */
export enum Marketplace {
  LEBONCOIN = 'LEBONCOIN',
  VINTED = 'VINTED',
  EBAY = 'EBAY',
  SHOPIFY = 'SHOPIFY',
}

/** Union littérale dérivée de l'enum — comparaisons de chaînes côté mobile. */
export type MarketplaceId = `${Marketplace}`

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
