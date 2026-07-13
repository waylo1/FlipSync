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
 * Connecteur Shopify (Admin API — produits d'une boutique vendeur) — SQUELETTE.
 * Bouchon conforme au contrat v2 : tant que le shop/token n'est pas configuré,
 * chaque opération RETOURNE CREDENTIALS_MISSING (jamais levé, jamais d'appel
 * réseau). Prix fixe uniquement — pas d'enchères sur Shopify.
 */
export class ShopifyConnector implements MarketplaceConnector {
  readonly marketplace = Marketplace.SHOPIFY
  readonly capabilities: ConnectorCapabilities = { modes: ['fixed'] }

  private readonly notConfigured: SyncFailure = {
    ok: false,
    code: SyncErrorCode.CREDENTIALS_MISSING,
    detail: 'Shopify Admin API non configurée — shop et access token absents',
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
