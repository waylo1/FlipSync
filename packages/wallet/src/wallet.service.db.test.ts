import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WalletService } from './wallet.service'

/**
 * Test d'intégration sur Postgres réel (conteneur local flipsync-pg).
 * Exécuté uniquement si DATABASE_URL est défini — skip silencieux sinon (CI sans DB).
 * Vérifie le cycle complet : authorize → commit → refund sur le vrai schéma.
 */
const DB_URL = process.env.DATABASE_URL

describe.skipIf(!DB_URL)('WalletService — intégration Postgres', async () => {
  // Import dynamique : ne pas instancier PrismaClient quand le test est skippé.
  const { prisma } = await import('@flipsync/db')
  const svc = new WalletService(prisma)

  const EMAIL = 'integration-test@flipsync.fr'
  let userId = ''
  let listingId = ''

  beforeAll(async () => {
    // Nettoyage d'une exécution précédente puis jeu de données frais.
    const stale = await prisma.user.findUnique({ where: { email: EMAIL } })
    if (stale) {
      await prisma.walletTransaction.deleteMany({
        where: { wallet: { userId: stale.id } },
      })
      await prisma.listing.deleteMany({ where: { userId: stale.id } })
      await prisma.user.delete({ where: { id: stale.id } }) // cascade wallet
    }

    const user = await prisma.user.create({
      data: {
        email: EMAIL,
        wallet: {
          create: { balance: 1000, freeListingsRemaining: 0 }, // 10,00 € — pas de free tier
        },
      },
    })
    userId = user.id

    const listing = await prisma.listing.create({
      data: {
        userId,
        tier: 'OPTIMIZED',
        status: 'USER_VALIDATED',
        paymentSource: 'WALLET',
        cost: 250, // 2,50 €
      },
    })
    listingId = listing.id
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('authorize → WALLET avec projection correcte', async () => {
    const res = await svc.authorize(userId, 250)
    expect(res.authorized).toBe(true)
    expect(res.source).toBe('WALLET')
    expect(res.walletBalanceBefore).toBe(1000)
    expect(res.walletBalanceAfter).toBe(750)
  })

  it('commit → débit atomique 250 centimes + journal DEBIT', async () => {
    await svc.commit(listingId)

    const wallet = await prisma.userWallet.findUniqueOrThrow({ where: { userId } })
    expect(wallet.balance).toBe(750)

    const debit = await prisma.walletTransaction.findFirstOrThrow({
      where: { listingId, type: 'DEBIT' },
    })
    expect(debit.amount).toBe(250)
    expect(debit.source).toBe('WALLET')
  })

  it('second commit rejeté — pas de double débit', async () => {
    await expect(svc.commit(listingId)).rejects.toMatchObject({ code: 'ALREADY_COMMITTED' })
    const wallet = await prisma.userWallet.findUniqueOrThrow({ where: { userId } })
    expect(wallet.balance).toBe(750)
  })

  it('recharge → crédit + bonus fidélité 1ère recharge >= 10,00 €, idempotence stripeId', async () => {
    // Utilisateur dédié — indépendant de l'état partagé des autres tests.
    const EMAIL_R = 'recharge-test@flipsync.fr'
    const stale = await prisma.user.findUnique({ where: { email: EMAIL_R } })
    if (stale) {
      await prisma.walletTransaction.deleteMany({ where: { wallet: { userId: stale.id } } })
      await prisma.user.delete({ where: { id: stale.id } })
    }
    const user = await prisma.user.create({
      data: { email: EMAIL_R, wallet: { create: { balance: 0, freeListingsRemaining: 0 } } },
    })

    // 1ère recharge 10,00 € → +1,00 € bonus
    const first = await svc.recharge(user.id, 1000, 'pi_test_first')
    expect(first).toMatchObject({ credited: true, amount: 1000, bonusApplied: true, balance: 1100 })

    let wallet = await prisma.userWallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.balance).toBe(1100)
    expect(wallet.lifetimeRecharged).toBe(1000) // le bonus n'est PAS une recharge

    // Rejeu du même event Stripe → no-op
    const replay = await svc.recharge(user.id, 1000, 'pi_test_first')
    expect(replay.credited).toBe(false)
    wallet = await prisma.userWallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.balance).toBe(1100)

    // 2ème recharge → pas de bonus
    const second = await svc.recharge(user.id, 1000, 'pi_test_second')
    expect(second).toMatchObject({ credited: true, bonusApplied: false, balance: 2100 })
    wallet = await prisma.userWallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.lifetimeRecharged).toBe(2000)

    const bonuses = await prisma.walletTransaction.findMany({
      where: { wallet: { userId: user.id }, type: 'BONUS' },
    })
    expect(bonuses).toHaveLength(1)
    expect(bonuses[0]?.amount).toBe(100)
  })

  it('refund → recrédit exact + idempotence', async () => {
    await svc.refund(listingId, 'PUBLISH_FAILED')
    await svc.refund(listingId, 'PUBLISH_FAILED') // no-op

    const wallet = await prisma.userWallet.findUniqueOrThrow({ where: { userId } })
    expect(wallet.balance).toBe(1000)

    const refunds = await prisma.walletTransaction.findMany({
      where: { listingId, type: 'REFUND' },
    })
    expect(refunds).toHaveLength(1)
    expect(refunds[0]?.amount).toBe(250)
  })
})
