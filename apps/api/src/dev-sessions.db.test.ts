import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { DevSessionDetail, DevSessionSummary, StartDevSessionResult } from '@flipsync/core'

/**
 * Test e2e du Developer Control Center : ingestion (mobile, /dev-sessions/*,
 * JWT normal) + consultation (admin, /admin/dev-sessions/*) via fastify.inject.
 */
const DB_URL = process.env.DATABASE_URL

describe.skipIf(!DB_URL)('Developer Sessions', () => {
  let app: FastifyInstance
  let adminToken = ''
  let userToken = ''

  const ADMIN_EMAIL = 'admin-devsessions-test@flipsync.fr'
  const USER_EMAIL = 'user-devsessions-test@flipsync.fr'
  const authed = (t: string) => ({ authorization: `Bearer ${t}` })

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    process.env.AUTH_RATE_LIMIT_MAX = '1000'
    process.env.ADMIN_EMAILS = ADMIN_EMAIL
    process.env.NODE_ENV = 'development'

    const { prisma } = await import('@flipsync/db')
    for (const email of [ADMIN_EMAIL, USER_EMAIL]) {
      const stale = await prisma.user.findUnique({ where: { email } })
      if (stale) await prisma.user.delete({ where: { id: stale.id } })
    }
    const admin = await prisma.user.create({ data: { email: ADMIN_EMAIL } })
    const user = await prisma.user.create({ data: { email: USER_EMAIL } })

    const { buildApp } = await import('./app')
    app = await buildApp()
    adminToken = app.jwt.sign({ sub: admin.id })
    userToken = app.jwt.sign({ sub: user.id })
  })

  afterAll(async () => {
    await app.close()
  })

  it('cycle complet : start → events (connus + inconnu) → stop → consultation admin → export', async () => {
    const start = await app.inject({
      method: 'POST',
      url: '/dev-sessions/start',
      headers: authed(userToken),
      payload: { platform: 'android', appVersion: '1.2.3' },
    })
    expect(start.statusCode).toBe(200)
    const { id } = start.json() as StartDevSessionResult
    expect(id).toBeTruthy()

    const ingest = await app.inject({
      method: 'POST',
      url: `/dev-sessions/${id}/events`,
      headers: authed(userToken),
      payload: {
        events: [
          { type: 'navigation', ts: new Date().toISOString(), payload: { screen: 'Home' } },
          {
            type: 'action',
            ts: new Date().toISOString(),
            payload: { screen: 'Home', component: 'PublishButton', action: 'pressed' },
          },
          {
            type: 'api_call',
            ts: new Date().toISOString(),
            payload: { method: 'POST', url: '/listing/x/publish', durationMs: 42, statusCode: 500 },
          },
          {
            type: 'error',
            ts: new Date().toISOString(),
            payload: { message: 'boom', kind: 'js' },
          },
          // Type inconnu (extension future) : accepté avec payload libre.
          { type: 'performance', ts: new Date().toISOString(), payload: { fps: 58 } },
          // Événement invalide (payload manquant) : rejeté sans faire échouer le batch.
          { type: 'action', ts: new Date().toISOString() },
        ],
      },
    })
    expect(ingest.statusCode).toBe(200)
    expect(ingest.json()).toEqual({ ok: true, accepted: 5, rejected: 1 })

    const stop = await app.inject({ method: 'POST', url: `/dev-sessions/${id}/stop`, headers: authed(userToken) })
    expect(stop.statusCode).toBe(200)
    expect(stop.json()).toEqual({ ok: true })

    const list = await app.inject({ method: 'GET', url: '/admin/dev-sessions', headers: authed(adminToken) })
    expect(list.statusCode).toBe(200)
    const summaries = list.json() as DevSessionSummary[]
    const summary = summaries.find(s => s.id === id)
    expect(summary).toBeTruthy()
    expect(summary?.eventCount).toBe(5)
    expect(summary?.errorCount).toBe(1)
    expect(summary?.apiCallCount).toBe(1)
    expect(summary?.endedAt).toBeTruthy()

    const detail = await app.inject({ method: 'GET', url: `/admin/dev-sessions/${id}`, headers: authed(adminToken) })
    expect(detail.statusCode).toBe(200)
    const body = detail.json() as DevSessionDetail
    expect(body.events).toHaveLength(5)
    expect(body.events.map(e => e.type).sort()).toEqual(
      ['action', 'api_call', 'error', 'navigation', 'performance'].sort(),
    )

    const events = await app.inject({
      method: 'GET',
      url: `/admin/dev-sessions/${id}/export/events`,
      headers: authed(adminToken),
    })
    expect(events.statusCode).toBe(200)
    expect(events.headers['content-type']).toContain('application/json')
    expect(events.headers['content-disposition']).toContain('events.json')
    expect(JSON.parse(events.body).id).toBe(id)

    const report = await app.inject({
      method: 'GET',
      url: `/admin/dev-sessions/${id}/export/report`,
      headers: authed(adminToken),
    })
    expect(report.statusCode).toBe(200)
    expect(report.headers['content-type']).toContain('text/markdown')
    expect(report.headers['content-disposition']).toContain('report.md')
    expect(report.body).toContain(`# Session ${id}`)
    expect(report.body).toContain('## Timeline')
    expect(report.body).toContain('## Erreurs')

    const llmContext = await app.inject({
      method: 'GET',
      url: `/admin/dev-sessions/${id}/export/llm-context`,
      headers: authed(adminToken),
    })
    expect(llmContext.statusCode).toBe(200)
    expect(llmContext.headers['content-disposition']).toContain('llm-context.json')
    const contextBody = JSON.parse(llmContext.body) as { session: { id: string }; errors: unknown[] }
    expect(contextBody.session.id).toBe(id)
    expect(contextBody.errors).toHaveLength(1)

    const llmPrompt = await app.inject({
      method: 'GET',
      url: `/admin/dev-sessions/${id}/export/llm-prompt`,
      headers: authed(adminToken),
    })
    expect(llmPrompt.statusCode).toBe(200)
    expect(llmPrompt.headers['content-disposition']).toContain('llm-prompt.md')
    expect(llmPrompt.body).toContain('Aucune hypothèse')
    expect(llmPrompt.body).toContain('```json')

    const badFormat = await app.inject({
      method: 'GET',
      url: `/admin/dev-sessions/${id}/export/does-not-exist`,
      headers: authed(adminToken),
    })
    expect(badFormat.statusCode).toBe(400)
    expect(badFormat.json()).toEqual({ error: 'INVALID_EXPORT_FORMAT' })
  })

  it('événements vers une session inconnue → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/dev-sessions/does-not-exist/events',
      headers: authed(userToken),
      payload: { events: [] },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'DEV_SESSION_NOT_FOUND' })
  })

  it('production → ingestion et consultation désactivées (403)', async () => {
    process.env.NODE_ENV = 'production'
    try {
      const start = await app.inject({ method: 'POST', url: '/dev-sessions/start', headers: authed(userToken) })
      expect(start.statusCode).toBe(403)

      const list = await app.inject({ method: 'GET', url: '/admin/dev-sessions', headers: authed(adminToken) })
      expect(list.statusCode).toBe(403)
    } finally {
      process.env.NODE_ENV = 'development'
    }
  })

  it('consultation admin refusée pour un non-admin → 403 NOT_ADMIN', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/dev-sessions', headers: authed(userToken) })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'NOT_ADMIN' })
  })

  it('sans token → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/dev-sessions/start' })
    expect(res.statusCode).toBe(401)
  })
})
