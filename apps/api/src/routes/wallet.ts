import { FastifyPluginAsync } from 'fastify'
import Stripe from 'stripe'
import { prisma } from '@flipsync/db'
import { RECHARGE_AMOUNTS_CENTS } from '@flipsync/core'

/**
 * Routes /wallet — toutes protégées par JWT (req.userId injecté par authPlugin).
 * Montants en centimes (Int) — la conversion € est l'affaire du mobile (centsToEur).
 * Le solde n'est JAMAIS exposé ailleurs que sur le wallet du propriétaire.
 */
const walletRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', app.authenticate)

  // Client Stripe créé à la demande (jamais à l'enregistrement du plugin) : les
  // autres routes /wallet doivent rester utilisables même si Stripe n'est pas
  // encore configuré (clé test absente en dev précoce).
  let stripe: Stripe | null = null
  const getStripe = (): Stripe => {
    if (stripe) return stripe
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) throw new Error('STRIPE_ENV_MISSING')
    stripe = new Stripe(secretKey)
    return stripe
  }

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

  /**
   * Crée un PaymentIntent Stripe pour une recharge — le crédit effectif se fait
   * UNIQUEMENT via /stripe/webhook (payment_intent.succeeded), jamais ici.
   * metadata.userId est ce que le webhook lit pour créditer le bon wallet.
   */
  app.post<{ Body: { amountCents?: number } }>('/recharge/intent', async (req, reply) => {
    const amountCents = req.body?.amountCents
    if (
      typeof amountCents !== 'number' ||
      !Number.isInteger(amountCents) ||
      !RECHARGE_AMOUNTS_CENTS.includes(amountCents as (typeof RECHARGE_AMOUNTS_CENTS)[number])
    ) {
      return reply.code(400).send({ error: 'INVALID_AMOUNT' })
    }

    let intent: Stripe.PaymentIntent
    try {
      intent = await getStripe().paymentIntents.create({
        amount: amountCents,
        currency: 'eur',
        metadata: { userId: req.userId },
        automatic_payment_methods: { enabled: true },
      })
    } catch (err) {
      if (err instanceof Error && err.message === 'STRIPE_ENV_MISSING') {
        return reply.code(503).send({ error: 'STRIPE_NOT_CONFIGURED' })
      }
      req.log.error({ err }, 'création PaymentIntent échouée')
      return reply.code(502).send({ error: 'STRIPE_ERROR' })
    }

    if (!intent.client_secret) {
      return reply.code(502).send({ error: 'STRIPE_ERROR' })
    }
    return { clientSecret: intent.client_secret }
  })
}

export default walletRoutes
