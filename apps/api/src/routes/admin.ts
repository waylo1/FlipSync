import { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { prisma, ListingStatus, TransactionType } from '@flipsync/db'
import { Marketplace } from '@flipsync/marketplace'

const DAY_MS = 24 * 60 * 60 * 1000

type ConnectorState = 'MISSING' | 'MOCK' | 'LIVE'

/**
 * Liste blanche d'emails admin (CSV, ex: "a@x.com,b@y.com"). Aucun rôle en
 * base — décision volontaire pour éviter une migration Prisma pour une seule
 * console interne. Vide/absent → aucun accès (fail-closed).
 */
const adminEmails = () =>
  new Set(
    (process.env.ADMIN_EMAILS ?? '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean),
  )

/**
 * Garde admin : réutilise le JWT existant (payload inchangé, { sub: userId }
 * uniquement) — lookup DB de l'email plutôt que d'enrichir le token.
 */
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { email: true } })
  if (!user || !adminEmails().has(user.email.toLowerCase())) {
    return reply.code(403).send({ error: 'NOT_ADMIN' })
  }
}

/** Mode mock global (cf. plugins/services.ts) — jamais actif en production. */
const marketplaceMockEnabled = () =>
  process.env.MARKETPLACE_MOCK === '1' && process.env.NODE_ENV !== 'production'

function connectorState(marketplace: Marketplace): ConnectorState {
  if (marketplaceMockEnabled()) return 'MOCK'
  const token =
    marketplace === Marketplace.VINTED
      ? process.env.VINTED_ACCESS_TOKEN
      : process.env.LEBONCOIN_ACCESS_TOKEN
  return token ? 'LIVE' : 'MISSING'
}

/**
 * Routes /admin — console de supervision interne (Mission Control).
 * Protégées par JWT (authenticate) + garde ADMIN_EMAILS (requireAdmin).
 * Lecture seule, agrégats uniquement — jamais de données nominatives.
 */
const adminRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', app.authenticate)
  app.addHook('preHandler', requireAdmin)

  app.get('/overview', async () => {
    const since24h = new Date(Date.now() - DAY_MS)

    const [byStatus, aiFailed24h, publishFailed24h, walletAgg24h, walletTotals] = await Promise.all([
      prisma.listing.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.listing.count({
        where: { status: ListingStatus.AI_FAILED, updatedAt: { gte: since24h } },
      }),
      prisma.listing.count({
        where: { status: ListingStatus.PUBLISH_FAILED, updatedAt: { gte: since24h } },
      }),
      prisma.walletTransaction.groupBy({
        by: ['type'],
        _sum: { amount: true },
        where: { createdAt: { gte: since24h } },
      }),
      prisma.userWallet.aggregate({ _sum: { balance: true } }),
    ])

    const statusCounts = Object.fromEntries(
      Object.values(ListingStatus).map(status => [status, 0]),
    ) as Record<ListingStatus, number>
    for (const row of byStatus) statusCounts[row.status] = row._count._all

    const total = Object.values(statusCounts).reduce((sum, n) => sum + n, 0)

    const sumByType = (type: TransactionType) =>
      walletAgg24h.find(row => row.type === type)?._sum.amount ?? 0

    return {
      health: { status: 'ok' as const, ts: new Date().toISOString() },
      listings: { byStatus: statusCounts, total },
      ai: {
        processing: statusCounts[ListingStatus.AI_PROCESSING],
        failed24h: aiFailed24h,
      },
      marketplace: {
        vinted: connectorState(Marketplace.VINTED),
        leboncoin: connectorState(Marketplace.LEBONCOIN),
        publishFailed24h,
      },
      wallet: {
        totalBalance: walletTotals._sum.balance ?? 0, // centimes
        debited24h: sumByType(TransactionType.DEBIT), // centimes
        refunded24h: sumByType(TransactionType.REFUND), // centimes
      },
    }
  })
}

export default adminRoutes
