import { FastifyPluginAsync } from 'fastify'
import Stripe from 'stripe'
import { prisma, ListingStatus, PaymentSource } from '@flipsync/db'

/**
 * Routes /stripe — webhook entrant.
 *
 * Exception JWT documentée : un webhook Stripe est un callback externe ; il ne
 * peut pas porter de JWT. L'authenticité est garantie par la signature
 * constructEvent() — JAMAIS skippée, même en dev (cf. gotchas.md).
 *
 * Idempotence : WalletService.recharge() + contrainte UNIQUE sur stripeId —
 * Stripe peut livrer un event plusieurs fois, le wallet n'est crédité qu'une.
 *
 * Après crédit : les listings PENDING_AUTH/BLOCKED de l'utilisateur sont
 * automatiquement re-soumis à autorisation (reauthorize) — la recharge
 * débloque la file sans action utilisateur.
 */
const stripeRoutes: FastifyPluginAsync = async app => {
  const secretKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secretKey || !webhookSecret) {
    throw new Error('STRIPE_ENV_MISSING') // fail fast : pas d'API sans config Stripe
  }
  const stripe = new Stripe(secretKey)

  // constructEvent exige les octets EXACTS du body — parser raw scopé à ce plugin.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  )

  app.post('/webhook', async (req, reply) => {
    const signature = req.headers['stripe-signature']
    if (typeof signature !== 'string') {
      return reply.code(400).send({ error: 'MISSING_SIGNATURE' })
    }

    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(req.body as Buffer, signature, webhookSecret)
    } catch {
      return reply.code(400).send({ error: 'INVALID_SIGNATURE' })
    }

    if (event.type !== 'payment_intent.succeeded') {
      return { received: true, handled: false } // event hors périmètre — acquitté
    }

    const intent = event.data.object as Stripe.PaymentIntent
    const userId = intent.metadata['userId']
    if (!userId) {
      // PaymentIntent étranger au wallet (pas de metadata.userId) — acquitté sans action.
      req.log.warn({ intentId: intent.id }, 'payment_intent sans metadata.userId')
      return { received: true, handled: false }
    }

    const result = await app.walletService.recharge(userId, intent.amount_received, intent.id)

    // Recharge effective → re-tenter l'autorisation des listings bloqués.
    let reauthorized = 0
    if (result.credited) {
      const blocked = await prisma.listing.findMany({
        where: {
          userId,
          status: ListingStatus.PENDING_AUTH,
          paymentSource: PaymentSource.BLOCKED,
        },
        select: { id: true },
      })
      for (const { id } of blocked) {
        try {
          const retry = await app.listingEngine.reauthorize(id)
          if (retry.auth.authorized) reauthorized += 1
        } catch (err) {
          // Course concurrente (annulation pendant la recharge…) — on continue.
          req.log.warn({ err, listingId: id }, 'reauthorize après recharge échoué')
        }
      }
    }

    return {
      received: true,
      handled: true,
      credited: result.credited,
      bonusApplied: result.bonusApplied,
      reauthorizedListings: reauthorized,
    }
  })
}

export default stripeRoutes
