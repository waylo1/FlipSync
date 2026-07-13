import type { FastifyBaseLogger } from 'fastify'
import { ListingStatus, PrismaClient } from '@flipsync/db'
import { ItemCondition } from '@flipsync/core'
import { ListingEngine } from '@flipsync/ai'
import { ListingPayload, Marketplace, MarketplaceClient } from '@flipsync/marketplace'
import { MarketplaceAuthService } from './marketplace-auth.service'

export interface PublicationOutcome {
  status: ListingStatus
  marketplace: Marketplace
  url?: string
  failureReason?: string
}

/**
 * Erreur de publication — code SNAKE_CASE mappé en HTTP par l'error-handler
 * (LISTING_NOT_FOUND → 404, INVALID_LISTING_STATE → 409). Jamais un 500 opaque.
 */
export class PublicationError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'PublicationError'
  }
}

/**
 * Champs spécifiques à chaque plateforme sur le modèle Listing — flux v1
 * (LBC/Vinted). EBAY/SHOPIFY (ADR-009) passeront par le Core Sync Engine :
 * ici, fail-fast MARKETPLACE_NOT_SUPPORTED sans toucher au listing.
 */
const PLATFORM_FIELDS = {
  [Marketplace.LEBONCOIN]: { categorie: 'categorieLbc', urlKey: 'lbcUrl' },
  [Marketplace.VINTED]: { categorie: 'categorieVinted', urlKey: 'vintedUrl' },
} as const

const platformFields = (marketplace: Marketplace) =>
  marketplace in PLATFORM_FIELDS ? PLATFORM_FIELDS[marketplace as keyof typeof PLATFORM_FIELDS] : null

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
    private readonly auth: MarketplaceAuthService,
    private readonly log?: FastifyBaseLogger,
  ) {}

  async publish(listingId: string, marketplace: Marketplace): Promise<PublicationOutcome> {
    const fields = platformFields(marketplace)
    if (!fields) throw new PublicationError('MARKETPLACE_NOT_SUPPORTED')

    const listing = await this.db.listing.findUnique({
      where: { id: listingId },
      include: { photos: { orderBy: { order: 'asc' } } },
    })
    if (!listing) throw new PublicationError('LISTING_NOT_FOUND')
    if (listing.status !== ListingStatus.QUEUED) throw new PublicationError('INVALID_LISTING_STATE')

    const categorie = listing[fields.categorie]

    // Garde-fous : un listing QUEUED doit porter un brouillon complet.
    if (!listing.titre || !listing.description || !categorie || !listing.etat) {
      return this.fail(listingId, marketplace, 'INCOMPLETE_DRAFT')
    }
    if (listing.prixPublie === null) {
      return this.fail(listingId, marketplace, 'MISSING_PUBLISHED_PRICE')
    }

    const resolution = this.auth.resolve(listing.userId, marketplace)
    if (!resolution.ok) {
      return this.fail(
        listingId,
        marketplace,
        resolution.reason === 'EXPIRED'
          ? 'MARKETPLACE_CREDENTIALS_EXPIRED'
          : 'MARKETPLACE_CREDENTIALS_MISSING',
      )
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

    const result = await this.client.publish(marketplace, payload, resolution.credentials)
    // Un 401/403 plateforme bascule le connecteur en AUTH_ERROR (visible au
    // GET /marketplace/status) ; un succès efface l'erreur.
    this.auth.reportPublishOutcome(marketplace, result)
    if (!result.ok) {
      return this.fail(listingId, marketplace, result.code)
    }

    await this.engine.markPublished(listingId, {
      [fields.urlKey]: result.url,
    })
    this.log?.info({ listingId, marketplace, mock: resolution.mock }, 'publication réussie')
    return { status: ListingStatus.PUBLISHED, marketplace, url: result.url }
  }

  /** PUBLISH_FAILED + remboursement automatique via ListingEngine. */
  private async fail(
    listingId: string,
    marketplace: Marketplace,
    reason: string,
  ): Promise<PublicationOutcome> {
    this.log?.warn({ listingId, marketplace, reason }, 'publication échouée — remboursement auto')
    await this.engine.failPublish(listingId, `${marketplace}:${reason}`)
    return { status: ListingStatus.PUBLISH_FAILED, marketplace, failureReason: reason }
  }
}
