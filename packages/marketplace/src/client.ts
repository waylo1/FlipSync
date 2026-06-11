import {
  ListingPayload,
  Marketplace,
  MarketplaceConnector,
  MarketplaceCredentials,
  PublishResult,
} from './types'
import { VintedConnector } from './connectors/vinted'
import { LeboncoinConnector } from './connectors/leboncoin'

/**
 * MarketplaceClient — façade unique de publication, routeur vers les
 * connecteurs officiels. Le code applicatif (ListingEngine / API) ne dépend
 * que de cette classe, jamais d'un connecteur en particulier.
 *
 * Substituer un connecteur par un mock en test : passer un Map au constructeur.
 */
export class MarketplaceClient {
  private readonly connectors: ReadonlyMap<Marketplace, MarketplaceConnector>

  constructor(connectors?: Iterable<MarketplaceConnector>) {
    const list = connectors ?? [new VintedConnector(), new LeboncoinConnector()]
    this.connectors = new Map(Array.from(list, c => [c.marketplace, c]))
  }

  supports(marketplace: Marketplace): boolean {
    return this.connectors.has(marketplace)
  }

  /**
   * Publie une annonce sur la plateforme cible via son connecteur officiel.
   * Ne lève jamais : tout échec est un PublishResult { ok:false, code } que
   * l'appelant mappe en PUBLISH_FAILED + remboursement.
   */
  async publish(
    marketplace: Marketplace,
    payload: ListingPayload,
    credentials: MarketplaceCredentials,
  ): Promise<PublishResult> {
    const connector = this.connectors.get(marketplace)
    if (!connector) return { ok: false, code: 'MARKETPLACE_NOT_SUPPORTED' }
    if (credentials.marketplace !== marketplace) {
      return { ok: false, code: 'CREDENTIALS_MARKETPLACE_MISMATCH' }
    }
    return connector.publish(payload, credentials)
  }
}
