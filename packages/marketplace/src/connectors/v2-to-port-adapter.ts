import type { SyncOutcome } from '@flipsync/core'
import type { MarketplaceConnector } from '../interfaces/connector.interface'
import type {
  CanonicalListing,
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
} from '../interfaces/channel-connector.interface'

// TODO: Détruire après refonte totale (C3) — adaptateur de TRANSITION uniquement.
// Fait entrer un connecteur v2 (ADR-009, interfaces/connector.interface.ts) dans
// le pipeline `ChannelConnector` sans le réécrire, le temps que Shopify/Vinted/
// Leboncoin migrent nativement (comme eBay en C3.3). Ne PAS utiliser pour un
// nouveau connecteur : un connecteur neuf implémente `ChannelConnector`
// directement (cf. ebay.ts).
//
// `ChannelCapabilities` best-effort : le contrat v2 ne porte que `modes`
// (SaleMode[]), pas les colonnes de la matrice §4 (transport, negotiation,
// productRef, seller, retractSla…). Valeurs ci-dessous = placeholders
// conservateurs, PAS des données vérifiées par connecteur — à corriger au
// moment de la migration native de chacun.
function toOpOutcome(outcome: SyncOutcome): OpOutcome {
  if (outcome.ok) return { ok: true }
  return { ok: false, kind: outcome.retryable ? 'TRANSIENT' : 'PERMANENT', code: outcome.code }
}

export class V2ToPortAdapter implements ChannelConnector {
  readonly channel: ChannelConnector['channel']
  readonly capabilities: ChannelCapabilities = {
    kind: 'MP',
    transport: 'direct',
    negotiation: 'NONE',
    publishMode: 'SYNC',
    photosPerso: false,
    productRef: false,
    seller: 'both',
    retractSla: null,
  }

  constructor(private readonly delegate: MarketplaceConnector) {
    this.channel = delegate.marketplace
  }

  precheck(listing: CanonicalListing, _seller: SellerContext): Eligibility {
    if (!this.delegate.capabilities.modes.includes(listing.mode)) {
      return {
        eligible: false,
        reasons: [`${this.delegate.marketplace} ne supporte pas le mode ${listing.mode}`],
      }
    }
    return { eligible: true }
  }

  async publish(listing: CanonicalListing, _credentials: ChannelCredentials): Promise<PublishOutcome> {
    const outcome = await this.delegate.publish(listing)
    if (outcome.ok) return { status: 'PUBLISHED', externalId: outcome.externalId, url: outcome.url }
    return { status: 'FAILED', kind: outcome.retryable ? 'TRANSIENT' : 'PERMANENT', code: outcome.code }
  }

  async update(
    ref: PublicationRef,
    listing: CanonicalListing,
    _credentials: ChannelCredentials,
  ): Promise<OpOutcome> {
    const outcome = await this.delegate.update(ref.externalId, listing)
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

  /** Aucun connecteur v2 actuel n'expose de webhook/poll normalisé. */
  parseEvent(_raw: unknown): NormalizedChannelEvent | null {
    return null
  }
}
