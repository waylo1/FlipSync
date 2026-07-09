import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { SystemMetrics } from '@flipsync/core'

/**
 * Test e2e GET /admin/metrics — vérifie que les compteurs de trafic reflètent
 * de VRAIES requêtes envoyées via app.inject (pas de valeurs simulées).
 */
const DB_URL = process.env.DATABASE_URL

describe.skipIf(!DB_URL)('GET /admin/metrics', () => {
  let app: FastifyInstance
  let adminToken = ''
  let userToken = ''

  const ADMIN_EMAIL = 'admin-metrics-test@flipsync.fr'
  const USER_EMAIL = 'user-metrics-test@flipsync.fr'
  const authed = (t: string) => ({ authorization: `Bearer ${t}` })

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    process.env.AUTH_RATE_LIMIT_MAX = '1000'
    process.env.ADMIN_EMAILS = ADMIN_EMAIL

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

  it('admin → 200, trafic reflète les requêtes réelles envoyées', async () => {
    // Génère du trafic réel mesurable avant de lire les métriques.
    await app.inject({ method: 'GET', url: '/health' })
    await app.inject({ method: 'GET', url: '/health' })
    await app.inject({ method: 'GET', url: '/health' })

    const res = await app.inject({ method: 'GET', url: '/admin/metrics', headers: authed(adminToken) })
    expect(res.statusCode).toBe(200)

    const body = res.json() as SystemMetrics
    expect(typeof body.uptimeSec).toBe('number')
    expect(body.uptimeSec).toBeGreaterThanOrEqual(0)
    expect(typeof body.version).toBe('string')
    expect(body.process.memoryUsedMb).toBeGreaterThan(0)
    // Au moins les 3 pings /health + les requêtes /admin/* déjà émises par ce test.
    expect(body.traffic.requestCount).toBeGreaterThanOrEqual(3)
    expect(body.traffic.p50LatencyMs).toBeGreaterThanOrEqual(0)
    expect(body.traffic.p95LatencyMs).toBeGreaterThanOrEqual(body.traffic.p50LatencyMs)
  })

  it('utilisateur non-admin → 403 NOT_ADMIN', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/metrics', headers: authed(userToken) })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'NOT_ADMIN' })
  })

  it('sans token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/metrics' })
    expect(res.statusCode).toBe(401)
  })
})
