import type { SyncOutcome, UnifiedListing } from '@flipsync/core'
import { Marketplace } from '@flipsync/core'
import { EbayConnector } from './ebay'
import type {
  ChannelCapabilities,
  ChannelConnector,
  ChannelCredentials,
  Eligibility,
  NormalizedChannelEvent,
  OpOutcome,
  PublicationRef,
  PublishOutcome,
  RetractReason,
  SellerContext,
  CanonicalListing,
} from '../interfaces/channel-connector.interface'

// ─── C3.3 — première implémentation du port adossée à un connecteur RÉEL ──────
// Wrapper additif et DORMANT autour d'`EbayConnector` (contrat v2, ADR-009,
// inchangé, toujours seul câblé sur CoreSyncPublisher/PublicationService).
// Ne réimplémente aucun appel HTTP : délègue à EbayConnector et traduit
// SyncOutcome → PublishOutcome/OpOutcome (formes du port complet, ADAPTER-
// CONTRACT §3). Nécessaire car les signatures `publish` diffèrent entre le
// contrat v2 (SyncOutcome) et le port complet (PublishOutcome) — une classe ne
// peut porter les deux formes pour la même méthode (cf. C3.2, mock-channel.ts).
// `update`/`retract`/`checkStatus` d'EbayConnector v1 sont volontairement
// limités (CONNECTOR_UNAVAILABLE) — traduits tels quels, aucune logique ajoutée.
function toOpOutcome(outcome: SyncOutcome): OpOutcome {
  if (outcome.ok) return { ok: true }
  return { ok: false, kind: outcome.retryable ? 'TRANSIENT' : 'PERMANENT', code: outcome.code }
}

export class EbayChannelConnector implements ChannelConnector {
  readonly channel = Marketplace.EBAY
  readonly capabilities: ChannelCapabilities = {
    kind: 'MP',
    transport: 'direct',
    // D4/D2 — pas de Best Offer côté v1 (Inventory API, prix fixe uniquement).
    negotiation: 'NONE',
    publishMode: 'SYNC',
    photosPerso: false,
    productRef: false,
    seller: 'both',
    retractSla: null,
  }

  constructor(private readonly delegate: EbayConnector = new EbayConnector()) {}

  precheck(_listing: CanonicalListing, _seller: SellerContext): Eligibility {
    return { eligible: true }
  }

  async publish(listing: CanonicalListing, _credentials: ChannelCredentials): Promise<PublishOutcome> {
    const outcome = await this.delegate.publish(listing as UnifiedListing)
    if (outcome.ok) {
      return { status: 'PUBLISHED', externalId: outcome.externalId, url: outcome.url ?? '' }
    }
    return { status: 'FAILED', kind: outcome.retryable ? 'TRANSIENT' : 'PERMANENT', code: outcome.code }
  }

  async update(
    _ref: PublicationRef,
    listing: CanonicalListing,
    _credentials: ChannelCredentials,
  ): Promise<OpOutcome> {
    const outcome = await this.delegate.update(_ref.externalId, listing as UnifiedListing)
    return toOpOutcome(outcome)
  }

  async retract(
    ref: PublicationRef,
    _credentials: ChannelCredentials,
    _why: RetractReason,
  ): Promise<OpOutcome> {
    const outcome = await this.delegate.withdraw(ref.externalId)
    return toOpOutcome(outcome)
  }

  /** eBay v1 : aucun webhook/poll câblé — aucun événement à normaliser. */
  parseEvent(_raw: unknown): NormalizedChannelEvent | null {
    return null
  }
}
