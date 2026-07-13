import {
  Listing as ListingModel,
  ListingStatus as DbListingStatus,
  Prisma,
  PrismaClient,
} from '@flipsync/db'
import {
  ItemCondition,
  ListingAuthResult,
  ListingDraft,
  ListingTier,
  TIER_PRICING,
  isPriceFlagged,
} from '@flipsync/core'
import { NothingToRefundError, WalletService } from '@flipsync/wallet'
import {
  InvalidPriceError,
  InvalidTransitionError,
  ListingNotEditableError,
  ListingNotFoundError,
  MissingFailureReasonError,
} from './errors'
import { canTransition } from './transitions'

const assertCents = (amount: number): void => {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new InvalidPriceError(amount)
  }
}

export interface CreateListingResult {
  listing: ListingModel
  auth: ListingAuthResult
}

/** Champs éditables après validation — jamais photos, tier, ou statut. */
export interface ListingEditPatch {
  titre?: string
  description?: string
  marque?: string | null
  etat?: ItemCondition
  prixPublie?: number
}

/**
 * États "vivants" post-commit où le contenu reste modifiable par l'utilisateur.
 * PUBLISHED exclu (fix F3, FLIPSYNC-AUDIT.md) : une fois en ligne, une édition
 * locale ne se propage à aucun connecteur marketplace — elle ferait diverger
 * silencieusement le prix/titre affiché localement de l'annonce publiée.
 */
const EDITABLE_STATUSES: readonly DbListingStatus[] = [
  DbListingStatus.USER_VALIDATED,
  DbListingStatus.QUEUED,
]

/**
 * ListingEngine — orchestre la machine à états ListingStatus (11 états).
 *
 * Garanties :
 *   - Transitions validées contre LISTING_TRANSITIONS, avec verrou optimiste
 *     (updateMany WHERE status = état lu) contre les courses concurrentes.
 *   - validate() : statut → USER_VALIDATED ET débit wallet dans LA MÊME
 *     transaction Prisma — l'argent ne bouge jamais sans le statut, ni l'inverse.
 *   - failureReason TOUJOURS renseigné sur AI_FAILED / PUBLISH_FAILED.
 *   - Remboursement automatique sur AI_FAILED (tolérant : rien à rembourser
 *     pré-commit) et PUBLISH_FAILED (strict : un débit existe forcément).
 */
