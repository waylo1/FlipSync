import { FastifyPluginAsync } from 'fastify'
import { prisma } from '@flipsync/db'

/**
 * Routes /wallet — toutes protégées par JWT (req.userId injecté par authPlugin).
 * Montants en centimes (Int) — la conversion € est l'affaire du mobile (centsToEur).
 * Le solde n'est JAMAIS exposé ailleurs que sur le wallet du propriétaire.
 */
const walletRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', app.authenticate)

  /** État du wallet de l'utilisateur courant. */
  app.get('/', async (req, reply) => {
    const wallet = await prisma.userWallet.findUnique({ where: { userId: req.userId } })
    if (!wallet) return reply.code(404).send({ error: 'WALLET_NOT_FOUND' })

    return {
      balance: wallet.balance,
      freeListingsRemaining: wallet.freeListingsRemaining,
      freeListingsResetAt: wallet.freeListingsResetAt,
      autoRechargeEnabled: wallet.autoRechargeEnabled,
      autoRechargeThreshold: wallet.autoRechargeThreshold,
      autoRechargeAmount: wallet.autoRechargeAmount,
      lifetimeRecharged: wallet.lifetimeRecharged,
    }
  })

  /** Historique des transactions (50 dernières). */
  app.get('/transactions', async (req, reply) => {
    const wallet = await prisma.userWallet.findUnique({ where: { userId: req.userId } })
    if (!wallet) return reply.code(404).send({ error: 'WALLET_NOT_FOUND' })

    const transactions = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        type: true,
        amount: true,
        source: true,
        listingId: true,
        description: true,
        createdAt: true,
      },
    })

    return { transactions }
  })
}

export default walletRoutes
