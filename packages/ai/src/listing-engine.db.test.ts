import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ItemCondition, ListingDraft, ListingTier } from '@flipsync/core'
import { WalletService } from '@flipsync/wallet'
import { ListingEngine } from './listing-engine'

/**
 * Tests d'intégration sur Postgres réel (conteneur local flipsync-pg).
 * Skippés si DATABASE_URL absent. Vérifient les invariants critiques :
 * argent et statut bougent ensemble, jamais l'un sans l'autre.
 */
const DB_URL = process.env.DATABASE_URL

const DRAFT: ListingDraft = {
  titre: 'Test - Veste cuir',
  description: 'Description test',
  categorieLbc: 'Vêtements',
  categorieVinted: 'Hommes > Vestes',
  etat: ItemCondition.tres_bon,
  prixPlancher: 8000,
  prixHaut: 12000,
  marque: 'Schott',
  confidence: 0.9,
}

describe.skipIf(!DB_URL)('ListingEngine — intégration Postgres', async () => {
  const { prisma } = await import('@flipsync/db')
  const wallet = new WalletService(prisma)
  const engine = new ListingEngine(prisma, wallet)

  const EMAIL = 'engine-test@flipsync.fr'
  let userId = ''

  const resetUser = async (balance: number, freeListings: number): Promise<void> => {
    const stale = await prisma.user.findUnique({ where: { email: EMAIL } })
    if (stale) {
      await prisma.walletTransaction.deleteMany({ where: { wallet: { userId: stale.id } } })
      await prisma.listing.deleteMany({ where: { userId: stale.id } })
      await prisma.user.delete({ where: { id: stale.id } })
    }
    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        wallet: { create: { balance, freeListingsRemaining: freeListings } },
      },
    })
    userId = user.id
  }

  const getBalance = async (): Promise<number> =>
    (await prisma.userWallet.findUniqueOrThrow({ where: { userId } })).balance

  afterAll(async () => {
    await prisma.$disconnect()
  })

  describe('cycle nominal complet (WALLET, 1,99 €)', () => {
    let listingId = ''

    beforeAll(async () => {
      await resetUser(1000, 0) // 10,00 €, pas de free tier
    })

    it('createListing → AUTHORIZED, paymentSource WALLET, 0 débit', async () => {
      const { listing, auth } = await engine.createListing(userId, ListingTier.OPTIMIZED)
      listingId = listing.id

      expect(listing.status).toBe('AUTHORIZED')
      expect(listing.paymentSource).toBe('WALLET')
      expect(listing.cost).toBe(199)
      expect(auth.walletBalanceAfter).toBe(801) // projection seulement
      expect(await getBalance()).toBe(1000) // AUCUN débit réel
    })

    it('AI_PROCESSING → DRAFT_READY avec brouillon persisté', async () => {
      await engine.startAiProcessing(listingId)
      const listing = await engine.completeAiDraft(listingId, DRAFT)

      expect(listing.status).toBe('DRAFT_READY')
      expect(listing.titre).toBe(DRAFT.titre)
      expect(listing.prixHaut).toBe(12000)
      expect(await getBalance()).toBe(1000) // toujours 0 débit avant validation
    })

    it('validate → USER_VALIDATED + débit atomique + flag diplomatie', async () => {
      // prixPublie 15000 > 12000 * 1.2 = 14400 → flag
      const listing = await engine.validate(listingId, 15_000)

      expect(listing.status).toBe('USER_VALIDATED')
      expect(listing.prixPublie).toBe(15_000)
      expect(listing.isPriceFlagged).toBe(true)
      expect(await getBalance()).toBe(801) // débit 199 dans la MÊME transaction
    })

    it('queue → publish failed → remboursement automatique + failureReason', async () => {
      await engine.queue(listingId)
      const listing = await engine.failPublish(listingId, 'MARKETPLACE_TIMEOUT')

      expect(listing.status).toBe('PUBLISH_FAILED')
      expect(listing.failureReason).toBe('MARKETPLACE_TIMEOUT')
      expect(await getBalance()).toBe(1000) // remboursé intégralement

      const refunds = await prisma.walletTransaction.findMany({
        where: { listingId, type: 'REFUND' },
      })
      expect(refunds).toHaveLength(1)
      expect(refunds[0]?.amount).toBe(199)
    })

    it('PUBLISH_FAILED est terminal — aucune transition possible', async () => {
      await expect(engine.queue(listingId)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
      await expect(engine.cancel(listingId)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
    })
  })

  describe('chemins d’échec et de blocage', () => {
    it('AI_FAILED pré-commit : failureReason renseigné, 0 mouvement d’argent', async () => {
      await resetUser(1000, 0)
      const { listing } = await engine.createListing(userId, ListingTier.SIMPLE)
      await engine.startAiProcessing(listing.id)

      const failed = await engine.failAi(listing.id, 'AI_TIMEOUT')

      expect(failed.status).toBe('AI_FAILED')
      expect(failed.failureReason).toBe('AI_TIMEOUT')
      expect(await getBalance()).toBe(1000)
      const txs = await prisma.walletTransaction.findMany({ where: { listingId: listing.id } })
      expect(txs).toHaveLength(0) // ni débit ni remboursement — rien n'avait bougé
    })

    it('failureReason vide rejeté sur *_FAILED', async () => {
      await resetUser(1000, 0)
      const { listing } = await engine.createListing(userId, ListingTier.SIMPLE)
      await engine.startAiProcessing(listing.id)

      await expect(engine.failAi(listing.id, '  ')).rejects.toMatchObject({
        code: 'MISSING_FAILURE_REASON',
      })
    })

    it('fonds insuffisants → PENDING_AUTH + BLOCKED + deficit, puis reauthorize après recharge', async () => {
      await resetUser(100, 0) // 1,00 € pour un PREMIUM à 2,99 €
      const { listing, auth } = await engine.createListing(userId, ListingTier.PREMIUM)

      expect(listing.status).toBe('PENDING_AUTH')
      expect(listing.paymentSource).toBe('BLOCKED')
      expect(auth.authorized).toBe(false)
      expect(auth.deficit).toBe(199)

      // Recharge simulée puis nouvelle tentative
      await prisma.userWallet.update({ where: { userId }, data: { balance: 1000 } })
      const retry = await engine.reauthorize(listing.id)

      expect(retry.auth.authorized).toBe(true)
      expect(retry.listing.status).toBe('AUTHORIZED')
      expect(retry.listing.paymentSource).toBe('WALLET')
    })

    it('annulation pré-commit : USER_CANCELLED, 0 débit', async () => {
      await resetUser(1000, 0)
      const { listing } = await engine.createListing(userId, ListingTier.OPTIMIZED)
      await engine.startAiProcessing(listing.id)
      await engine.completeAiDraft(listing.id, DRAFT)

      const cancelled = await engine.cancel(listing.id)

      expect(cancelled.status).toBe('USER_CANCELLED')
      expect(await getBalance()).toBe(1000)
    })

    it('annulation post-commit depuis QUEUED : USER_CANCELLED, remboursement intégral', async () => {
      await resetUser(1000, 0)
      const { listing } = await engine.createListing(userId, ListingTier.OPTIMIZED)
      await engine.startAiProcessing(listing.id)
      await engine.completeAiDraft(listing.id, DRAFT)
      await engine.validate(listing.id, 10_000)
      await engine.queue(listing.id)
      expect(await getBalance()).toBe(801) // débité

      const cancelled = await engine.cancel(listing.id)

      expect(cancelled.status).toBe('USER_CANCELLED')
      expect(await getBalance()).toBe(1000) // remboursé intégralement

      const refunds = await prisma.walletTransaction.findMany({
        where: { listingId: listing.id, type: 'REFUND' },
      })
      expect(refunds).toHaveLength(1)
      expect(refunds[0]?.amount).toBe(199)
    })

    it('annulation impossible depuis PUBLISHED (retrait marketplace hors scope)', async () => {
      await resetUser(1000, 0)
      const { listing } = await engine.createListing(userId, ListingTier.OPTIMIZED)
      await engine.startAiProcessing(listing.id)
      await engine.completeAiDraft(listing.id, DRAFT)
      await engine.validate(listing.id, 10_000)
      await engine.queue(listing.id)
      await engine.markPublished(listing.id, { lbcUrl: 'https://leboncoin.fr/x/999' })

      await expect(engine.cancel(listing.id)).rejects.toMatchObject({ code: 'INVALID_TRANSITION' })
    })

    it('editContent : corrige titre/prix post-validation sans impact wallet, recalcule le flag prix', async () => {
      await resetUser(1000, 0)
      const { listing } = await engine.createListing(userId, ListingTier.OPTIMIZED)
      await engine.startAiProcessing(listing.id)
      await engine.completeAiDraft(listing.id, DRAFT)
      await engine.validate(listing.id, 10_000) // pas de flag (10000 <= 12000*1.2)

      const edited = await engine.editContent(listing.id, {
        titre: 'Veste cuir — révisée',
        prixPublie: 20_000, // > 12000*1.2 → flag désormais vrai
      })

      expect(edited.titre).toBe('Veste cuir — révisée')
      expect(edited.prixPublie).toBe(20_000)
      expect(edited.isPriceFlagged).toBe(true)
      expect(await getBalance()).toBe(801) // aucun mouvement d'argent
    })

    it('editContent refusé sur un listing pré-validation (pas encore "vivant")', async () => {
      await resetUser(1000, 0)
      const { listing } = await engine.createListing(userId, ListingTier.OPTIMIZED)

      await expect(
        engine.editContent(listing.id, { titre: 'Trop tôt' }),
      ).rejects.toMatchObject({ code: 'LISTING_NOT_EDITABLE' })
    })

    it('flux FREE_CREDIT : cost 0, commit consomme un crédit gratuit', async () => {
      await resetUser(0, 3)
      const { listing, auth } = await engine.createListing(userId, ListingTier.SIMPLE)

      expect(auth.source).toBe('FREE_CREDIT')
      expect(listing.cost).toBe(0)

      await engine.startAiProcessing(listing.id)
      await engine.completeAiDraft(listing.id, DRAFT)
      await engine.validate(listing.id, 9000)

      const w = await prisma.userWallet.findUniqueOrThrow({ where: { userId } })
      expect(w.freeListingsRemaining).toBe(2)
      expect(w.balance).toBe(0)
    })

    it('publication réussie : PUBLISHED + flags plateformes + publishedAt', async () => {
      await resetUser(1000, 0)
      const { listing } = await engine.createListing(userId, ListingTier.OPTIMIZED)
      await engine.startAiProcessing(listing.id)
      await engine.completeAiDraft(listing.id, DRAFT)
      await engine.validate(listing.id, 10_000)
      await engine.queue(listing.id)

      const published = await engine.markPublished(listing.id, {
        lbcUrl: 'https://leboncoin.fr/x/123',
      })

      expect(published.status).toBe('PUBLISHED')
      expect(published.publishedLbc).toBe(true)
      expect(published.publishedVinted).toBe(false)
      expect(published.publishedAt).not.toBeNull()
      expect(published.isPriceFlagged).toBe(false) // 10000 <= 14400

      const expired = await engine.expire(listing.id)
      expect(expired.status).toBe('EXPIRED')
    })
  })
})
