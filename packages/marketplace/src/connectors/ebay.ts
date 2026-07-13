import {
  Marketplace,
  SyncErrorCode,
  type RemoteStatusOutcome,
  type SyncFailure,
  type SyncOutcome,
  type UnifiedListing,
} from '@flipsync/core'
import type { ConnectorCapabilities, MarketplaceConnector } from '../interfaces/connector.interface'

/**
 * Connecteur eBay (Sell API / Inventory API) — SQUELETTE.
 * Bouchon conforme au contrat v2 : tant que les credentials partenaires ne
 * sont pas configurés, chaque opération RETOURNE CREDENTIALS_MISSING (jamais
 * levé, jamais d'appel réseau). Seule plateforme à supporter le mode auction.
 */
export class EbayConnector implements MarketplaceConnector {
  readonly marketplace = Marketplace.EBAY
  readonly capabilities: ConnectorCapabilities = { modes: ['fixed', 'auction'] }

  private readonly notConfigured: SyncFailure = {
    ok: false,
    code: SyncErrorCode.CREDENTIALS_MISSING,
    detail: 'eBay Sell API non configurée — en attente des credentials partenaires',
    retryable: false,
  }

  async publish(_listing: UnifiedListing): Promise<SyncOutcome> {
    return this.notConfigured
  }

  async update(_externalId: string, _listing: UnifiedListing): Promise<SyncOutcome> {
    return this.notConfigured
  }

  async withdraw(_externalId: string): Promise<SyncOutcome> {
    return this.notConfigured
  }

  async checkStatus(_externalId: string): Promise<RemoteStatusOutcome> {
    return this.notConfigured
  }
}
