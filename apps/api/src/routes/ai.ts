import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { EngineError } from '@flipsync/ai'
import { prisma, DraftJobStatus, Prisma } from '@flipsync/db'
import type { ListingDraft } from '@flipsync/core'

/**
 * Nombre de photos aligné sur l'écran de capture mobile (MIN 1 / MAX 6) —
 * on tolère 1 minimum côté API : le brouillon reste possible avec moins.
 */
const draftBody = z.object({
  photos: z.array(z.string().min(1)).min(1).max(6),
})

const jobParams = z.object({
  jobId: z.string().min(1),
})

/**
 * Routes /ai — rédaction du brouillon d'annonce CÔTÉ SERVEUR (pivot), en job
 * asynchrone détaché de la requête mobile.
 *
 * POURQUOI asynchrone : l'inférence CPU dev prend 70-90 s. Un appareil qui tue
 * l'app en arrière-plan pendant ce délai (OEM agressifs type MIUI/Xiaomi) coupe
 * une requête HTTP synchrone AVANT la réponse — le brouillon est perdu. En job
 * détaché, le serveur continue de travailler indépendamment du mobile ; celui-ci
 * peut interroger le statut à tout moment, y compris après avoir été relancé.
 *
 * POST /ai/draft/start : photos (base64) → { jobId } immédiat (202).
 * GET  /ai/draft/:jobId : { status, draft? , error? } — poll côté mobile.
 *
 * Persistance : table DraftJob (Prisma) — un redémarrage serveur ne perd plus
 * les jobs en cours. Cycle de vie DÉCOUPLÉ du modèle Listing (cf. CLAUDE.md
 * Sprint 4) : pure génération de texte, aucun débit wallet, aucune transition
 * ListingStatus ici — le cycle wallet/machine à états reste intégralement
 * porté par /listing/*.
 */
const aiRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', app.authenticate)

  // Même plafond que l'upload photos : 6 × ~1 Mo base64 + marge.
  app.post('/draft/start', { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const body = draftBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const job = await prisma.draftJob.create({
      data: { userId: req.userId, status: DraftJobStatus.RUNNING },
      select: { id: true },
    })

    // DÉTACHÉ : ne pas attendre ici — la requête mobile répond tout de suite,
    // l'inférence continue même si le mobile se déconnecte ou est tué par l'OS.
    const started = Date.now()
    void app.visionService
      .analyze(body.data.photos)
      .then(async draft => {
        req.log.info({ ms: Date.now() - started, titre: draft.titre }, 'brouillon IA généré (job)')
        await prisma.draftJob.update({
          where: { id: job.id },
          data: { status: DraftJobStatus.READY, draft: draft as unknown as Prisma.InputJsonValue },
        })
      })
      .catch(async (err: unknown) => {
        const code = err instanceof EngineError ? err.code : 'AI_BACKEND_ERROR'
        req.log.warn({ err, jobId: job.id }, 'brouillon IA échoué (job)')
        await prisma.draftJob.update({
          where: { id: job.id },
          data: { status: DraftJobStatus.FAILED, errorCode: code },
        })
      })

    return reply.code(202).send({ jobId: job.id })
  })

  /** Statut d'un job — appartenance vérifiée (pas de fuite entre utilisateurs). */
  app.get('/draft/:jobId', async (req, reply) => {
    const params = jobParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const job = await prisma.draftJob.findUnique({ where: { id: params.data.jobId } })
    if (!job || job.userId !== req.userId) return reply.code(404).send({ error: 'JOB_NOT_FOUND' })

    return {
      status: job.status.toLowerCase() as 'running' | 'ready' | 'failed',
      draft: job.draft as unknown as ListingDraft | null,
      error: job.errorCode,
    }
  })
}

export default aiRoutes
