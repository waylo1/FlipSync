import {
  ListingStatus as DbListingStatus,
  PaymentSource as DbPaymentSource,
  TransactionType as DbTransactionType,
  Prisma,
  PrismaClient,
  UserWallet,
} from '@flipsync/db'
import {
  FIRST_RECHARGE_BONUS_CENTS,
  FIRST_RECHARGE_BONUS_THRESHOLD_CENTS,
  ListingAuthResult,
  PaymentSource,
} from '@flipsync/core'
import {
  AlreadyCommittedError,
  InsufficientFundsError,
  InvalidAmountError,
  InvalidListingStateError,
  InvalidPaymentSourceError,
  ListingNotFoundError,
  NoFreeCreditError,
  NothingToRefundError,
  WalletNotFoundError,
} from './errors'

/** Garde-fou : toute valeur monétaire est un Int >= 0 en centimes. */
const assertCents = (amount: number): void => {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new InvalidAmountError(amount)
  }
}

/** Quota mensuel du free tier (cf. CLAUDE.md — 3 listings/mois). */
const FREE_LISTINGS_MONTHLY = 3

/**
 * WalletService — toutes les valeurs en centimes (Int). Jamais de Float.
 *
 * Cycle de vie financier d'un listing :
 *   authorize() — pré-réservation, lecture seule, AUCUN débit.
 *   commit()    — débit effectif, déclenché APRÈS USER_VALIDATED uniquement.
 *   refund()    — remboursement auto sur AI_FAILED / PUBLISH_FAILED, idempotent.
 *
 * Tout débit/crédit s'exécute dans prisma.$transaction() (cf. CLAUDE.md).
 * commit() et refund() acceptent un client transactionnel optionnel : l'appelant
 * (ListingEngine) peut ainsi inclure le mouvement d'argent dans SA transaction —
 * statut et argent bougent ensemble ou pas du tout.
 */
/** Résultat de recharge — credited=false si l'event Stripe a déjà été traité. */
export interface RechargeResult {
  credited: boolean
  amount: number // centimes crédités (hors bonus)
  bonusApplied: boolean
  balance: number // solde après opération
}

export class WalletService {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Ordre de résolution (cf. CLAUDE.md) :
   *   1. freeListingsRemaining > 0 → FREE_CREDIT (cost projeté = 0)
   *   2. balance >= cost           → WALLET
   *   3. sinon                     → BLOCKED avec deficit (recharge manuelle,
   *      MVP — cf. FLIPSYNC-AUDIT.md F2 : auto-recharge retirée, produisait
   *      un solde projeté non garanti sans jamais déclencher de recharge réelle)
   *
   * Lecture seule : les compteurs retournés sont un snapshot AVANT commit.
   */
  async authorize(userId: string, cost: number): Promise<ListingAuthResult> {
    assertCents(cost)

    let wallet = await this.db.userWallet.findUnique({ where: { userId } })
    if (!wallet) throw new WalletNotFoundError()
    wallet = await this.resetFreeTierIfDue(wallet)

    if (wallet.freeListingsRemaining > 0) {
      return {
        authorized: true,
        source: PaymentSource.FREE_CREDIT,
        cost: 0,
        freeCreditsRemaining: wallet.freeListingsRemaining,
        walletBalanceBefore: wallet.balance,
        walletBalanceAfter: wallet.balance,
      }
    }

    if (wallet.balance >= cost) {
      return {
        authorized: true,
        source: PaymentSource.WALLET,
        cost,
        freeCreditsRemaining: 0,
        walletBalanceBefore: wallet.balance,
        walletBalanceAfter: wallet.balance - cost,
      }
    }

    return {
      authorized: false,
      source: PaymentSource.BLOCKED,
      cost,
      freeCreditsRemaining: 0,
      walletBalanceBefore: wallet.balance,
      walletBalanceAfter: wallet.balance,
      deficit: cost - wallet.balance,
    }
  }

