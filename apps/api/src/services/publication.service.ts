import type { FastifyBaseLogger } from 'fastify'
import { ListingStatus as DbListingStatus, PrismaClient } from '@flipsync/db'
import {
  ItemCondition,
  ListingStatus,
  listingToUnified,
  Marketplace,
  type MarketplaceSyncResult,
  type PublicationOutcome,
  type PublicationResult,
  type SyncSuccess,
} from '@flipsync/core'
import { ListingEngine } from '@flipsync/ai'
import {
  CoreSyncPublisher,
  EbayConnector,
  LeboncoinConnector,
  MockMarketplacePublisher,
  ShopifyConnector,
  VintedConnector,
  type ChannelConnector,
  type PartnerPublishResult,
} from '@flipsync/marketplace'
import { MarketplaceAuthService } from './marketplace-auth.service'
import { signPhotoPath } from './photo-url.service'

/** Plateformes du flux actuel — cibles par défaut d'une publication. */
export const DEFAULT_PUBLISH_TARGETS: readonly Marketplace[] = [
  Marketplace.VINTED,
  Marketplace.LEBONCOIN,
]

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
 * PublicationService — QUEUED → PUBLISHED|PUBLISH_FAILED via le Core Sync
 * Engine (ADR-009) : pivot UnifiedListing → CoreSyncPublisher → connecteurs
 * v1 (LBC/Vinted, adaptés) — pannes isolées par plateforme.
 *
 * Règle du Jeton Global (décision produit Run 3) — 1 publication = 1 transaction :
 * - ≥ 1 plateforme publie ⇒ PUBLISHED, externalIds persistés (ListingPublication),
 *   AUCUN remboursement.
 * - 100 % d'échec ⇒ PUBLISH_FAILED + remboursement TOTAL (ListingEngine.failPublish,
 *   refund idempotent dans la même transaction).
 * Le débit, lui, a déjà eu lieu à validate() (commit wallet) — jamais ici.
 */
export class PublicationService {
  constructor(
    private readonly db: PrismaClient,
    private readonly engine: ListingEngine,
    private readonly publicBaseUrl: string,
    private readonly auth: MarketplaceAuthService,
    /** Mode mock (MARKETPLACE_MOCK=1, jamais prod) : chemin du log simulé — cf. plugins/services.ts. */
    private readonly mockLogPath: string,
    private readonly log?: FastifyBaseLogger,
  ) {}

