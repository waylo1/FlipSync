import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { DevActionsState, RestartOllamaResult, TunnelActionResult } from '@flipsync/core'

/**
 * Test e2e des routes /admin/actions/* (Developer Actions) via fastify.inject + JWT réel.
 * `start-tunnel` ouvre une vraie connexion réseau (localtunnel.me) — le test tolère un
 * échec réseau (offline/CI sans accès sortant) : seule la FORME de la réponse est garantie,
 * pas le succès de l'ouverture du tunnel.
 */
const DB_URL = process.env.DATABASE_URL

describe.skipIf(!DB_URL)('POST /admin/actions/*', () => {
  let app: FastifyInstance
  let adminToken = ''
  let userToken = ''

  const ADMIN_EMAIL = 'admin-actions-test@flipsync.fr'
  const USER_EMAIL = 'user-actions-test@flipsync.fr'
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

  it('GET /actions/status → 200, enabled=true hors production, forme correcte', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/actions/status', headers: authed(adminToken) })
    expect(res.statusCode).toBe(200)

    const body = res.json() as DevActionsState
    expect(body.enabled).toBe(true)
    expect(typeof body.ollama.running).toBe('boolean')
    expect(body.ollama.model).toBeTruthy()
    expect(typeof body.tunnel.active).toBe('boolean')
  })

  it('POST /actions/restart-ollama → 200 ou 502 selon disponibilité du binaire', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/actions/restart-ollama',
      headers: authed(adminToken),
    })
    expect([200, 502]).toContain(res.statusCode)

    const body = res.json() as RestartOllamaResult
    expect(typeof body.ok).toBe('boolean')
    expect(typeof body.detail).toBe('string')
  })

  it('POST /actions/start-tunnel puis /actions/stop-tunnel → forme correcte (tolère échec réseau)', async () => {
    const start = await app.inject({
      method: 'POST',
      url: '/admin/actions/start-tunnel',
      headers: authed(adminToken),
    })
    expect([200, 502]).toContain(start.statusCode)
    const startBody = start.json() as TunnelActionResult
    expect(typeof startBody.ok).toBe('boolean')
    expect(typeof startBody.tunnel.active).toBe('boolean')

    const stop = await app.inject({
      method: 'POST',
      url: '/admin/actions/stop-tunnel',
      headers: authed(adminToken),
    })
    expect(stop.statusCode).toBe(200)
    const stopBody = stop.json() as TunnelActionResult
    expect(stopBody.tunnel.active).toBe(false)
  }, 15_000)

  it('production → routes d\'action désactivées (403 DEV_ACTIONS_DISABLED)', async () => {
    process.env.NODE_ENV = 'production'
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/admin/actions/restart-ollama',
        headers: authed(adminToken),
      })
      expect(res.statusCode).toBe(403)
      expect(res.json()).toEqual({ ok: false, detail: 'DEV_ACTIONS_DISABLED' })
    } finally {
      process.env.NODE_ENV = 'development'
    }
  })

  it('utilisateur non-admin → 403 NOT_ADMIN', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin/actions/status',
      headers: authed(userToken),
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'NOT_ADMIN' })
  })

  it('sans token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/actions/status' })
    expect(res.statusCode).toBe(401)
  })
})