  /**
   * Reset paresseux du free tier : à la première autorisation après l'échéance,
   * le quota mensuel est restauré et l'échéance repoussée d'un mois (calendaire,
   * depuis maintenant — pas de rattrapage cumulé après une longue absence).
   * Concurrence : update conditionné sur l'ancienne échéance — deux authorize()
   * simultanés ne produisent qu'UN reset, le perdant relit l'état du gagnant.
   */
  private async resetFreeTierIfDue(wallet: UserWallet): Promise<UserWallet> {
    const now = new Date()
    if (wallet.freeListingsResetAt > now) return wallet

    const nextResetAt = new Date(now)
    nextResetAt.setMonth(nextResetAt.getMonth() + 1)

    const updated = await this.db.userWallet.updateMany({
      where: { id: wallet.id, freeListingsResetAt: wallet.freeListingsResetAt },
      data: { freeListingsRemaining: FREE_LISTINGS_MONTHLY, freeListingsResetAt: nextResetAt },
    })
    if (updated.count === 0) {
      // Course perdue : un authorize() concurrent a déjà fait le reset.
      return this.db.userWallet.findUniqueOrThrow({ where: { id: wallet.id } })
    }
    return { ...wallet, freeListingsRemaining: FREE_LISTINGS_MONTHLY, freeListingsResetAt: nextResetAt }
  }

