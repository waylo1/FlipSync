import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import Stripe from 'stripe'

/**
 * Test e2e du webhook Stripe sur Postgres réel, via fastify.inject avec une
 * VRAIE signature (generateTestHeaderString) — la vérification constructEvent
 * est exercée, pas contournée. Skippé si DATABASE_URL absent.
 */
const DB_URL = process.env.DATABASE_URL
const WEBHOOK_SECRET = 'whsec_test_e2e_flipsync'

describe.skipIf(!DB_URL)('POST /stripe/webhook — e2e', () => {
  let app: FastifyInstance
  let prismaRef: typeof import('@flipsync/db').prisma
  let userId = ''
  let blockedListingId = ''

  const EMAIL = 'stripe-webhook-test@flipsync.fr'

  const eventPayload = (piId: string, amount: number, uid: string): string =>
    JSON.stringify({
      id: `evt_${piId}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: piId,
          object: 'payment_intent',
          amount_received: amount,
          metadata: { userId: uid },
        },
      },
    })

  const signedHeaders = (payload: string): Record<string, string> => ({
    'content-type': 'application/json',
    'stripe-signature': new Stripe('sk_test_x').webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    }),
  })

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET

    const { prisma } = await import('@flipsync/db')
    prismaRef = prisma

    const stale = await prisma.user.findUnique({ where: { email: EMAIL } })
    if (stale) {
      await prisma.walletTransaction.deleteMany({ where: { wallet: { userId: stale.id } } })
      await prisma.listing.deleteMany({ where: { userId: stale.id } })
      await prisma.user.delete({ where: { id: stale.id } })
    }

    // Wallet vide + listing PREMIUM bloqué (3,00 € introuvables) → la recharge doit le débloquer.
    const user = await prisma.user.create({
      data: { email: EMAIL, wallet: { create: { balance: 0, freeListingsRemaining: 0 } } },
    })
    userId = user.id
    const listing = await prisma.listing.create({
      data: {
        userId,
        tier: 'PREMIUM',
        status: 'PENDING_AUTH',
        paymentSource: 'BLOCKED',
        cost: 300,
      },
    })
    blockedListingId = listing.id

    const { buildApp } = await import('./app')
    app = await buildApp()
  })

  afterAll(async () => {
    await app.close() // déclenche aussi prisma.$disconnect (hook onClose)
  })

  it('signature invalide → 400 INVALID_SIGNATURE, aucun crédit', async () => {
    const payload = eventPayload('pi_e2e_bad', 1000, userId)
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=forged' },
      payload,
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'INVALID_SIGNATURE' })

    const wallet = await prismaRef.userWallet.findUniqueOrThrow({ where: { userId } })
    expect(wallet.balance).toBe(0)
  })

  it('payment_intent.succeeded signé → crédit + bonus + reauthorize du listing bloqué', async () => {
    const payload = eventPayload('pi_e2e_1', 1000, userId)
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: signedHeaders(payload),
      payload,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      received: true,
      handled: true,
      credited: true,
      bonusApplied: true, // 1ère recharge >= 10,00 €
      reauthorizedListings: 1,
    })

    const wallet = await prismaRef.userWallet.findUniqueOrThrow({ where: { userId } })
    expect(wallet.balance).toBe(1100) // 1000 + 100 bonus
    expect(wallet.lifetimeRecharged).toBe(1000)

    const listing = await prismaRef.listing.findUniqueOrThrow({ where: { id: blockedListingId } })
    expect(listing.status).toBe('AUTHORIZED')
    expect(listing.paymentSource).toBe('WALLET')
  })

  it('rejeu du même event → idempotent, aucun double crédit', async () => {
    const payload = eventPayload('pi_e2e_1', 1000, userId)
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: signedHeaders(payload),
      payload,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ received: true, handled: true, credited: false })

    const wallet = await prismaRef.userWallet.findUniqueOrThrow({ where: { userId } })
    expect(wallet.balance).toBe(1100) // inchangé
  })

  it('event hors périmètre → acquitté sans action', async () => {
    const payload = JSON.stringify({
      id: 'evt_other',
      object: 'event',
      type: 'charge.refunded',
      data: { object: { id: 'ch_x', object: 'charge' } },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/stripe/webhook',
      headers: signedHeaders(payload),
      payload,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ received: true, handled: false })
  })

  it('les routes métier restent protégées par JWT (sanity)', async () => {
    const res = await app.inject({ method: 'GET', url: '/wallet' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'UNAUTHORIZED' })
  })
})
