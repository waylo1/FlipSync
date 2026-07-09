import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { StartDevSessionResult } from '@flipsync/core'
import { devSessionsEnabled, ingestEvents, startSession, stopSession } from '../services/dev-sessions.service'

const startBodySchema = z.object({
  platform: z.string().optional(),
  appVersion: z.string().optional(),
})

const eventsBodySchema = z.object({
  events: z.array(z.unknown()).max(500),
})

/**
 * Routes d'ingestion Developer Sessions — appelées par le mobile (JWT normal,
 * pas de garde admin ici : c'est le téléphone qui pousse ses propres événements).
 * Désactivées en production, comme le reste du Developer Control Center.
 */
const devSessionsRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', app.authenticate)

  app.post('/start', async (req, reply): Promise<StartDevSessionResult | { error: string }> => {
    if (!devSessionsEnabled()) return reply.code(403).send({ error: 'DEV_SESSIONS_DISABLED' })
    const body = startBodySchema.parse(req.body ?? {})
    return startSession(body.platform, body.appVersion)
  })

  app.post<{ Params: { id: string } }>('/:id/stop', async (req, reply) => {
    if (!devSessionsEnabled()) return reply.code(403).send({ error: 'DEV_SESSIONS_DISABLED' })
    const result = await stopSession(req.params.id)
    if (!result.ok) return reply.code(404).send({ error: 'DEV_SESSION_NOT_FOUND' })
    return result
  })

  app.post<{ Params: { id: string } }>('/:id/events', async (req, reply) => {
    if (!devSessionsEnabled()) return reply.code(403).send({ error: 'DEV_SESSIONS_DISABLED' })
    const body = eventsBodySchema.parse(req.body)
    const result = await ingestEvents(req.params.id, body.events)
    if (!result.ok) return reply.code(404).send({ error: 'DEV_SESSION_NOT_FOUND' })
    return result
  })
}

export default devSessionsRoutes
