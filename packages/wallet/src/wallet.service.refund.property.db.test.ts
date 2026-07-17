import fc from 'fast-check'
import { afterAll, describe, expect, it } from 'vitest'
import { WalletService } from './wallet.service'

/**
 * P-06 — remboursement unique (INVARIANT-SPEC §3, raffine le test H3 de
 * wallet.service.db.test.ts). Propriété : rejouer `refund()` N fois sur un
 * même débit ⇒ un seul mouvement REFUND, quel que soit N. Exécuté sur Postgres
 * réel (conteneur local flipsync-pg) — skip silencieux si DATABASE_URL absent.
 *
 * Portée volontairement limitée aux rejeux SÉQUENTIELS : `refundWithin` fait
 * un `findFirst` puis un `create` sans contrainte unique DB sur
 * (listingId, type=REFUND) — un rejeu CONCURRENT pourrait théoriquement passer
 * les deux `findFirst` avant que l'un des `create` ne commite (race). Ce
 * risque est distinct de la propriété testée ici (rejeu séquentiel, le cas
 * réel — retry applicatif après échec réseau) et n'est pas corrigé dans cette
 * session (aucun refactoring de code de production hors mandat P-06).
 */
const DB_URL = process.env.DATABASE_URL

describe.skipIf(!DB_URL)('P-06 — remboursement unique (Postgres réel)', async () => {
  const { prisma } = await import('@flipsync/db')
  const svc = new WalletService(prisma)

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('replay(refund, k) ≡ un seul mouvement REFUND, pour tout k', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async k => {
        const email = `p06-${Date.now()}-${Math.random().toString(36).slice(2)}@flipsync.fr`
        const user = await prisma.user.create({
          data: { email, wallet: { create: { balance: 1000, freeListingsRemaining: 0 } } },
        })
        const listing = await prisma.listing.create({
          data: {
            userId: user.id,
            tier: 'SIMPLE',
            status: 'USER_VALIDATED',
            paymentSource: 'WALLET',
            cost: 250,
          },
        })
        await svc.commit(listing.id)

        for (let i = 0; i < k; i++) {
          await svc.refund(listing.id, 'PUBLISH_FAILED')
        }

        const wallet = await prisma.userWallet.findUniqueOrThrow({ where: { userId: user.id } })
        expect(wallet.balance).toBe(1000) // débité puis remboursé une seule fois, jamais plus

        const refunds = await prisma.walletTransaction.findMany({
          where: { listingId: listing.id, type: 'REFUND' },
        })
        expect(refunds).toHaveLength(1)
        expect(refunds[0]?.amount).toBe(250)
      }),
      { numRuns: 8 },
    )
  })
})
