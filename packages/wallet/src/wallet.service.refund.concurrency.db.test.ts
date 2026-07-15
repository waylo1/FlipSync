import { describe, expect, it, afterAll } from 'vitest'
import { WalletService } from './wallet.service'

/**
 * Preuve par le test — correction de la faille de concurrence sur `refundWithin`
 * (contrainte `@@unique([listingId, type])` sur `WalletTransaction`, migration
 * 20260715212521_refund_debit_unique_per_listing). 5 appels `refund()` strictement
 * simultanés (Promise.all, pas de rejeu séquentiel) sur le même débit : un seul
 * doit produire le mouvement REFUND, les 4 autres no-op sans lever, solde
 * jamais recrédité plus d'une fois.
 */
const DB_URL = process.env.DATABASE_URL

describe.skipIf(!DB_URL)('WalletService.refund — concurrence stricte (Postgres réel)', async () => {
  const { prisma } = await import('@flipsync/db')
  const svc = new WalletService(prisma)

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('5 refund() concurrents sur le même listing ⇒ un seul REFUND, solde correct', async () => {
    const email = `p06-race-${Date.now()}-${Math.random().toString(36).slice(2)}@flipsync.fr`
    const user = await prisma.user.create({
      data: { email, wallet: { create: { balance: 1000, freeListingsRemaining: 0 } } },
    })
    const listing = await prisma.listing.create({
      data: {
        userId: user.id,
        tier: 'OPTIMIZED',
        status: 'USER_VALIDATED',
        paymentSource: 'WALLET',
        cost: 250,
      },
    })
    await svc.commit(listing.id)

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => svc.refund(listing.id, 'PUBLISH_FAILED')),
    )

    // Aucun appel ne doit lever — le perdant de la course est un no-op silencieux.
    for (const r of results) {
      expect(r.status).toBe('fulfilled')
    }

    const wallet = await prisma.userWallet.findUniqueOrThrow({ where: { userId: user.id } })
    expect(wallet.balance).toBe(1000) // jamais plus d'un remboursement

    const refunds = await prisma.walletTransaction.findMany({
      where: { listingId: listing.id, type: 'REFUND' },
    })
    expect(refunds).toHaveLength(1)
    expect(refunds[0]?.amount).toBe(250)
  })
})
