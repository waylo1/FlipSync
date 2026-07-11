import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { ComplexCasePolicy, DeliveryPreference, SellObjective, SellPosture } from '@flipsync/core'

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

/**
 * Mission — Commissaire-Priseur IA (COMMISSAIRE_PRISEUR_PLAN.md §10 Lot 3).
 * Une seule route pour l'instant : la confirmation du mandat (S3 « Confirmer
 * le mandat ») crée la Mission et la fait passer BROUILLON_MANDAT → EN_VENTE
 * via un service stub (pas encore de négociation, cf. Lot 4).
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
}

export default missionRoutes