  /**
   * Crédit du wallet suite à un paiement Stripe confirmé (webhook).
   * Idempotent à deux niveaux : lookup stripeId + contrainte UNIQUE en base
   * (une double livraison concurrente du webhook ne crédite jamais deux fois).
   * Bonus fidélité : +1,00 € si PREMIÈRE recharge et montant >= 10,00 €.
   */
  async recharge(userId: string, amountCents: number, stripeId: string): Promise<RechargeResult> {
    assertCents(amountCents)
    if (amountCents === 0) throw new InvalidAmountError(amountCents)

    try {
      return await this.db.$transaction(async tx => {
        const wallet = await tx.userWallet.findUnique({ where: { userId } })
        if (!wallet) throw new WalletNotFoundError()

        const existing = await tx.walletTransaction.findUnique({ where: { stripeId } })
        if (existing) {
          return { credited: false, amount: 0, bonusApplied: false, balance: wallet.balance }
        }

        const isFirstRecharge = wallet.lifetimeRecharged === 0
        const bonusApplied =
          isFirstRecharge && amountCents >= FIRST_RECHARGE_BONUS_THRESHOLD_CENTS
        const totalCredit = amountCents + (bonusApplied ? FIRST_RECHARGE_BONUS_CENTS : 0)

        const updated = await tx.userWallet.update({
          where: { id: wallet.id },
          data: {
            balance: { increment: totalCredit },
            lifetimeRecharged: { increment: amountCents }, // le bonus n'est pas une recharge
          },
        })

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: DbTransactionType.CREDIT,
            amount: amountCents,
            source: DbPaymentSource.STRIPE_RECHARGE,
            stripeId,
            description: 'Recharge Stripe',
          },
        })

        if (bonusApplied) {
          await tx.walletTransaction.create({
            data: {
              walletId: wallet.id,
              type: DbTransactionType.BONUS,
              amount: FIRST_RECHARGE_BONUS_CENTS,
              source: DbPaymentSource.BONUS,
              description: 'Bonus fidélité première recharge',
            },
          })
        }

        return { credited: true, amount: amountCents, bonusApplied, balance: updated.balance }
      })
    } catch (err) {
      // Course entre deux livraisons du même event : la contrainte UNIQUE tranche.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const wallet = await this.db.userWallet.findUnique({ where: { userId } })
        return { credited: false, amount: 0, bonusApplied: false, balance: wallet?.balance ?? 0 }
      }
      throw err
    }
  }

  /**
   * Débit effectif — APPELÉ UNIQUEMENT après la transition USER_VALIDATED.
   * Atomique et idempotent : un seul DEBIT par listing.
   */
  async commit(listingId: string, tx?: Prisma.TransactionClient): Promise<void> {
    if (tx) {
      await this.commitWithin(tx, listingId)
      return
    }
    await this.db.$transaction(async t => this.commitWithin(t, listingId))
  }

  private async commitWithin(tx: Prisma.TransactionClient, listingId: string): Promise<void> {
    const listing = await tx.listing.findUnique({ where: { id: listingId } })
    if (!listing) throw new ListingNotFoundError()
    if (listing.status !== DbListingStatus.USER_VALIDATED) {
      throw new InvalidListingStateError(listing.status, DbListingStatus.USER_VALIDATED)
    }

    const existingDebit = await tx.walletTransaction.findFirst({
      where: { listingId, type: DbTransactionType.DEBIT },
    })
    if (existingDebit) throw new AlreadyCommittedError()

    const wallet = await tx.userWallet.findUnique({ where: { userId: listing.userId } })
    if (!wallet) throw new WalletNotFoundError()

    if (listing.paymentSource === DbPaymentSource.FREE_CREDIT) {
      // updateMany + guard : décrément atomique, échoue si plus de crédit gratuit.
      const updated = await tx.userWallet.updateMany({
        where: { id: wallet.id, freeListingsRemaining: { gt: 0 } },
        data: { freeListingsRemaining: { decrement: 1 } },
      })
      if (updated.count === 0) throw new NoFreeCreditError()

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: DbTransactionType.DEBIT,
          amount: 0,
          source: DbPaymentSource.FREE_CREDIT,
          listingId,
          description: 'Listing gratuit (free tier)',
        },
      })
      return
    }

    if (listing.paymentSource === DbPaymentSource.WALLET) {
      assertCents(listing.cost)
      // updateMany + guard balance >= cost : pas de débit si fonds insuffisants.
      const updated = await tx.userWallet.updateMany({
        where: { id: wallet.id, balance: { gte: listing.cost } },
        data: { balance: { decrement: listing.cost } },
      })
      if (updated.count === 0) throw new InsufficientFundsError()

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: DbTransactionType.DEBIT,
          amount: listing.cost,
          source: DbPaymentSource.WALLET,
          listingId,
          description: `Débit listing ${listing.tier}`,
        },
      })
      return
    }

    throw new InvalidPaymentSourceError(listing.paymentSource)
  }

  /**
   * Remboursement automatique sur AI_FAILED / PUBLISH_FAILED.
   * Idempotent : si un REFUND existe déjà pour ce listing, no-op.
   * Restitue le crédit gratuit OU recrédite le wallet du montant exact du DEBIT.
   */
  async refund(listingId: string, reason: string, tx?: Prisma.TransactionClient): Promise<void> {
    if (tx) {
      await this.refundWithin(tx, listingId, reason)
      return
    }
    await this.db.$transaction(async t => this.refundWithin(t, listingId, reason))
  }

  private async refundWithin(
    tx: Prisma.TransactionClient,
    listingId: string,
    reason: string,
  ): Promise<void> {
    const debit = await tx.walletTransaction.findFirst({
      where: { listingId, type: DbTransactionType.DEBIT },
    })
    if (!debit) throw new NothingToRefundError()

    const alreadyRefunded = await tx.walletTransaction.findFirst({
      where: { listingId, type: DbTransactionType.REFUND },
    })
    if (alreadyRefunded) return // idempotence — remboursement déjà effectué

    if (debit.source === DbPaymentSource.FREE_CREDIT) {
      await tx.userWallet.update({
        where: { id: debit.walletId },
        data: { freeListingsRemaining: { increment: 1 } },
      })
      await tx.walletTransaction.create({
        data: {
          walletId: debit.walletId,
          type: DbTransactionType.REFUND,
          amount: 0,
          source: DbPaymentSource.FREE_CREDIT,
          listingId,
          description: reason,
        },
      })
      return
    }

    assertCents(debit.amount)
    await tx.userWallet.update({
      where: { id: debit.walletId },
      data: { balance: { increment: debit.amount } },
    })
    await tx.walletTransaction.create({
      data: {
        walletId: debit.walletId,
        type: DbTransactionType.REFUND,
        amount: debit.amount,
        source: DbPaymentSource.WALLET,
        listingId,
        description: reason,
      },
    })
  }
}

/** Type du client transactionnel — exposé pour les appelants (ListingEngine, tests). */
export type WalletTx = Prisma.TransactionClient
