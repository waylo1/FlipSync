import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma } from '@flipsync/db'

const registerBody = z.object({ token: z.string().min(1) })
const unregisterBody = z.object({ token: z.string().min(1) })

/**
 * Routes /notifications — enregistrement des device tokens Expo Push (§7,
 * Lot 9). Un token appartient à un seul user à la fois : ré-enregistrer un
 * token déjà connu (ex. reconnexion sous un autre compte sur le même
 * appareil) le réaffecte plutôt que d'échouer sur la contrainte unique.
 */
const notificationRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', app.authenticate)

  app.post('/device-token', async (req, reply) => {
    const body = registerBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    await prisma.deviceToken.upsert({
      where: { token: body.data.token },
      create: { userId: req.userId, token: body.data.token },
      update: { userId: req.userId },
    })
    return {}
  })

  app.post('/device-token/unregister', async (req, reply) => {
    const body = unregisterBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    await prisma.deviceToken.deleteMany({ where: { token: body.data.token, userId: req.userId } })
    return {}
  })
}

export default notificationRoutes
