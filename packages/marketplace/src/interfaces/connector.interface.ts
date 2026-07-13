import type {
  Marketplace,
  RemoteStatusOutcome,
  SaleMode,
  SyncOutcome,
  SyncReport,
  UnifiedListing,
} from '@flipsync/core'

// ─── Contrat des connecteurs marketplace — Core Sync Engine (ADR-009) ─────────
// Un connecteur = l'UNIQUE frontière avec l'API officielle d'une plateforme.
// Règles :
//  1. Entrée = UnifiedListing (pivot agnostique) — tout mapping plateforme
//     (catégories, états, durées, formats) vit ICI et nulle part ailleurs.
//  2. Échec métier = SyncFailure RETOURNÉ, jamais levé. Une exception qui
//     s'échappe est un bug, normalisée CONNECTOR_CRASH par le moteur.
//  3. APIs partenaires officielles uniquement — jamais de scraping ni
//     d'automatisation UI (pivot conformité, cf. CLAUDE.md).
// Remplace à terme le contrat v1 (types.ts, publish seul) — exporté
// LegacyMarketplaceConnector jusqu'à migration des connecteurs LBC/Vinted.

/** Capacités déclaratives — le moteur filtre AVANT d'appeler (fail-fast sans réseau). */
export interface ConnectorCapabilities {
  /** Modes supportés — ex. eBay : fixed + auction ; Shopify/LBC/Vinted : fixed. */
  modes: readonly SaleMode[]
}

export interface MarketplaceConnector {
  readonly marketplace: Marketplace
  readonly capabilities: ConnectorCapabilities

  /**
   * Crée l'annonce sur la plateforme. L'idempotence est assurée PAR LE MOTEUR :
   * un externalId déjà persisté pour ce listingId ⇒ update(), jamais re-publish().
   */
  publish(listing: UnifiedListing): Promise<SyncOutcome>

  /** Répercute le pivot courant sur l'annonce distante existante. */
  update(externalId: string, listing: UnifiedListing): Promise<SyncOutcome>

  /** Retire l'annonce (vendue ailleurs, annulation) — succès si déjà retirée. */
  withdraw(externalId: string): Promise<SyncOutcome>

  /** Lit l'état distant normalisé — lecture seule, aucune écriture. */
  checkStatus(externalId: string): Promise<RemoteStatusOutcome>
}

/** Registre des connecteurs actifs — une entrée par plateforme activée. */
export type ConnectorRegistry = ReadonlyMap<Marketplace, MarketplaceConnector>

/**
 * Pipeline de publication multi-plateformes — pannes isolées par plateforme.
 *
 * publishMany(listing, targets) :
 *   1. GATE  !isUnifiedListingValid(listing) ⇒ INVALID_PAYLOAD pour toutes
 *      les cibles, zéro appel réseau.
 *   2. GATE  par cible : connecteur absent ⇒ CONNECTOR_UNAVAILABLE ;
 *      mode ∉ capabilities.modes ⇒ UNSUPPORTED_MODE (toujours sans réseau).
 *   3. Promise.allSettled(cibles éligibles → connector.publish(listing)) :
 *      fulfilled ⇒ outcome tel quel ; rejected ⇒ SyncFailure CONNECTOR_CRASH
 *      (retryable: false). Aucun rejet propagé — un connecteur en panne
 *      n'empêche JAMAIS une autre plateforme de publier.
 *   4. SyncReport { results par cible, complete: tous ok }. La politique
 *      produit (statut listing, remboursement partiel) se décide AU-DESSUS,
 *      côté api — jamais ici.
 */
export interface SyncPublisher {
  publishMany(listing: UnifiedListing, targets: readonly Marketplace[]): Promise<SyncReport>
}
