import { describe, expect, it } from 'vitest'
import { ItemCondition } from '@flipsync/core'
import { MarketplaceClient } from './client'
import { formatPrice, priceToDecimal } from './format'
import { Marketplace, ListingPayload, MarketplaceConnector, PublishResult } from './types'

describe('formatPrice / priceToDecimal — centimes Int', () => {
  it('formate les centimes en chaîne FR', () => {
    expect(formatPrice(2350)).toBe('23,50')
    expect(formatPrice(80)).toBe('0,80')
    expect(formatPrice(100000)).toBe('1000,00')
  })

  it('dérive un décimal exact', () => {
    expect(priceToDecimal(2350)).toBe(23.5)
    expect(priceToDecimal(999)).toBe(9.99)
  })

  it('rejette tout prix non entier ou <= 0', () => {
    expect(() => formatPrice(80.5)).toThrow('INVALID_PRICE_CENTS')
    expect(() => formatPrice(0)).toThrow('INVALID_PRICE_CENTS')
    expect(() => priceToDecimal(-100)).toThrow('INVALID_PRICE_CENTS')
  })
})

describe('MarketplaceClient — routage', () => {
  const payload: ListingPayload = {
    titre: 'Veste cuir',
    description: 'Très bon état',
    categorie: 'Vêtements',
    etat: ItemCondition.tres_bon,
    marque: 'Schott',
    prixCents: 12000,
    photoUrls: ['/uploads/x.jpg'],
  }

  /** Connecteur factice : capture l'appel sans réseau. */
  class FakeConnector implements MarketplaceConnector {
    constructor(readonly marketplace: Marketplace) {}
    async publish(): Promise<PublishResult> {
      return { ok: true, externalId: 'ext_1', url: 'https://example.com/ext_1' }
    }
  }

  it('route vers le connecteur de la plateforme', async () => {
    const client = new MarketplaceClient([new FakeConnector(Marketplace.VINTED)])
    const res = await client.publish(Marketplace.VINTED, payload, {
      marketplace: Marketplace.VINTED,
      accessToken: 'tok',
    })
    expect(res).toEqual({ ok: true, externalId: 'ext_1', url: 'https://example.com/ext_1' })
  })

  it('plateforme sans connecteur → MARKETPLACE_NOT_SUPPORTED', async () => {
    const client = new MarketplaceClient([new FakeConnector(Marketplace.VINTED)])
    const res = await client.publish(Marketplace.LEBONCOIN, payload, {
      marketplace: Marketplace.LEBONCOIN,
      accessToken: 'tok',
    })
    expect(res).toEqual({ ok: false, code: 'MARKETPLACE_NOT_SUPPORTED' })
  })

  it('credentials d’une autre plateforme → CREDENTIALS_MARKETPLACE_MISMATCH', async () => {
    const client = new MarketplaceClient([new FakeConnector(Marketplace.VINTED)])
    const res = await client.publish(Marketplace.VINTED, payload, {
      marketplace: Marketplace.LEBONCOIN,
      accessToken: 'tok',
    })
    expect(res).toEqual({ ok: false, code: 'CREDENTIALS_MARKETPLACE_MISMATCH' })
  })
})
