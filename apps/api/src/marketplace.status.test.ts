import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { MarketplaceStatusResponse } from '@flipsync/core'

/**
 * GET /marketplace/status via fastify.inject — pas de suite DB : la route ne
 * touche pas Prisma (états dérivés de l'env + mémoire), seule la garde JWT
 * s'applique. L'env marketplace est vidé au départ puis posé par cas.
 */
const MANAGED_KEYS = [
  'VINTED_ACCESS_TOKEN',
  'VINTED_TOKEN_EXPIRES_AT',
  'LEBONCOIN_ACCESS_TOKEN',
  'LEBONCOIN_TOKEN_EXPIRES_AT',
  'MARKETPLACE_MOCK',
] as const

describe('GET /marketplace/status', () => {
  let app: FastifyInstance
  let token = ''
  const saved = new Map<string, string | undefined>()

  const getStatus = async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/marketplace/status',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    return res.json() as MarketplaceStatusResponse
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    for (const key of MANAGED_KEYS) {
      saved.set(key, process.env[key])
      delete process.env[key]
    }

    const { buildApp } = await import('./app')
    app = await buildApp()
    token = app.jwt.sign({ sub: 'user-marketplace-status' })
  })

  afterAll(async () => {
    for (const key of MANAGED_KEYS) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await app.close()
  })

  it('401 sans JWT', async () => {
    const res = await app.inject({ method: 'GET', url: '/marketplace/status' })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'UNAUTHORIZED' })
  })

  it('200 — quatre plateformes DISCONNECTED sans credentials (forme du contrat)', async () => {
    const body = await getStatus()
    expect(body.connections).toEqual([
      { marketplace: 'VINTED', state: 'DISCONNECTED', mock: false, detail: null },
      { marketplace: 'LEBONCOIN', state: 'DISCONNECTED', mock: false, detail: null },
      { marketplace: 'EBAY', state: 'DISCONNECTED', mock: false, detail: null },
      { marketplace: 'SHOPIFY', state: 'DISCONNECTED', mock: false, detail: null },
    ])
  })

  it('reflète l’env sans redémarrage : token → CONNECTED, expiration passée → EXPIRED', async () => {
    process.env.VINTED_ACCESS_TOKEN = 'tok-vinted'
    process.env.LEBONCOIN_ACCESS_TOKEN = 'tok-lbc'
    process.env.LEBONCOIN_TOKEN_EXPIRES_AT = '2020-01-01T00:00:00Z'

    const body = await getStatus()
    expect(body.connections).toEqual([
      { marketplace: 'VINTED', state: 'CONNECTED', mock: false, detail: null },
      { marketplace: 'LEBONCOIN', state: 'EXPIRED', mock: false, detail: null },
      { marketplace: 'EBAY', state: 'DISCONNECTED', mock: false, detail: null },
      { marketplace: 'SHOPIFY', state: 'DISCONNECTED', mock: false, detail: null },
    ])
  })
})
