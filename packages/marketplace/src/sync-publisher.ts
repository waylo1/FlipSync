import {
  isUnifiedListingValid,
  SyncErrorCode,
  type Marketplace,
  type MarketplaceSyncResult,
  type SyncFailure,
  type SyncOutcome,
  type SyncReport,
  type UnifiedListing,
} from '@flipsync/core'
import type {
  ConnectorRegistry,
  MarketplaceConnector,
  SyncPublisher,
} from './interfaces/connector.interface'

const failure = (code: SyncErrorCode, detail: string): SyncFailure => ({
  ok: false,
  code,
  detail,
  retryable: false,
})

/** Cible éligible (gates passés) ou échec immédiat — décidé SANS réseau. */
type Slot =
  | { marketplace: Marketplace; outcome: SyncFailure }
  | { marketplace: Marketplace; connector: MarketplaceConnector }

/**
 * Moteur de publication multi-plateformes (ADR-009) — pur, sans persistance :
 * la politique produit (Jeton Global : ≥1 succès ⇒ PUBLISHED sans refund,
 * 0 succès ⇒ PUBLISH_FAILED + refund total) se lit dans le SyncReport côté
 * api (Run 3) — `complete` pour le 100%, `results.some(ok)` pour le ≥1.
 */
export class CoreSyncPublisher implements SyncPublisher {
  constructor(private readonly registry: ConnectorRegistry) {}

  async publishMany(
    listing: UnifiedListing,
    targets: readonly Marketplace[],
  ): Promise<SyncReport> {
    // GATE 1 — invariants pivot : échec pour TOUTES les cibles, zéro réseau.
    if (!isUnifiedListingValid(listing)) {
      return this.report(
        listing.listingId,
        targets.map(marketplace => ({
          marketplace,
          outcome: failure(SyncErrorCode.INVALID_PAYLOAD, 'invariants pivot violés (isUnifiedListingValid)'),
        })),
      )
    }

    // GATE 2 — par cible, toujours sans réseau : connecteur présent + mode supporté.
    const slots: Slot[] = targets.map(marketplace => {
      const connector = this.registry.get(marketplace)
      if (!connector) {
        return {
          marketplace,
          outcome: failure(SyncErrorCode.CONNECTOR_UNAVAILABLE, `aucun connecteur enregistré pour ${marketplace}`),
        }
      }
      if (!connector.capabilities.modes.includes(listing.mode)) {
        return {
          marketplace,
          outcome: failure(SyncErrorCode.UNSUPPORTED_MODE, `${marketplace} ne supporte pas le mode ${listing.mode}`),
        }
      }
      return { marketplace, connector }
    })

    // Pannes isolées : allSettled — un connecteur qui THROW (bug, sync OU
    // async) devient CONNECTOR_CRASH et n'empêche aucune autre plateforme de
    // publier. Promise.resolve().then(...) capture aussi un throw synchrone
    // (un connecteur mal écrit qui ne respecte pas son type Promise<...>) —
    // sans ce wrapper, ce throw s'échapperait de .map() avant même d'atteindre
    // allSettled.
    const eligible = slots.filter(
      (s): s is Extract<Slot, { connector: MarketplaceConnector }> => 'connector' in s,
    )
    const settled = await Promise.allSettled(
      eligible.map(s => Promise.resolve().then(() => s.connector.publish(listing))),
    )

    let cursor = 0
    const results: MarketplaceSyncResult[] = slots.map(slot => {
      if ('outcome' in slot) return { marketplace: slot.marketplace, outcome: slot.outcome }
      const entry = settled[cursor++]
      const outcome: SyncOutcome =
        entry === undefined
          ? failure(SyncErrorCode.CONNECTOR_CRASH, 'résultat allSettled manquant')
          : entry.status === 'fulfilled'
            ? entry.value
            : failure(SyncErrorCode.CONNECTOR_CRASH, String(entry.reason))
      return { marketplace: slot.marketplace, outcome }
    })

    return this.report(listing.listingId, results)
  }

  /** `complete` exige AU MOINS une cible : publier vers zéro plateforme n'est jamais un succès. */
  private report(listingId: string, results: readonly MarketplaceSyncResult[]): SyncReport {
    return {
      listingId,
      results,
      complete: results.length > 0 && results.every(r => r.outcome.ok),
    }
  }
}
