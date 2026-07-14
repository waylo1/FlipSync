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
  ChannelConnector,
  ChannelConnectorRegistry,
  PublishOutcome,
} from './interfaces/channel-connector.interface'

/** Pipeline de publication multi-plateformes — pannes isolées par plateforme (C3). */
export interface SyncPublisher {
  publishMany(listing: UnifiedListing, targets: readonly Marketplace[]): Promise<SyncReport>
}

const failure = (code: SyncErrorCode, detail: string): SyncFailure => ({
  ok: false,
  code,
  detail,
  retryable: false,
})

/** `outcome.code` du port est une string libre (SNAKE_CASE) — round-trip sûr
 *  uniquement si elle correspond à une valeur connue de l'union fermée `SyncErrorCode` ;
 *  sinon repli générique REMOTE_REJECTED (jamais d'invention d'un nouveau code). */
export function isKnownSyncErrorCode(code: string): code is SyncErrorCode {
  return (Object.values(SyncErrorCode) as string[]).includes(code)
}

/** Traduit `PublishOutcome` (port, ADAPTER-CONTRACT §3) → `SyncOutcome` (Core Sync
 *  Engine v2, contrat de sortie inchangé consommé par publication.service.ts/DB). */
export function publishOutcomeToSyncOutcome(outcome: PublishOutcome): SyncOutcome {
  switch (outcome.status) {
    case 'PUBLISHED':
      return { ok: true, externalId: outcome.externalId, url: outcome.url }
    case 'FAILED':
      return {
        ok: false,
        code: isKnownSyncErrorCode(outcome.code) ? outcome.code : SyncErrorCode.REMOTE_REJECTED,
        detail: outcome.code,
        retryable: outcome.kind === 'TRANSIENT',
      }
    case 'SUBMITTED':
      // Gap connu, non résolu ici (cf. rapport C3.4) : aucun connecteur async
      // (publishMode ASYNC) n'est migré à ce jour — le Core Sync Engine v2
      // (SyncOutcome) n'a pas de représentation "publication en cours".
      return {
        ok: false,
        code: SyncErrorCode.CONNECTOR_UNAVAILABLE,
        detail: `SUBMITTED (${outcome.submissionRef}) — publication asynchrone non supportée par le Core Sync Engine v2`,
        retryable: false,
      }
  }
}

/** Cible éligible (gates passés) ou échec immédiat — décidé SANS réseau. */
type Slot =
  | { marketplace: Marketplace; outcome: SyncFailure }
  | { marketplace: Marketplace; connector: ChannelConnector }

/**
 * Moteur de publication multi-plateformes (ADR-009, migré C3 sur le port
 * `ChannelConnector` — ADAPTER-CONTRACT §3) — pur, sans persistance : la
 * politique produit (Jeton Global : ≥1 succès ⇒ PUBLISHED sans refund, 0 succès
 * ⇒ PUBLISH_FAILED + refund total) se lit dans le SyncReport côté api (Run 3) —
 * `complete` pour le 100%, `results.some(ok)` pour le ≥1. Sortie (`SyncReport`)
 * INCHANGÉE : c'est le contrat consommé par publication.service.ts/DB, hors
 * périmètre ADAPTER-CONTRACT.
 */
export class CoreSyncPublisher implements SyncPublisher {
  constructor(private readonly registry: ChannelConnectorRegistry) {}

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

    // GATE 2 — par cible, toujours sans réseau : connecteur présent + precheck()
    // éligible (le port déplace le filtrage — ex. mode de vente — DANS chaque
    // connecteur, cf. ChannelConnector.precheck ; aucun contexte vendeur encore
    // câblé ici → SellerContext = undefined, cf. Q4/Q6 MASTER-REMED).
    const slots: Slot[] = targets.map(marketplace => {
      const connector = this.registry.get(marketplace)
      if (!connector) {
        return {
          marketplace,
          outcome: failure(SyncErrorCode.CONNECTOR_UNAVAILABLE, `aucun connecteur enregistré pour ${marketplace}`),
        }
      }
      const eligibility = connector.precheck(listing, undefined)
      if (!eligibility.eligible) {
        return {
          marketplace,
          outcome: failure(SyncErrorCode.UNSUPPORTED_MODE, eligibility.reasons.join(' | ')),
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
      (s): s is Extract<Slot, { connector: ChannelConnector }> => 'connector' in s,
    )
    const settled = await Promise.allSettled(
      eligible.map(s => Promise.resolve().then(() => s.connector.publish(listing, undefined))),
    )

    let cursor = 0
    const results: MarketplaceSyncResult[] = slots.map(slot => {
      if ('outcome' in slot) return { marketplace: slot.marketplace, outcome: slot.outcome }
      const entry = settled[cursor++]
      const outcome: SyncOutcome =
        entry === undefined
          ? failure(SyncErrorCode.CONNECTOR_CRASH, 'résultat allSettled manquant')
          : entry.status === 'fulfilled'
            ? publishOutcomeToSyncOutcome(entry.value)
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
