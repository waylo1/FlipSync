import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'

/**
 * Nombre de photos aligné sur l'écran de capture mobile (MIN 3 / MAX 8) —
 * on tolère 1 minimum côté API : le brouillon reste possible avec moins.
 */
const draftBody = z.object({
  photos: z.array(z.string().min(1)).min(1).max(8),
})

/**
 * Routes /ai — rédaction du brouillon d'annonce CÔTÉ SERVEUR (pivot).
 *
 * POST /ai/draft : photos (base64) → ListingDraft validé (Zod, centimes Int).
 * Aucun listing ni débit ici : c'est de la pure génération de texte, le cycle
 * wallet/machine à états reste intégralement porté par /listing/*.
 * Les erreurs vision (AI_TIMEOUT, AI_INVALID_OUTPUT, AI_BACKEND_ERROR) sortent
 * via l'error handler global en { error: code }.
 */
const aiRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', app.authenticate)

  // Même plafond que l'upload photos : 8 × ~1 Mo base64 + marge.
  app.post('/draft', { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const body = draftBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const started = Date.now()
    const draft = await app.visionService.analyze(body.data.photos)
    req.log.info({ ms: Date.now() - started, titre: draft.titre }, 'brouillon IA généré')
    return { draft }
  })
}

export default aiRoutes
