import { ListingStatus, PrismaClient } from '@flipsync/db'
import { ItemCondition } from '@flipsync/core'
import { ListingEngine } from '@flipsync/ai'
import {
  ListingPayload,
  Marketplace,
  MarketplaceClient,
  MarketplaceCredentials,
} from '@flipsync/marketplace'

/** Résout les identifiants partenaire du vendeur pour une plateforme donnée. */
export type CredentialsResolver = (
  userId: string,
  marketplace: Marketplace,
) => Promise<MarketplaceCredentials | null>

export interface PublicationOutcome {
  status: ListingStatus
  marketplace: Marketplace
  url?: string
  failureReason?: string
}

/** Champs spécifiques à chaque plateforme sur le modèle Listing. */
const PLATFORM_FIELDS = {
  [Marketplace.LEBONCOIN]: { categorie: 'categorieLbc', urlKey: 'lbcUrl' },
  [Marketplace.VINTED]: { categorie: 'categorieVinted', urlKey: 'vintedUrl' },
} as const

/**
 * PublicationService — exécute la transition QUEUED → PUBLISHED via les APIs
 * partenaires officielles (MarketplaceClient). 100% serveur.
 *
 * Le brouillon Moondream2 (on-device, validé) est déjà persisté sur le Listing ;
 * ce service le transforme en payload et le pousse au connecteur. Tout échec
 * (credentials, réseau, refus plateforme) → PUBLISH_FAILED + remboursement auto
 * (géré par ListingEngine.failPublish). Jamais de faux succès.
 */
export class PublicationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly engine: ListingEngine,
    private readonly client: MarketplaceClient,
    private readonly publicBaseUrl: string,
    private readonly resolveCredentials: CredentialsResolver,
  ) {}

  async publish(listingId: string, marketplace: Marketplace): Promise<PublicationOutcome> {
    const listing = await this.db.listing.findUnique({
      where: { id: listingId },
      include: { photos: { orderBy: { order: 'asc' } } },
    })
    if (!listing) throw new Error('LISTING_NOT_FOUND')
    if (listing.status !== ListingStatus.QUEUED) throw new Error('INVALID_LISTING_STATE')

    const fields = PLATFORM_FIELDS[marketplace]
    const categorie = listing[fields.categorie]

    // Garde-fous : un listing QUEUED doit porter un brouillon complet.
    if (!listing.titre || !listing.description || !categorie || !listing.etat) {
      return this.fail(listingId, marketplace, 'INCOMPLETE_DRAFT')
    }
    if (listing.prixPublie === null) {
      return this.fail(listingId, marketplace, 'MISSING_PUBLISHED_PRICE')
    }

    const credentials = await this.resolveCredentials(listing.userId, marketplace)
    if (!credentials) {
      return this.fail(listingId, marketplace, 'MARKETPLACE_CREDENTIALS_MISSING')
    }

    const payload: ListingPayload = {
      titre: listing.titre,
      description: listing.description,
      categorie,
      etat: listing.etat as unknown as ItemCondition, // enums Prisma/core identiques
      marque: listing.marque,
      prixCents: listing.prixPublie, // centimes Int
      photoUrls: listing.photos.map(p => `${this.publicBaseUrl}${p.url}`),
    }

    const result = await this.client.publish(marketplace, payload, credentials)
    if (!result.ok) {
      return this.fail(listingId, marketplace, result.code)
    }

    await this.engine.markPublished(listingId, {
      [fields.urlKey]: result.url,
    })
    return { status: ListingStatus.PUBLISHED, marketplace, url: result.url }
  }

  /** PUBLISH_FAILED + remboursement automatique via ListingEngine. */
  private async fail(
    listingId: string,
    marketplace: Marketplace,
    reason: string,
  ): Promise<PublicationOutcome> {
    await this.engine.failPublish(listingId, `${marketplace}:${reason}`)
    return { status: ListingStatus.PUBLISH_FAILED, marketplace, failureReason: reason }
  }
}
