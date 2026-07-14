import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { VisionService, type VisionBackend } from '@flipsync/ai'

/**
 * Test e2e du pipeline IA asynchrone (POST /ai/draft/start + GET /ai/draft/:jobId)
 * via fastify.inject + JWT réel. app.visionService est remplacé par un backend
 * factice (VisionBackend) — AUCUN appel réseau réel (ni Ollama, ni cloud) :
 * seule la frontière backend d'inférence est mockée, VisionService reste réel.
 */
const DB_URL = process.env.DATABASE_URL

const VALID_DRAFT = {
  titre: 'Veste cuir Schott',
  description: 'Très bon état, peu portée.',
  categorieId: 'vetements-homme-veste',
  etat: 'tres_bon',
  prixPlancher: 8000,
  prixHaut: 12000,
  marque: 'Schott',
  confidence: 0.9,
}

/** Backend factice : résout/rejette immédiatement, contrôlé par le test. */
function fakeBackend(behavior: 'resolve' | 'reject'): VisionBackend {
  return {
    generate: async () =>
      behavior === 'resolve'
        ? JSON.stringify(VALID_DRAFT)
        : Promise.reject(new Error('backend indisponible')),
  }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe.skipIf(!DB_URL)('Pipeline IA asynchrone — /ai/draft/start + /ai/draft/:jobId', () => {
  let app: FastifyInstance
  let token = ''
  let otherToken = ''

  const EMAIL = 'ai-draft-test@flipsync.fr'
  const OTHER_EMAIL = 'ai-draft-other@flipsync.fr'
  const authed = (t: string) => ({ authorization: `Bearer ${t}` })

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    process.env.AUTH_RATE_LIMIT_MAX = '1000'

    const { prisma } = await import('@flipsync/db')

    for (const email of [EMAIL, OTHER_EMAIL]) {
      const stale = await prisma.user.findUnique({ where: { email } })
      if (stale) {
        await prisma.draftJob.deleteMany({ where: { userId: stale.id } })
        await prisma.user.delete({ where: { id: stale.id } })
      }
    }

    const user = await prisma.user.create({ data: { email: EMAIL } })
    const other = await prisma.user.create({ data: { email: OTHER_EMAIL } })

    const { buildApp } = await import('./app')
    app = await buildApp()
    token = app.jwt.sign({ sub: user.id })
    otherToken = app.jwt.sign({ sub: other.id })
  })

  afterAll(async () => {
    await app.close()
  })

  it('POST /ai/draft/start → 202 + jobId', async () => {
    app.visionService = new VisionService(fakeBackend('resolve'))

    const res = await app.inject({
      method: 'POST',
      url: '/ai/draft/start',
      headers: authed(token),
      payload: { photos: ['ZmFrZS1pbWFnZQ=='] },
    })

    expect(res.statusCode).toBe(202)
    expect(res.json()).toMatchObject({ jobId: expect.any(String) })
  })

  it('job réussi → GET /ai/draft/:jobId retourne ready + le brouillon (persisté en base)', async () => {
    app.visionService = new VisionService(fakeBackend('resolve'))

    const start = await app.inject({
      method: 'POST',
      url: '/ai/draft/start',
      headers: authed(token),
      payload: { photos: ['ZmFrZS1pbWFnZQ=='] },
    })
    const { jobId } = start.json() as { jobId: string }

    await wait(50) // laisse le job détaché se résoudre

    const poll = await app.inject({ method: 'GET', url: `/ai/draft/${jobId}`, headers: authed(token) })
    expect(poll.statusCode).toBe(200)
    expect(poll.json()).toMatchObject({ status: 'ready', draft: { titre: VALID_DRAFT.titre }, error: null })
  })

  it('job échoué → GET /ai/draft/:jobId retourne failed + errorCode', async () => {
    app.visionService = new VisionService(fakeBackend('reject'))

    const start = await app.inject({
      method: 'POST',
      url: '/ai/draft/start',
      headers: authed(token),
      payload: { photos: ['ZmFrZS1pbWFnZQ=='] },
    })
    const { jobId } = start.json() as { jobId: string }

    await wait(50)

    const poll = await app.inject({ method: 'GET', url: `/ai/draft/${jobId}`, headers: authed(token) })
    expect(poll.statusCode).toBe(200)
    expect(poll.json()).toMatchObject({ status: 'failed', draft: null })
    expect((poll.json() as { error: string }).error).toBeTruthy()
  })

  it('un jobId appartenant à un autre userId → 404 JOB_NOT_FOUND', async () => {
    app.visionService = new VisionService(fakeBackend('resolve'))

    const start = await app.inject({
      method: 'POST',
      url: '/ai/draft/start',
      headers: authed(token),
      payload: { photos: ['ZmFrZS1pbWFnZQ=='] },
    })
    const { jobId } = start.json() as { jobId: string }

    const poll = await app.inject({ method: 'GET', url: `/ai/draft/${jobId}`, headers: authed(otherToken) })
    expect(poll.statusCode).toBe(404)
    expect(poll.json()).toEqual({ error: 'JOB_NOT_FOUND' })
  })

  it('jobId inconnu → 404 JOB_NOT_FOUND', async () => {
    const poll = await app.inject({
      method: 'GET',
      url: '/ai/draft/00000000-0000-0000-0000-000000000000',
      headers: authed(token),
    })
    expect(poll.statusCode).toBe(404)
    expect(poll.json()).toEqual({ error: 'JOB_NOT_FOUND' })
  })
})
