import { describe, expect, it } from 'vitest'
import { ItemCondition, SyncErrorCode, type FixedPriceListing } from '@flipsync/core'
import { EbayConnector } from './ebay'
import type { FetchLike, HttpInit } from './http'

// ─── Fetch injecté : file de réponses + journal des appels, zéro réseau ───────

interface Call {
  url: string
  init: HttpInit
}

const fetchQueue = (responses: Array<{ status: number; body: unknown }>) => {
  const calls: Call[] = []
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init })
    const next = responses.shift() ?? { status: 500, body: {} }
    return { status: next.status, text: async () => JSON.stringify(next.body) }
  }
  return { fn, calls }
}

const throwingFetch: FetchLike = async () => {
  throw new Error('ECONNRESET')
}

const ENV = {
  EBAY_ACCESS_TOKEN: 'tok-ebay',
  EBAY_MERCHANT_LOCATION_KEY: 'loc-1',
  EBAY_FULFILLMENT_POLICY_ID: 'ful-1',
  EBAY_PAYMENT_POLICY_ID: 'pay-1',
  EBAY_RETURN_POLICY_ID: 'ret-1',
  EBAY_CATEGORY_ID: '12345',
}

const LISTING: FixedPriceListing = {
  mode: 'fixed',
  listingId: 'lst_1',
  titre: 'Lampe opaline vintage',
  description: 'Verre opalin, années 70, très bon état.',
  etat: ItemCondition.tres_bon,
  devise: 'EUR',
  marque: 'Luxo',
  categorie: 'Décoration',
  prix: 3000,
  photos: [{ url: 'https://api.flipsync.fr/uploads/a.jpg', order: 0 }],
}

const REF = (externalId: string) => ({ externalId })

