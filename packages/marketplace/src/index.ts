export { MarketplaceClient } from './client'
export { VintedConnector } from './connectors/vinted'
export { LeboncoinConnector } from './connectors/leboncoin'
export { EbayConnector } from './connectors/ebay'
export { ShopifyConnector } from './connectors/shopify'
export { MockMarketplacePublisher, MockPublishLogEntry } from './connectors/mock'
export { V2ToPortAdapter } from './connectors/v2-to-port-adapter'
export { CoreSyncPublisher, isKnownSyncErrorCode, publishOutcomeToSyncOutcome } from './sync-publisher'
export { LegacyConnectorAdapter, LegacyConnectorAdapterDeps, LegacyCredentialResolution } from './connectors/legacy-adapter'
export { formatPrice, priceToDecimal } from './format'
export {
  Marketplace,
  ListingPayload,
  MarketplaceCredentials,
  // Contrat v1 (publish seul) — remplacé par MarketplaceConnector v2 (ADR-009),
  // alias conservé jusqu'à migration des connecteurs LBC/Vinted.
  MarketplaceConnector as LegacyMarketplaceConnector,
  PublishResult,
} from './types'
export * from './interfaces/connector.interface'
export * from './interfaces/channel-connector.interface'
