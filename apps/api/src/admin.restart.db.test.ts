import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { ServiceRestartResult } from '@flipsync/core'

/**
 * Test e2e POST /admin/services/ollama/restart via fastify.inject + JWT réel.
 * Ne présuppose pas qu'Ollama est installé sur la machine de test : accepte
 * started=true (commande envoyée) OU started=false (binaire introuvable, 502) —
 * seul le contrat de réponse est vérifié, pas l'état réel du binaire.
 */
const DB_URL = process.env.DATABASE_URL

describe.skipIf(!DB_URL)('POST /admin/services/ollama/restart', () => {
  let app: FastifyInstance
  let adminToken = ''
  let userToken = ''

  const ADMIN_EMAIL = 'admin-restart-test@flipsync.fr'
  const USER_EMAIL = 'user-restart-test@flipsync.fr'
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

  it('admin → 200 ou 502 selon disponibilité du binaire, forme du payload correcte', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/services/ollama/restart',
      headers: authed(adminToken),
    })
    expect([200, 502]).toContain(res.statusCode)

    const body = res.json() as ServiceRestartResult
    expect(typeof body.started).toBe('boolean')
    expect(typeof body.detail).toBe('string')
  })

  it('utilisateur non-admin → 403 NOT_ADMIN', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/admin/services/ollama/restart',
      headers: authed(userToken),
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'NOT_ADMIN' })
  })

  it('sans token → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/services/ollama/restart' })
    expect(res.statusCode).toBe(401)
  })
})
