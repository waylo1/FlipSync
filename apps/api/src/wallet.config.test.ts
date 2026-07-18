import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * GET /wallet/recharge/config — la clé publiable servie au mobile (jamais
 * inlinée au build). Contrat : JWT requis, 503 explicite tant que la clé
 * n'est pas configurée, jamais de fuite de la clé SECRÈTE.
 */
describe('GET /wallet/recharge/config', () => {
  let app: FastifyInstance
  let token = ''

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    const { buildApp } = await import('./app')
    app = await buildApp()
    token = app.jwt.sign({ sub: 'user-config-test' })
  })

  afterAll(async () => {
    await app.close()
  })

  it('sans JWT → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/wallet/recharge/config' })
    expect(res.statusCode).toBe(401)
  })

  it('clé publiable absente → 503 STRIPE_NOT_CONFIGURED', async () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY
    const res = await app.inject({
      method: 'GET',
      url: '/wallet/recharge/config',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ error: 'STRIPE_NOT_CONFIGURED' })
  })

  it('clé posée → 200 { publishableKey }, sans la clé secrète', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_fake_for_contract'
    const res = await app.inject({
      method: 'GET',
      url: '/wallet/recharge/config',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ publishableKey: 'pk_test_fake_for_contract' })
    expect(res.body).not.toContain('sk_test')
    delete process.env.STRIPE_PUBLISHABLE_KEY
  })
})
