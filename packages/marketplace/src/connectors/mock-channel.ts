import { Marketplace } from '@flipsync/core'
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

// ─── C3.2 — première implémentation concrète du port ChannelConnector ─────────
// Preuve que le port (C3.1, ADAPTER-CONTRACT §3) est implémentable tel quel,
// SANS l'étendre. DORMANT : aucun appelant (CoreSyncPublisher, PublicationService,
// registre) ne référence cette classe. N'implémente PAS le contrat legacy
// (`MarketplaceConnector` — types.ts ou interfaces/connector.interface.ts) :
// signatures de `publish` incompatibles entre v1/v2 et le port complet (retours
// différents), donc classe séparée plutôt que double-implémentation forcée.
// Comportement inchangé du pivot v1/v2 actuel — zéro câblage.
export class MockChannelConnector implements ChannelConnector {
  readonly channel = Marketplace.VINTED
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

  precheck(_listing: CanonicalListing, _seller: SellerContext): Eligibility {
    return { eligible: true }
  }

  async publish(_listing: CanonicalListing, _credentials: ChannelCredentials): Promise<PublishOutcome> {
    const externalId = `mock-channel-${this.channel.toLowerCase()}-${Date.now()}`
    return {
      status: 'PUBLISHED',
      externalId,
      url: `https://mock.flipsync.local/${this.channel.toLowerCase()}/${externalId}`,
    }
  }

  async update(
    _ref: PublicationRef,
    _listing: CanonicalListing,
    _credentials: ChannelCredentials,
  ): Promise<OpOutcome> {
    return { ok: true }
  }

  async retract(
    _ref: PublicationRef,
    _credentials: ChannelCredentials,
    _why: RetractReason,
  ): Promise<OpOutcome> {
    return { ok: true }
  }

  parseEvent(_raw: unknown): NormalizedChannelEvent | null {
    return null
  }
}