export class ListingEngine {
  constructor(
    private readonly db: PrismaClient,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Création : authorize() (lecture seule) puis création du listing.
   * Autorisé → AUTHORIZED ; refusé → PENDING_AUTH avec paymentSource BLOCKED
   * (l'utilisateur pourra recharger puis reauthorize()).
   */
  async createListing(userId: string, tier: ListingTier): Promise<CreateListingResult> {
    const auth = await this.wallet.authorize(userId, TIER_PRICING[tier])

    const listing = await this.db.listing.create({
      data: {
        userId,
        tier,
        status: auth.authorized ? DbListingStatus.AUTHORIZED : DbListingStatus.PENDING_AUTH,
        paymentSource: auth.source,
        cost: auth.cost,
      },
    })

    return { listing, auth }
  }

  /** Re-tentative d'autorisation d'un listing resté PENDING_AUTH (BLOCKED). */
  async reauthorize(listingId: string): Promise<CreateListingResult> {
    const listing = await this.db.listing.findUnique({ where: { id: listingId } })
    if (!listing) throw new ListingNotFoundError()
    if (listing.status !== DbListingStatus.PENDING_AUTH) {
      throw new InvalidTransitionError(listing.status, DbListingStatus.AUTHORIZED)
    }

    const auth = await this.wallet.authorize(listing.userId, TIER_PRICING[listing.tier as ListingTier])
    if (!auth.authorized) return { listing, auth }

    const updated = await this.move(this.db, listingId, DbListingStatus.AUTHORIZED, {
      paymentSource: auth.source,
      cost: auth.cost,
    })
    return { listing: updated, auth }
  }

  /** AUTHORIZED → AI_PROCESSING (vision + rédaction SEO en cours). */
  async startAiProcessing(listingId: string): Promise<ListingModel> {
    return this.db.$transaction(async tx =>
      this.move(tx, listingId, DbListingStatus.AI_PROCESSING),
    )
  }

  /** AI_PROCESSING → DRAFT_READY, persiste le brouillon IA (prix en centimes Int). */
  async completeAiDraft(listingId: string, draft: ListingDraft): Promise<ListingModel> {
    assertCents(draft.prixPlancher)
    assertCents(draft.prixHaut)

    return this.db.$transaction(async tx =>
      this.move(tx, listingId, DbListingStatus.DRAFT_READY, {
        titre: draft.titre,
        description: draft.description,
        categorieLbc: draft.categorieLbc,
        categorieVinted: draft.categorieVinted,
        etat: draft.etat,
        prixPlancher: draft.prixPlancher,
        prixHaut: draft.prixHaut,
        marque: draft.marque,
        confidence: draft.confidence,
      }),
    )
  }

  /**
   * AI_PROCESSING → AI_FAILED. failureReason obligatoire.
   * Remboursement tolérant : avant commit il n'y a rien à rembourser (0 débit),
   * mais si un débit existait (incohérence), il est restitué dans la même transaction.
   */
  async failAi(listingId: string, failureReason: string): Promise<ListingModel> {
    if (!failureReason.trim()) throw new MissingFailureReasonError()

    return this.db.$transaction(async tx => {
      const listing = await this.move(tx, listingId, DbListingStatus.AI_FAILED, { failureReason })
      try {
        await this.wallet.refund(listingId, failureReason, tx)
      } catch (err) {
        if (!(err instanceof NothingToRefundError)) throw err
      }
      return listing
    })
  }

  /**
   * DRAFT_READY → USER_VALIDATED → QUEUED — LE point de débit.
   * Statut, prixPublie, flag diplomatie, commit() wallet ET mise en file :
   * une seule transaction — l'argent ne bouge jamais sans que le listing
   * atteigne QUEUED, ni l'inverse (fix F1 : plus de débit orphelin bloqué
   * en USER_VALIDATED si la mise en file échoue après le débit).
   */
  async validate(listingId: string, prixPublie: number): Promise<ListingModel> {
    assertCents(prixPublie)

    return this.db.$transaction(async tx => {
      const current = await tx.listing.findUnique({ where: { id: listingId } })
      if (!current) throw new ListingNotFoundError()

      const flagged =
        current.prixHaut !== null && isPriceFlagged(prixPublie, current.prixHaut)

      await this.move(tx, listingId, DbListingStatus.USER_VALIDATED, {
        prixPublie,
        isPriceFlagged: flagged,
      })

      await this.wallet.commit(listingId, tx)
      return this.move(tx, listingId, DbListingStatus.QUEUED)
    })
  }

  /**
   * Annulation utilisateur — pré-commit (0 débit) ou depuis QUEUED (post-commit,
   * remboursement intégral). Remboursement TOLÉRANT comme failAi : pré-commit,
   * NothingToRefundError est normal et ignoré.
   */
  async cancel(listingId: string): Promise<ListingModel> {
    return this.db.$transaction(async tx => {
      const listing = await this.move(tx, listingId, DbListingStatus.USER_CANCELLED)
      try {
        await this.wallet.refund(listingId, 'Annulation utilisateur', tx)
      } catch (err) {
        if (!(err instanceof NothingToRefundError)) throw err
      }
      return listing
    })
  }

  /**
   * Édition post-validation (titre/description/marque/état/prix) — jamais les
   * photos, ni le tier, ni le statut. Recalcule isPriceFlagged si le prix change.
   * Autorisé sur les états "vivants" post-commit uniquement (EDITABLE_STATUSES).
   */
  async editContent(listingId: string, patch: ListingEditPatch): Promise<ListingModel> {
    if (patch.prixPublie !== undefined) assertCents(patch.prixPublie)

    return this.db.$transaction(async tx => {
      const listing = await tx.listing.findUnique({ where: { id: listingId } })
      if (!listing) throw new ListingNotFoundError()
      if (!EDITABLE_STATUSES.includes(listing.status)) {
        throw new ListingNotEditableError(listing.status)
      }

      const prixPublie = patch.prixPublie ?? listing.prixPublie
      const flagged =
        listing.prixHaut !== null && prixPublie !== null
          ? isPriceFlagged(prixPublie, listing.prixHaut)
          : listing.isPriceFlagged

      return tx.listing.update({
        where: { id: listingId },
        data: { ...patch, isPriceFlagged: flagged },
      })
    })
  }

  /**
   * USER_VALIDATED → QUEUED. Le flux nominal passe désormais par validate()
   * (transition atomique jusqu'à QUEUED) — conservé comme chemin de
   * récupération pour les lignes historiques restées USER_VALIDATED (pré-F1).
   */
  async queue(listingId: string): Promise<ListingModel> {
    return this.db.$transaction(async tx => this.move(tx, listingId, DbListingStatus.QUEUED))
  }

  /** QUEUED → PUBLISHED, horodatage + flags plateformes. */
  async markPublished(
    listingId: string,
    urls: { lbcUrl?: string; vintedUrl?: string },
  ): Promise<ListingModel> {
    return this.db.$transaction(async tx =>
      this.move(tx, listingId, DbListingStatus.PUBLISHED, {
        publishedAt: new Date(),
        publishedLbc: urls.lbcUrl !== undefined,
        publishedVinted: urls.vintedUrl !== undefined,
        lbcUrl: urls.lbcUrl ?? null,
        vintedUrl: urls.vintedUrl ?? null,
      }),
    )
  }

  /**
   * QUEUED → PUBLISH_FAILED. failureReason obligatoire.
   * Remboursement STRICT dans la même transaction : un débit existe forcément
   * après commit — toute erreur de refund annule aussi le changement de statut.
   */
  async failPublish(listingId: string, failureReason: string): Promise<ListingModel> {
    if (!failureReason.trim()) throw new MissingFailureReasonError()

    return this.db.$transaction(async tx => {
      const listing = await this.move(tx, listingId, DbListingStatus.PUBLISH_FAILED, {
        failureReason,
      })
      await this.wallet.refund(listingId, failureReason, tx)
      return listing
    })
  }

  /** PUBLISHED → EXPIRED (annonce expirée sans vente). */
  async expire(listingId: string): Promise<ListingModel> {
    return this.db.$transaction(async tx => this.move(tx, listingId, DbListingStatus.EXPIRED))
  }

  /**
   * Transition générique avec verrou optimiste :
   * lit l'état courant, valide contre LISTING_TRANSITIONS, puis update
   * conditionné à l'état lu (count=0 → course concurrente → rejet).
   */
  private async move(
    tx: Prisma.TransactionClient | PrismaClient,
    listingId: string,
    to: DbListingStatus,
    data: Omit<Prisma.ListingUpdateManyMutationInput, 'status'> = {},
  ): Promise<ListingModel> {
    const listing = await tx.listing.findUnique({ where: { id: listingId } })
    if (!listing) throw new ListingNotFoundError()
    if (!canTransition(listing.status, to)) {
      throw new InvalidTransitionError(listing.status, to)
    }

    const updated = await tx.listing.updateMany({
      where: { id: listingId, status: listing.status },
      data: { ...data, status: to },
    })
    if (updated.count === 0) throw new InvalidTransitionError(listing.status, to)

    return tx.listing.findUniqueOrThrow({ where: { id: listingId } })
  }
}
