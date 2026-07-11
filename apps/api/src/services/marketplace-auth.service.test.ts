import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Marketplace } from '@flipsync/marketplace'
import { MarketplaceAuthService } from './marketplace-auth.service'

/**
 * Unités MarketplaceAuthService — la SSOT credentials/états lit l'env
 * paresseusement : chaque test pose exactement l'env qu'il veut, tout est
 * restauré ensuite (les autres suites partagent process.env).
 */
const MANAGED_KEYS = [
  'VINTED_ACCESS_TOKEN',
  'VINTED_TOKEN_EXPIRES_AT',
  'LEBONCOIN_ACCESS_TOKEN',
  'LEBONCOIN_TOKEN_EXPIRES_AT',
  'MARKETPLACE_SELLER_ID',
  'MARKETPLACE_MOCK',
  'NODE_ENV',
] as const

describe('MarketplaceAuthService', () => {
  const saved = new Map<string, string | undefined>()
  let service: MarketplaceAuthService

  beforeEach(() => {
    for (const key of MANAGED_KEYS) {
      saved.set(key, process.env[key])
      delete process.env[key]
    }
    process.env.NODE_ENV = 'test'
    service = new MarketplaceAuthService()
  })

  afterEach(() => {
    for (const key of MANAGED_KEYS) {
      const value = saved.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('sans token → resolve MISSING, état DISCONNECTED', () => {
    expect(service.resolve('u1', Marketplace.VINTED)).toEqual({ ok: false, reason: 'MISSING' })
    expect(service.connection(Marketplace.VINTED)).toEqual({
      marketplace: 'VINTED',
      state: 'DISCONNECTED',
      mock: false,
      detail: null,
    })
  })

  it('token vide (comme livré par .env.example) → MISSING', () => {
    process.env.VINTED_ACCESS_TOKEN = ''
    expect(service.resolve('u1', Marketplace.VINTED)).toEqual({ ok: false, reason: 'MISSING' })
  })

  it('token présent → resolve ok (credentials + sellerId), état CONNECTED', () => {
    process.env.VINTED_ACCESS_TOKEN = 'tok-vinted'
    process.env.MARKETPLACE_SELLER_ID = 'seller-1'

    expect(service.resolve('u1', Marketplace.VINTED)).toEqual({
      ok: true,
      mock: false,
      credentials: { marketplace: Marketplace.VINTED, accessToken: 'tok-vinted', sellerId: 'seller-1' },
    })
    expect(service.connection(Marketplace.VINTED).state).toBe('CONNECTED')
  })

  it('plateformes indépendantes : Vinted connecté ne connecte pas Leboncoin', () => {
    process.env.VINTED_ACCESS_TOKEN = 'tok-vinted'
    const [vinted, leboncoin] = service.status()
    expect(vinted?.state).toBe('CONNECTED')
    expect(leboncoin?.state).toBe('DISCONNECTED')
  })

  it('expiration passée → resolve EXPIRED, état EXPIRED (token jamais envoyé)', () => {
    process.env.LEBONCOIN_ACCESS_TOKEN = 'tok-lbc'
    process.env.LEBONCOIN_TOKEN_EXPIRES_AT = '2020-01-01T00:00:00Z'

    expect(service.resolve('u1', Marketplace.LEBONCOIN)).toEqual({ ok: false, reason: 'EXPIRED' })
    expect(service.connection(Marketplace.LEBONCOIN).state).toBe('EXPIRED')
  })

  it('expiration future → CONNECTED', () => {
    process.env.LEBONCOIN_ACCESS_TOKEN = 'tok-lbc'
    process.env.LEBONCOIN_TOKEN_EXPIRES_AT = new Date(Date.now() + 60_000).toISOString()
    expect(service.resolve('u1', Marketplace.LEBONCOIN).ok).toBe(true)
    expect(service.connection(Marketplace.LEBONCOIN).state).toBe('CONNECTED')
  })

  it('expiration illisible → EXPIRED (fail-closed)', () => {
    process.env.VINTED_ACCESS_TOKEN = 'tok-vinted'
    process.env.VINTED_TOKEN_EXPIRES_AT = 'pas-une-date'
    expect(service.resolve('u1', Marketplace.VINTED)).toEqual({ ok: false, reason: 'EXPIRED' })
  })

  it('refus plateforme (HTTP 401/403) → AUTH_ERROR avec code, effacé au succès', () => {
    process.env.VINTED_ACCESS_TOKEN = 'tok-vinted'

    service.reportPublishOutcome(Marketplace.VINTED, { ok: false, code: 'VINTED_HTTP_401' })
    expect(service.connection(Marketplace.VINTED)).toMatchObject({
      state: 'AUTH_ERROR',
      detail: 'VINTED_HTTP_401',
    })

    service.reportPublishOutcome(Marketplace.VINTED, {
      ok: true,
      externalId: 'x1',
      url: 'https://vinted.fr/x1',
    })
    expect(service.connection(Marketplace.VINTED)).toMatchObject({ state: 'CONNECTED', detail: null })
  })

  it('échec non-auth (réseau, 5xx) → ne présume rien de l’auth', () => {
    process.env.LEBONCOIN_ACCESS_TOKEN = 'tok-lbc'
    service.reportPublishOutcome(Marketplace.LEBONCOIN, { ok: false, code: 'LBC_NETWORK_ERROR' })
    service.reportPublishOutcome(Marketplace.LEBONCOIN, { ok: false, code: 'LBC_HTTP_500' })
    expect(service.connection(Marketplace.LEBONCOIN).state).toBe('CONNECTED')
  })

  it('MARKETPLACE_MOCK=1 hors prod → CONNECTED mock, credentials simulés', () => {
    process.env.MARKETPLACE_MOCK = '1'

    expect(service.resolve('u1', Marketplace.VINTED)).toEqual({
      ok: true,
      mock: true,
      credentials: { marketplace: Marketplace.VINTED, accessToken: 'mock-access-token', sellerId: 'mock-seller' },
    })
    expect(service.connection(Marketplace.VINTED)).toEqual({
      marketplace: 'VINTED',
      state: 'CONNECTED',
      mock: true,
      detail: null,
    })
  })

  it('MARKETPLACE_MOCK ignoré en production (jamais de faux succès en prod)', () => {
    process.env.MARKETPLACE_MOCK = '1'
    process.env.NODE_ENV = 'production'
    expect(service.resolve('u1', Marketplace.VINTED)).toEqual({ ok: false, reason: 'MISSING' })
    expect(service.connection(Marketplace.VINTED).state).toBe('DISCONNECTED')
  })

  it('projection admin connectorState : MOCK / LIVE / MISSING / EXPIRED / AUTH_ERROR', () => {
    expect(service.connectorState(Marketplace.VINTED)).toBe('MISSING')

    process.env.VINTED_ACCESS_TOKEN = 'tok-vinted'
    expect(service.connectorState(Marketplace.VINTED)).toBe('LIVE')

    service.reportPublishOutcome(Marketplace.VINTED, { ok: false, code: 'VINTED_HTTP_403' })
    expect(service.connectorState(Marketplace.VINTED)).toBe('AUTH_ERROR')

    process.env.VINTED_TOKEN_EXPIRES_AT = '2020-01-01T00:00:00Z'
    expect(service.connectorState(Marketplace.VINTED)).toBe('EXPIRED')

    process.env.MARKETPLACE_MOCK = '1'
    expect(service.connectorState(Marketplace.VINTED)).toBe('MOCK')
  })
})
