import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { SystemHealth } from '@flipsync/core'

/**
 * Test e2e GET /admin/health via fastify.inject + JWT réel.
 * La base est réellement pingée (Postgres du CI/local → healthy) ; Ollama n'est pas
 * lancé en test → inference `down` (état RÉEL, déterministe). Vérifie aussi la garde
 * admin (403 hors liste, 401 sans token).
 */
const DB_URL = process.env.DATABASE_URL

describe.skipIf(!DB_URL)('GET /admin/health', () => {
  let app: FastifyInstance
  let adminToken = ''
  let userToken = ''

  const ADMIN_EMAIL = 'admin-health-test@flipsync.fr'
  const USER_EMAIL = 'user-health-test@flipsync.fr'
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

  it('admin → 200 avec services réels, overall et score bornés', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/health', headers: authed(adminToken) })
    expect(res.statusCode).toBe(200)

    const body = res.json() as SystemHealth
    expect(['healthy', 'warning', 'down']).toContain(body.overall)
    expect(typeof body.score).toBe('number')
    expect(body.score).toBeGreaterThanOrEqual(0)
    expect(body.score).toBeLessThanOrEqual(100)

    const ids = body.services.map(s => s.id)
    expect(ids).toContain('api')
    expect(ids).toContain('database')
    expect(ids).toContain('inference')

    // La base est réellement pingée et disponible en test → healthy.
    expect(body.services.find(s => s.id === 'database')?.status).toBe('healthy')
  })

  it('utilisateur non-admin → 403 NOT_ADMIN', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/health', headers: authed(userToken) })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'NOT_ADMIN' })
  })

  it('sans token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/health' })
    expect(res.statusCode).toBe(401)
  })
})
