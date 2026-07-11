import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * Test e2e du flux mandat Premium (COMMISSAIRE_PRISEUR_PLAN.md §10 Lot 3) :
 * POST /mission crée la Mission (mandat persisté) puis la fait franchir
 * BROUILLON_MANDAT → EN_VENTE via le service stub — pas encore de négociation
 * (Lot 4). C'est EXACTEMENT ce que l'écran S3 « Votre mandat » déclenchera.
 */
const DB_URL = process.env.DATABASE_URL

const MANDATE = {
  posture: 'EQUILIBRE',
  objectif: 'EQUILIBRE',
  prixAffiche: 12_000,
  prixMini: 8_000,
  livraison: 'LES_DEUX',
  casComplexes: 'ME_DEMANDER',
  autoAdjugeAuDessusDuMini: false,
}

describe.skipIf(!DB_URL)('Flux mobile /mission — e2e JWT', () => {
  let app: FastifyInstance
  let prismaRef: typeof import('@flipsync/db').prisma
  let token = ''
  let otherToken = ''
  let userId = ''
  let listingId = ''

  const EMAIL = 'mission-flow-test@flipsync.fr'
  const OTHER_EMAIL = 'mission-flow-other@flipsync.fr'

  const authed = (t: string) => ({ authorization: `Bearer ${t}` })

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    process.env.AUTH_RATE_LIMIT_MAX = '1000'

    const { prisma } = await import('@flipsync/db')
    prismaRef = prisma

    for (const email of [EMAIL, OTHER_EMAIL]) {
      const stale = await prisma.user.findUnique({ where: { email } })
      if (stale) {
        await prisma.mission.deleteMany({ where: { userId: stale.id } })
        await prisma.walletTransaction.deleteMany({ where: { wallet: { userId: stale.id } } })
        await prisma.listing.deleteMany({ where: { userId: stale.id } })
        await prisma.user.delete({ where: { id: stale.id } })
      }
    }

    const user = await prisma.user.create({
      data: { email: EMAIL, wallet: { create: { balance: 1000, freeListingsRemaining: 0 } } },
    })
    userId = user.id
    const other = await prisma.user.create({
      data: { email: OTHER_EMAIL, wallet: { create: { balance: 0 } } },
    })

    const listing = await prisma.listing.create({
      data: {
        userId,
        tier: 'PREMIUM',
        status: 'QUEUED',
        paymentSource: 'WALLET',
        cost: 299,
      },
    })
    listingId = listing.id

    const { buildApp } = await import('./app')
    app = await buildApp()
    token = app.jwt.sign({ sub: userId })
    otherToken = app.jwt.sign({ sub: other.id })
  })

  afterAll(async () => {
    await app.close()
  })

  it('mandat invalide (prixMini > prixAffiche) → 400 INVALID_MANDATE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mission',
      headers: authed(token),
      payload: { listingId, mandate: { ...MANDATE, prixMini: 20_000 } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'INVALID_MANDATE' })
  })

  it('un autre utilisateur ne peut pas créer de mission sur ce listing (404, pas de fuite)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mission',
      headers: authed(otherToken),
      payload: { listingId, mandate: MANDATE },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'LISTING_NOT_FOUND' })
  })

  it('POST /mission → mandat persisté, BROUILLON_MANDAT → EN_VENTE', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mission',
      headers: authed(token),
      payload: { listingId, mandate: MANDATE },
    })
    expect(res.statusCode).toBe(200)
    const mission = (
      res.json() as {
        mission: {
          id: string
          status: string
          listingId: string
          prixMini: number
          enVenteAt: string | null
        }
      }
    ).mission
    expect(mission.status).toBe('EN_VENTE')
    expect(mission.listingId).toBe(listingId)
    expect(mission.prixMini).toBe(8_000)
    expect(mission.enVenteAt).not.toBeNull()

    const persisted = await prismaRef.mission.findUniqueOrThrow({ where: { listingId } })
    expect(persisted.status).toBe('EN_VENTE')
    expect(persisted.posture).toBe('EQUILIBRE')
  })

  it('re-confirmation du même listing → 409 ALREADY_COMMITTED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/mission',
      headers: authed(token),
      payload: { listingId, mandate: MANDATE },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'ALREADY_COMMITTED' })
  })
})
