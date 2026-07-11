import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * Test e2e du tableau de bord Mission (COMMISSAIRE_PRISEUR_PLAN.md §10 Lot 5) :
 * le canal simulé (Lot 4) alimente réellement le dashboard — bandeau,
 * timeline, carte « en attente de vous » — et le menu ⋯ (suspendre/reprendre/
 * arrêter). Couvre R1 (plancher), R4 (coup de marteau/zéro-clic), R6 (cas
 * hors mandat) et les transitions §6 jusqu'à VENDU.
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

describe.skipIf(!DB_URL)('Flux mobile /mission — tableau de bord + canal simulé (e2e JWT)', () => {
  let app: FastifyInstance
  let token = ''
  let otherToken = ''
  let userId = ''

  const EMAIL = 'negotiation-flow-test@flipsync.fr'
  const OTHER_EMAIL = 'negotiation-flow-other@flipsync.fr'

  const authed = (t: string) => ({ authorization: `Bearer ${t}` })

  /** Crée un listing PUBLISHED + sa Mission EN_VENTE fraîche (mandat au choix). */
  async function freshMission(prisma: typeof import('@flipsync/db').prisma, mandate = MANDATE) {
    const listing = await prisma.listing.create({
      data: { userId, tier: 'PREMIUM', status: 'PUBLISHED', paymentSource: 'WALLET', cost: 299 },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/mission',
      headers: authed(token),
      payload: { listingId: listing.id, mandate },
    })
    const missionId = (res.json() as { mission: { id: string } }).mission.id
    return { listingId: listing.id, missionId }
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    process.env.AUTH_RATE_LIMIT_MAX = '1000'

    const { prisma } = await import('@flipsync/db')

    for (const email of [EMAIL, OTHER_EMAIL]) {
      const stale = await prisma.user.findUnique({ where: { email } })
      if (stale) {
        await prisma.missionEvent.deleteMany({ where: { mission: { userId: stale.id } } })
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

    const { buildApp } = await import('./app')
    app = await buildApp()
    token = app.jwt.sign({ sub: userId })
    otherToken = app.jwt.sign({ sub: other.id })
  })

  afterAll(async () => {
    await app.close()
  })

  it('dashboard frais : EN_VENTE, aucun événement — écran serein (§5.4)', async () => {
    const { listingId } = await freshMission(await import('@flipsync/db').then(m => m.prisma))
    const res = await app.inject({
      method: 'GET',
      url: `/mission/by-listing/${listingId}`,
      headers: authed(token),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { mission: { status: string; activeBuyerCount: number }; events: unknown[] }
    expect(body.mission.status).toBe('EN_VENTE')
    expect(body.mission.activeBuyerCount).toBe(0)
    expect(body.events).toEqual([])
  })

  it('un autre utilisateur ne peut pas lire cette mission (404, pas de fuite)', async () => {
    const { listingId } = await freshMission(await import('@flipsync/db').then(m => m.prisma))
    const res = await app.inject({
      method: 'GET',
      url: `/mission/by-listing/${listingId}`,
      headers: authed(otherToken),
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'MISSION_NOT_FOUND' })
  })

  it('question factuelle → réponse auto, sort de la veille (NEGOCIATION_ACTIVE)', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma)

    const res = await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: { kind: 'QUESTION', buyerId: 'b1', buyerName: 'Julien M.', text: 'Encore dispo ?' },
    })
    expect(res.statusCode).toBe(200)
    const mission = (res.json() as { mission: { status: string; activeBuyerCount: number } }).mission
    expect(mission.status).toBe('NEGOCIATION_ACTIVE')
    expect(mission.activeBuyerCount).toBe(1)

    const dashboard = await app.inject({
      method: 'GET',
      url: `/mission/${missionId}`,
      headers: authed(token),
    })
    const events = (dashboard.json() as { events: { kind: string; summary: string }[] }).events
    expect(events).toHaveLength(1)
    expect(events[0]?.kind).toBe('AUTO_REPLY')
  })

  it('offre sous le prix mini (R1) → déclinée, jamais de validation', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma)

    const res = await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: {
        kind: 'OFFER',
        offer: { buyerId: 'b1', buyerName: 'Julien M.', amount: 7_999, signals: { verified: true } },
      },
    })
    const mission = (res.json() as { mission: { status: string; pendingReason: string | null } }).mission
    expect(mission.status).toBe('NEGOCIATION_ACTIVE')
    expect(mission.pendingReason).toBeNull()
  })

  it('offre au-dessus du mini, coup de marteau humain (R4) → EN_ATTENTE_VALIDATION', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma)

    const res = await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: {
        kind: 'OFFER',
        offer: { buyerId: 'b1', buyerName: 'Julien M.', amount: 9_000, signals: { verified: true } },
      },
    })
    const mission = (
      res.json() as {
        mission: { status: string; pendingReason: string | null; pendingOfferAmount: number | null; bestOfferAmount: number | null }
      }
    ).mission
    expect(mission.status).toBe('EN_ATTENTE_VALIDATION')
    expect(mission.pendingReason).toBe('OFFER')
    expect(mission.pendingOfferAmount).toBe(9_000)
    expect(mission.bestOfferAmount).toBe(9_000)
  })

  it('cas hors mandat (R6, REFUSER) → décliné, jamais de validation', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma, { ...MANDATE, casComplexes: 'REFUSER' })

    const res = await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: { kind: 'COMPLEX_CASE', buyerId: 'b1', buyerName: 'Julien M.', question: 'Échange possible ?' },
    })
    const mission = (res.json() as { mission: { status: string; pendingReason: string | null } }).mission
    expect(mission.status).toBe('NEGOCIATION_ACTIVE')
    expect(mission.pendingReason).toBeNull()
  })

  it('opt-in coup de marteau (R4 zéro-clic) → offre ≥ mini vendue directement (VENDU)', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma, { ...MANDATE, autoAdjugeAuDessusDuMini: true })

    const res = await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: {
        kind: 'OFFER',
        offer: { buyerId: 'b1', buyerName: 'Julien M.', amount: 9_500, signals: { verified: true } },
      },
    })
    const mission = (
      res.json() as { mission: { status: string; soldAmount: number | null; soldAt: string | null } }
    ).mission
    expect(mission.status).toBe('VENDU')
    expect(mission.soldAmount).toBe(9_500)
    expect(mission.soldAt).not.toBeNull()
  })

  it('menu ⋯ : suspendre puis reprendre restaure exactement l’état précédent', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma)

    await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: { kind: 'QUESTION', buyerId: 'b1', buyerName: 'Julien M.', text: 'Dispo ?' },
    })

    const suspend = await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/suspend`,
      headers: authed(token),
    })
    expect((suspend.json() as { mission: { status: string } }).mission.status).toBe('SUSPENDUE')

    const resume = await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/resume`,
      headers: authed(token),
    })
    expect((resume.json() as { mission: { status: string } }).mission.status).toBe('NEGOCIATION_ACTIVE')
  })

  it('S5 : accepter une offre au-dessus du mini → VENDU (Lot 6)', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma)

    await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: {
        kind: 'OFFER',
        offer: { buyerId: 'b1', buyerName: 'Julien M.', amount: 9_000, signals: { verified: true } },
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/resolve-validation`,
      headers: authed(token),
      payload: { action: 'ACCEPT' },
    })
    expect(res.statusCode).toBe(200)
    const mission = (
      res.json() as {
        mission: {
          status: string
          soldAmount: number | null
          pendingReason: string | null
          pendingOfferAmount: number | null
        }
      }
    ).mission
    expect(mission.status).toBe('VENDU')
    expect(mission.soldAmount).toBe(9_000)
    expect(mission.pendingReason).toBeNull()
    expect(mission.pendingOfferAmount).toBeNull()
  })

  it('S5 : laisser l’IA continuer → retour en négociation, rien engagé', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma)

    await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: {
        kind: 'OFFER',
        offer: { buyerId: 'b1', buyerName: 'Julien M.', amount: 9_000, signals: { verified: true } },
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/resolve-validation`,
      headers: authed(token),
      payload: { action: 'CONTINUE' },
    })
    const mission = (res.json() as { mission: { status: string; soldAmount: number | null } }).mission
    expect(mission.status).toBe('NEGOCIATION_ACTIVE')
    expect(mission.soldAmount).toBeNull()
  })

  it('S5 : refuser une offre → retour en négociation, jamais vendu', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma)

    await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: {
        kind: 'OFFER',
        offer: { buyerId: 'b1', buyerName: 'Julien M.', amount: 9_000, signals: { verified: true } },
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/resolve-validation`,
      headers: authed(token),
      payload: { action: 'DECLINE' },
    })
    const mission = (res.json() as { mission: { status: string; soldAmount: number | null } }).mission
    expect(mission.status).toBe('NEGOCIATION_ACTIVE')
    expect(mission.soldAmount).toBeNull()
  })

  it('S5 : offre retirée — résoudre une validation déjà tranchée renvoie une erreur propre (Lot 6)', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma)

    await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: {
        kind: 'OFFER',
        offer: { buyerId: 'b1', buyerName: 'Julien M.', amount: 9_000, signals: { verified: true } },
      },
    })

    // Première résolution : vend l'offre — la validation n'est plus en attente.
    await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/resolve-validation`,
      headers: authed(token),
      payload: { action: 'ACCEPT' },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/resolve-validation`,
      headers: authed(token),
      payload: { action: 'ACCEPT' },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'VALIDATION_NOT_PENDING' })
  })

  it('§7 : une validation requise fixe lastNotifiedAt (anti-spam, Lot 8)', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma)

    await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: {
        kind: 'OFFER',
        offer: { buyerId: 'b1', buyerName: 'Julien M.', amount: 9_000, signals: { verified: true } },
      },
    })

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })
    expect(mission.lastNotifiedAt).not.toBeNull()
  })

  it('§7 : une 2ᵉ validation dans l’heure ne redéclenche pas la notif (anti-spam)', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma)

    await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: {
        kind: 'OFFER',
        offer: { buyerId: 'b1', buyerName: 'Julien M.', amount: 9_000, signals: { verified: true } },
      },
    })
    const first = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })

    await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/resolve-validation`,
      headers: authed(token),
      payload: { action: 'CONTINUE' },
    })
    await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: {
        kind: 'OFFER',
        offer: { buyerId: 'b2', buyerName: 'Amina K.', amount: 9_200, signals: { verified: true } },
      },
    })

    const second = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })
    expect(second.lastNotifiedAt?.getTime()).toBe(first.lastNotifiedAt?.getTime())
  })

  it('§7 : une vente (SOLD) ne touche jamais lastNotifiedAt — pas de quota consommé', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma, { ...MANDATE, autoAdjugeAuDessusDuMini: true })

    await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/simulate`,
      headers: authed(token),
      payload: {
        kind: 'OFFER',
        offer: { buyerId: 'b1', buyerName: 'Julien M.', amount: 9_500, signals: { verified: true } },
      },
    })

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })
    expect(mission.status).toBe('VENDU')
    expect(mission.lastNotifiedAt).toBeNull()
  })

  it('menu ⋯ : arrêter — irréversible, aucun RESUMED possible ensuite', async () => {
    const { prisma } = await import('@flipsync/db')
    const { missionId } = await freshMission(prisma)

    const stop = await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/stop`,
      headers: authed(token),
    })
    expect((stop.json() as { mission: { status: string } }).mission.status).toBe('ARRETEE')

    const resume = await app.inject({
      method: 'POST',
      url: `/mission/${missionId}/resume`,
      headers: authed(token),
    })
    expect(resume.statusCode).toBe(409)
    expect(resume.json()).toEqual({ error: 'NOTHING_TO_RESUME' })
  })
})
