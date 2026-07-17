import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * /legal/* — pages exigées par Google Play. Contrat : publiques (AUCUN JWT),
 * HTML lisible, et les mentions clés du modèle réel (0,99 €, remboursement
 * automatique) présentes — si la copie légale dérive du code, ce test casse.
 */
describe('GET /legal/*', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    // buildApp exige les env Stripe (fail fast à l'enregistrement du plugin).
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    const { buildApp } = await import('./app')
    app = await buildApp()
  })

  afterAll(async () => {
    await app.close()
  })

  it('privacy : 200 public, HTML, sous-traitants réels cités', async () => {
    const res = await app.inject({ method: 'GET', url: '/legal/privacy' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    for (const mention of ['Anthropic', 'Stripe', 'Supabase', 'RGPD']) {
      expect(res.body).toContain(mention)
    }
  })

  it('cgv : 200 public, prix et remboursement alignés sur le code', async () => {
    const res = await app.inject({ method: 'GET', url: '/legal/cgv' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('0,99')
    expect(res.body).toContain('3 annonces gratuites')
    expect(res.body).toContain('automatiquement recrédité')
  })
})
