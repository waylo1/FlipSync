import type { FastifyBaseLogger } from 'fastify'
import { ListingStatus, PrismaClient } from '@flipsync/db'
import {
  ItemCondition,
  listingToUnified,
  Marketplace,
  type MarketplaceSyncResult,
  type SyncSuccess,
} from '@flipsync/core'
import { ListingEngine } from '@flipsync/ai'
import {
  CoreSyncPublisher,
  LegacyConnectorAdapter,
  MarketplaceClient,
  type MarketplaceConnector,
} from '@flipsync/marketplace'
import { MarketplaceAuthService } from './marketplace-auth.service'

/** Plateformes du flux actuel — cibles par défaut d'une publication. */
export const DEFAULT_PUBLISH_TARGETS: readonly Marketplace[] = [
  Marketplace.VINTED,
  Marketplace.LEBONCOIN,
]

/** Projection publique d'un résultat par plateforme — detail (diagnostic brut) jamais exposé. */
export interface PublicationResult {
  marketplace: Marketplace
  ok: boolean
  code?: string
  url?: string | null
}

export interface PublicationOutcome {
  status: ListingStatus
  results: PublicationResult[]
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

/** Colonne catégorie du Listing par plateforme v1 — mapping hors du pivot agnostique. */
const V1_CATEGORY_FIELD = {
  [Marketplace.VINTED]: 'categorieVinted',
  [Marketplace.LEBONCOIN]: 'categorieLbc',
} as const

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
    private readonly client: MarketplaceClient,
    private readonly publicBaseUrl: string,
    private readonly auth: MarketplaceAuthService,
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
    if (listing.status !== ListingStatus.QUEUED) throw new PublicationError('INVALID_LISTING_STATE')

    // Pivot : catégorie interne provisoire = categorieLbc (pas de taxonomie
    // interne encore) — la catégorie par PLATEFORME est réinjectée dans le
    // toPayload de chaque adaptateur, jamais lue depuis le pivot.
    const mapped = listingToUnified({
      id: listing.id,
      titre: listing.titre,
      description: listing.description,
      marque: listing.marque,
      etat: listing.etat as ItemCondition | null,
      prixPublie: listing.prixPublie,
      categorie: listing.categorieLbc,
      photos: listing.photos.map(p => ({ url: `${this.publicBaseUrl}${p.url}`, order: p.order })),
    })
    if (!mapped.ok) {
      return this.fail(
        listingId,
        targets.map(marketplace => ({ marketplace, ok: false, code: 'INCOMPLETE_DRAFT' })),
        `INCOMPLETE_DRAFT:${mapped.missing.join(',')}`,
      )
    }

    // Registre construit PAR REQUÊTE : les adaptateurs v1 portent la catégorie
    // plateforme du listing courant. Cible sans connecteur (EBAY/SHOPIFY, ou
    // catégorie plateforme absente) ⇒ CONNECTOR_UNAVAILABLE via le publisher.
    const registry = new Map<Marketplace, MarketplaceConnector>()
    for (const [marketplace, field] of Object.entries(V1_CATEGORY_FIELD) as [
      keyof typeof V1_CATEGORY_FIELD,
      (typeof V1_CATEGORY_FIELD)[keyof typeof V1_CATEGORY_FIELD],
    ][]) {
      const categorie = listing[field]
      if (!categorie) continue
      registry.set(
        marketplace,
        new LegacyConnectorAdapter(marketplace, {
          resolveCredentials: () => this.auth.resolve(listing.userId, marketplace),
          toPayload: l => ({
            titre: l.titre,
            description: l.description,
            categorie,
            etat: l.etat,
            marque: l.marque,
            prixCents: l.mode === 'fixed' ? l.prix : 0, // v1 = fixed only (capabilities)
            photoUrls: l.photos.map(p => p.url),
          }),
          publishV1: (payload, credentials) => this.client.publish(marketplace, payload, credentials),
          onResult: result => this.auth.reportPublishOutcome(marketplace, result),
        }),
      )
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
