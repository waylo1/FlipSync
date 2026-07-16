import { ListingStatus, Marketplace } from '../generated/enums'

/**
 * Contrat marketplace — SSOT partagée api ↔ mobile ↔ @flipsync/marketplace.
 *
 * L'enum Marketplace est GÉNÉRÉE depuis schema.prisma (SSOT Prisma, ADR-007) :
 * la colonne ListingPublication.marketplace la référence en DB — plus de
 * définition manuelle ici (fix F5, puis pivot Run 3 / ADR-009). EBAY/SHOPIFY :
 * connecteurs bouchonnés (CREDENTIALS_MISSING) tant que les accès partenaires
 * ne sont pas configurés.
 */
export { Marketplace }

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

/** Résultat de publication pour une plateforme — SSOT api ↔ mobile (réponse POST /listing/:id/publish). */
export interface PublicationResult {
  marketplace: MarketplaceId
  ok: boolean
  code?: string
  url?: string | null
}

/** Réponse POST /listing/:id/publish — Jeton Global (≥1 succès ⇒ PUBLISHED, cf. publication.service.ts). */
export interface PublicationOutcome {
  status: ListingStatus
  results: PublicationResult[]
  failureReason?: string
}