  async publish(
    listingId: string,
    targets: readonly Marketplace[] = DEFAULT_PUBLISH_TARGETS,
  ): Promise<PublicationOutcome> {
    if (targets.length === 0) throw new PublicationError('NO_TARGET_MARKETPLACE')

    const listing = await this.db.listing.findUnique({
      where: { id: listingId },
      include: { photos: { orderBy: { order: 'asc' } } },
    })
    if (!listing) throw new PublicationError('LISTING_NOT_FOUND')
    if (listing.status !== DbListingStatus.QUEUED) throw new PublicationError('INVALID_LISTING_STATE')

    // Pivot : catégorie canonique (CanonicalCategoryId, ADR-010) — le mapping
    // vers la taxonomie propre à chaque plateforme vit dans le connecteur,
    // jamais ici.
    const mapped = listingToUnified({
      id: listing.id,
      titre: listing.titre,
      description: listing.description,
      marque: listing.marque,
      etat: listing.etat as ItemCondition | null,
      prixPublie: listing.prixPublie,
      categorie: listing.categorieId,
      // URLs signées temporaires : lisibles par eBay/Shopify sans JWT (Run 6).
      photos: listing.photos.map(p => ({
        url: `${this.publicBaseUrl}${signPhotoPath(p.url)}`,
        order: p.order,
      })),
    })
    if (!mapped.ok) {
      return this.fail(
        listingId,
        targets.map(marketplace => ({ marketplace, ok: false, code: 'INCOMPLETE_DRAFT' })),
        `INCOMPLETE_DRAFT:${mapped.missing.join(',')}`,
      )
    }

    // Registre construit PAR REQUÊTE (credentials liées à l'utilisateur courant
    // pour Vinted/LBC — resolveCredentials/onResult injectés, aucun wrapper).
    // Port ChannelConnector (C3, ADAPTER-CONTRACT §3) : les 4 connecteurs sont
    // nativement `ChannelConnector` depuis C3.6 (refonte achevée, v1/v2 détruits).
    // Le mock (MARKETPLACE_MOCK=1) couvre UNIQUEMENT Vinted/LBC : ce sont les
    // seuls canaux sans credentials partenaires réels aujourd'hui (Sprint 3,
    // programme partenaire en attente). EBAY/SHOPIFY ont des connecteurs réels
    // qui dégradent déjà proprement (CREDENTIALS_MISSING, aucun appel réseau)
    // sans mock — les mocker aussi masquerait ce comportement dans les tests.
    const useMock = this.auth.mockEnabled()
    const registry = new Map<Marketplace, ChannelConnector>()
    for (const marketplace of [
      Marketplace.VINTED,
      Marketplace.LEBONCOIN,
      Marketplace.EBAY,
      Marketplace.SHOPIFY,
    ] as const) {
      switch (marketplace) {
        case Marketplace.EBAY:
          registry.set(marketplace, new EbayConnector())
          break
        case Marketplace.SHOPIFY:
          registry.set(marketplace, new ShopifyConnector())
          break
        default: {
          if (useMock) {
            registry.set(marketplace, new MockMarketplacePublisher(marketplace, this.mockLogPath))
            break
          }
          const deps = {
            resolveCredentials: () => this.auth.resolve(listing.userId, marketplace),
            onResult: (result: PartnerPublishResult) => this.auth.reportPublishOutcome(marketplace, result),
          }
          registry.set(
            marketplace,
            marketplace === Marketplace.VINTED ? new VintedConnector(deps) : new LeboncoinConnector(deps),
          )
        }
      }
    }

    const report = await new CoreSyncPublisher(registry).publishMany(mapped.listing, targets)

    // Observabilité : un événement de log PAR plateforme cible — statut de
    // sortie + code d'échec, jamais de PII (ni titre, ni description, ni email).
    for (const r of report.results) {
      this.log?.info(
        {
          listingId,
          marketplace: r.marketplace,
          ok: r.outcome.ok,
          ...(r.outcome.ok ? {} : { code: r.outcome.code, detail: r.outcome.detail }),
        },
        'publication marketplace — résultat',
      )
    }

    const results: PublicationResult[] = report.results.map(r =>
      r.outcome.ok
        ? { marketplace: r.marketplace, ok: true, url: r.outcome.url }
        : { marketplace: r.marketplace, ok: false, code: r.outcome.code },
    )
    const successes = report.results.filter(
      (r): r is MarketplaceSyncResult & { outcome: SyncSuccess } => r.outcome.ok,
    )

    // Jeton Global : 100 % d'échec ⇒ PUBLISH_FAILED + remboursement total.
    if (successes.length === 0) {
      const reason = report.results
        .map(r => `${r.marketplace}:${r.outcome.ok ? 'OK' : r.outcome.code}`)
        .join(' ')
      return this.fail(listingId, results, reason)
    }

    // ≥ 1 succès ⇒ PUBLISHED, aucun remboursement. externalIds persistés —
    // upsert (clé listingId+marketplace) : une re-tentative ne duplique jamais.
    for (const s of successes) {
      await this.db.listingPublication.upsert({
        where: { listingId_marketplace: { listingId, marketplace: s.marketplace } },
        create: { listingId, marketplace: s.marketplace, externalId: s.outcome.externalId, url: s.outcome.url },
        update: { externalId: s.outcome.externalId, url: s.outcome.url },
      })
    }
    const urls: { lbcUrl?: string; vintedUrl?: string } = {}
    for (const s of successes) {
      // v1 fournit toujours une URL ; '' ne peut venir que d'un futur connecteur
      // v2 natif sans URL publique — ListingPublication reste alors la SSOT.
      if (s.marketplace === Marketplace.LEBONCOIN) urls.lbcUrl = s.outcome.url ?? ''
      if (s.marketplace === Marketplace.VINTED) urls.vintedUrl = s.outcome.url ?? ''
    }
    await this.engine.markPublished(listingId, urls)
    this.log?.info(
      { listingId, published: successes.map(s => s.marketplace), failed: results.filter(r => !r.ok).length },
      'publication réussie (Jeton Global : ≥1 plateforme)',
    )
    return { status: ListingStatus.PUBLISHED, results }
  }

  /** PUBLISH_FAILED + remboursement automatique via ListingEngine (Jeton Global : 0 succès). */
  private async fail(
    listingId: string,
    results: PublicationResult[],
    reason: string,
  ): Promise<PublicationOutcome> {
    this.log?.warn({ listingId, reason }, 'publication échouée sur toutes les plateformes — remboursement auto')
    await this.engine.failPublish(listingId, reason)
    return { status: ListingStatus.PUBLISH_FAILED, results, failureReason: reason }
  }
}
