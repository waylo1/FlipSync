import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * Rate limiting /auth/* — 5 req/min/IP puis 429 { error: 'RATE_LIMITED' }.
 * Aucune DB requise : un body invalide est rejeté (400) AVANT tout accès Prisma,
 * mais compte dans la fenêtre du limiteur (hook onRequest).
 */
describe('Rate limit /auth — anti-abus', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    process.env.AUTH_RATE_LIMIT_MAX = '5' // valeur produit — d'autres suites la montent

    const { buildApp } = await import('./app')
    app = await buildApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('6e requête dans la minute → 429 RATE_LIMITED', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/magic-link',
        payload: { email: 'pas-un-email' },
      })
      expect(res.statusCode).toBe(400) // INVALID_BODY — mais la requête compte
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/auth/magic-link',
      payload: { email: 'pas-un-email' },
    })
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toEqual({ error: 'RATE_LIMITED' })
  })

  it('le compteur couvre tout le scope /auth : /auth/verify aussi bloqué', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify',
      payload: {},
    })
    expect(res.statusCode).toBe(429)
    expect(res.json()).toEqual({ error: 'RATE_LIMITED' })
  })

  it('le reste de l’API n’est pas limité : /health répond', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
  })
})
