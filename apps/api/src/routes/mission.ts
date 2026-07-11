import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ComplexCasePolicy, DeliveryPreference, SellObjective, SellPosture } from '@flipsync/core'
import { devActionsEnabled } from '../services/dev-actions.service'

const mandateBody = z.object({
  listingId: z.string().min(1),
  mandate: z.object({
    posture: z.nativeEnum(SellPosture),
    objectif: z.nativeEnum(SellObjective),
    prixAffiche: z.number().int().nonnegative(),
    prixMini: z.number().int().nonnegative(),
    livraison: z.nativeEnum(DeliveryPreference),
    casComplexes: z.nativeEnum(ComplexCasePolicy),
    autoAdjugeAuDessusDuMini: z.boolean(),
  }),
})

const buyerSignals = z.object({ verified: z.boolean() })

const resolveValidationBody = z.object({
  action: z.enum(['ACCEPT', 'CONTINUE', 'DECLINE']),
})

/** Miroir zod de `IncomingMessage` (@flipsync/core) — frontière de validation du canal simulé. */
const simulateBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('QUESTION'), buyerId: z.string().min(1), buyerName: z.string().min(1), text: z.string().min(1) }),
  z.object({
    kind: z.literal('OFFER'),
    offer: z.object({
      buyerId: z.string().min(1),
      buyerName: z.string().min(1),
      amount: z.number().int().nonnegative(),
      signals: buyerSignals,
    }),
  }),
  z.object({
    kind: z.literal('DELIVERY_REQUEST'),
    buyerId: z.string().min(1),
    buyerName: z.string().min(1),
    mode: z.nativeEnum(DeliveryPreference),
  }),
  z.object({ kind: z.literal('OFF_PLATFORM_PAYMENT'), buyerId: z.string().min(1), buyerName: z.string().min(1), text: z.string().min(1) }),
  z.object({ kind: z.literal('COMPLEX_CASE'), buyerId: z.string().min(1), buyerName: z.string().min(1), question: z.string().min(1) }),
])

/**
 * Mission — Commissaire-Priseur IA (COMMISSAIRE_PRISEUR_PLAN.md §10 Lots 3-5).
 * POST / confirme le mandat (S3). GET /:id et GET /by-listing/:listingId
 * alimentent le tableau de bord (S4). suspend/resume/stop = menu ⋯. simulate
 * injecte un message dans le canal simulé — dev/démo uniquement (§1, §9) : le
 * canal réel n'existe pas encore, on ne simule jamais de négociation en prod.
 */
const missionRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', app.authenticate)

  app.post('/', async (req, reply) => {
    const body = mandateBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const mission = await app.missionService.confirmMandate(
      req.userId,
      body.data.listingId,
      body.data.mandate,
    )
    return { mission }
  })

  app.get('/by-listing/:listingId', async req => {
    const { listingId } = req.params as { listingId: string }
    return app.missionNegotiationService.getDashboardByListing(req.userId, listingId)
  })

  app.get('/:missionId', async req => {
    const { missionId } = req.params as { missionId: string }
    return app.missionNegotiationService.getDashboard(req.userId, missionId)
  })

  app.post('/:missionId/suspend', async req => {
    const { missionId } = req.params as { missionId: string }
    const mission = await app.missionNegotiationService.suspend(req.userId, missionId)
    return { mission }
  })

  app.post('/:missionId/resume', async req => {
    const { missionId } = req.params as { missionId: string }
    const mission = await app.missionNegotiationService.resume(req.userId, missionId)
    return { mission }
  })

  app.post('/:missionId/stop', async req => {
    const { missionId } = req.params as { missionId: string }
    const mission = await app.missionNegotiationService.stop(req.userId, missionId)
    return { mission }
  })

  app.post('/:missionId/resolve-validation', async (req, reply) => {
    const body = resolveValidationBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const { missionId } = req.params as { missionId: string }
    const mission = await app.missionNegotiationService.resolveValidation(
      req.userId,
      missionId,
      body.data.action,
    )
    return { mission }
  })

  app.post('/:missionId/simulate', async (req, reply) => {
    if (!devActionsEnabled()) return reply.code(403).send({ error: 'DEV_ACTIONS_DISABLED' })

    const body = simulateBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const { missionId } = req.params as { missionId: string }
    const mission = await app.missionNegotiationService.simulateMessage(req.userId, missionId, body.data)
    return { mission }
  })
}

export default missionRoutes