describe('EbayConnector — port ChannelConnector (C3.4, natif)', () => {
  it('capacités déclarées — MP direct, pas de négociation, sync, prix fixe uniquement', () => {
    const connector = new EbayConnector({ env: {} })
    expect(connector.capabilities).toMatchObject({
      kind: 'MP',
      transport: 'direct',
      negotiation: 'NONE',
      publishMode: 'SYNC',
    })
  })

  it('precheck : mode auction → inéligible sans appel réseau', () => {
    const connector = new EbayConnector({ env: ENV })
    const auction = { ...LISTING, mode: 'auction' as const, prixDepart: 1000, prixReserve: null, dureeJours: 7 }
    const eligibility = connector.precheck(auction, undefined)
    expect(eligibility.eligible).toBe(false)
  })

  it('precheck : mode fixed → éligible même sans credentials (credentials = échec publish(), pas précheck)', () => {
    const connector = new EbayConnector({ env: {} })
    expect(connector.precheck(LISTING, undefined)).toEqual({ eligible: true })
  })

  it('sans configuration → CREDENTIALS_MISSING, zéro appel réseau', async () => {
    const { fn, calls } = fetchQueue([])
    const connector = new EbayConnector({ fetchFn: fn, env: {} })

    const outcome = await connector.publish(LISTING, undefined)
    expect(outcome).toMatchObject({ status: 'FAILED', code: SyncErrorCode.CREDENTIALS_MISSING })
    expect(calls).toHaveLength(0)
  })

  it('publish → inventory item + offer + publish, externalId = offerId, url ebay.fr', async () => {
    const { fn, calls } = fetchQueue([
      { status: 204, body: {} },
      { status: 201, body: { offerId: 'OF-1' } },
      { status: 200, body: { listingId: '110123456' } },
    ])
    const connector = new EbayConnector({ fetchFn: fn, env: ENV })

    const outcome = await connector.publish(LISTING, undefined)
    expect(outcome).toEqual({
      status: 'PUBLISHED',
      externalId: 'OF-1',
      url: 'https://www.ebay.fr/itm/110123456',
    })

    expect(calls.map(c => `${c.init.method} ${new URL(c.url).pathname}`)).toEqual([
      'PUT /sell/inventory/v1/inventory_item/lst_1',
      'POST /sell/inventory/v1/offer',
      'POST /sell/inventory/v1/offer/OF-1/publish',
    ])
    // Auth systématique + payloads conformes au gate Zod.
    for (const call of calls) expect(call.init.headers.Authorization).toBe('Bearer tok-ebay')
    const offer = JSON.parse(calls[1]?.init.body ?? '{}') as Record<string, unknown>
    expect(offer).toMatchObject({
      sku: 'lst_1',
      marketplaceId: 'EBAY_FR',
      format: 'FIXED_PRICE',
      categoryId: '12345',
      pricingSummary: { price: { value: '30.00', currency: 'EUR' } },
      merchantLocationKey: 'loc-1',
    })
  })

  it('pivot sans photo (gate Zod imageUrls) → INVALID_PAYLOAD, zéro appel réseau', async () => {
    const { fn, calls } = fetchQueue([])
    const connector = new EbayConnector({ fetchFn: fn, env: ENV })

    const outcome = await connector.publish({ ...LISTING, photos: [] }, undefined)
    expect(outcome).toMatchObject({ status: 'FAILED', code: SyncErrorCode.INVALID_PAYLOAD })
    expect(calls).toHaveLength(0)
  })

  it('mode auction → UNSUPPORTED_MODE (défense en profondeur, Inventory API = prix fixe seul)', async () => {
    const { fn, calls } = fetchQueue([])
    const connector = new EbayConnector({ fetchFn: fn, env: ENV })

    const outcome = await connector.publish(
      { ...LISTING, mode: 'auction', prixDepart: 1000, prixReserve: null, dureeJours: 7 },
      undefined,
    )
    expect(outcome).toMatchObject({ status: 'FAILED', code: SyncErrorCode.UNSUPPORTED_MODE })
    expect(calls).toHaveLength(0)
  })

  it('429 → RATE_LIMITED (retryable) ; 400 avec errors → REMOTE_REJECTED + detail', async () => {
    const limited = new EbayConnector({
      fetchFn: fetchQueue([{ status: 429, body: {} }]).fn,
      env: ENV,
    })
    expect(await limited.publish(LISTING, undefined)).toMatchObject({
      status: 'FAILED',
      kind: 'TRANSIENT',
      code: SyncErrorCode.RATE_LIMITED,
    })

    const rejected = new EbayConnector({
      fetchFn: fetchQueue([
        { status: 400, body: { errors: [{ message: 'Invalid category', longMessage: 'Catégorie 12345 invalide' }] } },
      ]).fn,
      env: ENV,
    })
    const outcome = await rejected.publish(LISTING, undefined)
    expect(outcome).toMatchObject({ status: 'FAILED', code: SyncErrorCode.REMOTE_REJECTED })
  })

  it('exception transport → NETWORK_ERROR (retryable), jamais levé', async () => {
    const connector = new EbayConnector({ fetchFn: throwingFetch, env: ENV })
    expect(await connector.publish(LISTING, undefined)).toMatchObject({
      status: 'FAILED',
      kind: 'TRANSIENT',
      code: SyncErrorCode.NETWORK_ERROR,
    })
  })

  it('retract → POST offer/{id}/withdraw, succès normalisé', async () => {
    const { fn, calls } = fetchQueue([{ status: 200, body: { listingId: '110123456' } }])
    const connector = new EbayConnector({ fetchFn: fn, env: ENV })

    expect(await connector.retract(REF('OF-1'), undefined, 'SOLD_ELSEWHERE')).toEqual({ ok: true })
    expect(new URL(calls[0]?.url ?? '').pathname).toBe('/sell/inventory/v1/offer/OF-1/withdraw')
  })

  it('update → CONNECTOR_UNAVAILABLE (v1 : publish + withdraw uniquement)', async () => {
    const connector = new EbayConnector({ fetchFn: fetchQueue([]).fn, env: ENV })
    expect(await connector.update(REF('OF-1'), LISTING, undefined)).toMatchObject({
      ok: false,
      code: SyncErrorCode.CONNECTOR_UNAVAILABLE,
    })
  })

  it('parseEvent : aucun webhook câblé sur ce port → null', () => {
    const connector = new EbayConnector({ env: ENV })
    expect(connector.parseEvent({ anything: true })).toBeNull()
  })
})
