import { describe, expect, it } from 'vitest'
import { ItemCondition, SyncErrorCode, type FixedPriceListing } from '@flipsync/core'
import { ShopifyConnector } from './shopify'
import type { FetchLike, HttpInit } from './http'

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

const ENV = { SHOPIFY_SHOP: 'flip.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'shpat-1' }

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

const GID = 'gid://shopify/Product/42'

const createOk = {
  status: 200,
  body: {
    data: {
      productCreate: {
        product: {
          id: GID,
          onlineStorePreviewUrl: 'https://flip.myshopify.com/products/lampe',
          variants: { nodes: [{ id: 'gid://shopify/ProductVariant/7' }] },
        },
        userErrors: [],
      },
    },
  },
}

const priceOk = { status: 200, body: { data: { productVariantsBulkUpdate: { userErrors: [] } } } }

describe('ShopifyConnector — port ChannelConnector (C3.5, natif)', () => {
  it('capacités déclarées — MP direct, pas de négociation, sync, prix fixe uniquement', () => {
    const connector = new ShopifyConnector({ env: {} })
    expect(connector.capabilities).toMatchObject({
      kind: 'MP',
      transport: 'direct',
      negotiation: 'NONE',
      publishMode: 'SYNC',
    })
  })

  it('precheck : mode auction → inéligible sans appel réseau', () => {
    const connector = new ShopifyConnector({ env: ENV })
    const auction = { ...LISTING, mode: 'auction' as const, prixDepart: 1000, prixReserve: null, dureeJours: 7 }
    expect(connector.precheck(auction, undefined).eligible).toBe(false)
  })

  it('precheck : mode fixed → éligible même sans credentials (credentials = échec publish(), pas précheck)', () => {
    const connector = new ShopifyConnector({ env: {} })
    expect(connector.precheck(LISTING, undefined)).toEqual({ eligible: true })
  })

  it('sans configuration → CREDENTIALS_MISSING, zéro appel réseau', async () => {
    const { fn, calls } = fetchQueue([])
    const connector = new ShopifyConnector({ fetchFn: fn, env: {} })

    const outcome = await connector.publish(LISTING, undefined)
    expect(outcome).toMatchObject({ status: 'FAILED', code: SyncErrorCode.CREDENTIALS_MISSING })
    expect(calls).toHaveLength(0)
  })

  it('publish → productCreate + prix variante, externalId = gid produit', async () => {
    const { fn, calls } = fetchQueue([createOk, priceOk])
    const connector = new ShopifyConnector({ fetchFn: fn, env: ENV })

    const outcome = await connector.publish(LISTING, undefined)
    expect(outcome).toEqual({
      status: 'PUBLISHED',
      externalId: GID,
      url: 'https://flip.myshopify.com/products/lampe',
    })

    expect(calls).toHaveLength(2)
    for (const call of calls) {
      expect(call.url).toBe('https://flip.myshopify.com/admin/api/2025-07/graphql.json')
      expect(call.init.headers['X-Shopify-Access-Token']).toBe('shpat-1')
    }
    const create = JSON.parse(calls[0]?.init.body ?? '{}') as {
      variables: { input: Record<string, unknown>; media: unknown[] }
    }
    expect(create.variables.input).toEqual({
      title: LISTING.titre,
      descriptionHtml: LISTING.description,
      vendor: 'Luxo',
      status: 'ACTIVE',
    })
    expect(create.variables.media).toHaveLength(1)
    const price = JSON.parse(calls[1]?.init.body ?? '{}') as {
      variables: { productId: string; variants: Array<{ price: string }> }
    }
    expect(price.variables.productId).toBe(GID)
    expect(price.variables.variants[0]?.price).toBe('30.00')
  })

  it('userErrors productCreate → REMOTE_REJECTED avec detail', async () => {
    const connector = new ShopifyConnector({
      fetchFn: fetchQueue([
        {
          status: 200,
          body: {
            data: {
              productCreate: { product: null, userErrors: [{ message: 'Title is invalid' }] },
            },
          },
        },
      ]).fn,
      env: ENV,
    })
    const outcome = await connector.publish(LISTING, undefined)
    expect(outcome).toMatchObject({ status: 'FAILED', code: SyncErrorCode.REMOTE_REJECTED })
  })

  it('erreur GraphQL THROTTLED → RATE_LIMITED retryable', async () => {
    const connector = new ShopifyConnector({
      fetchFn: fetchQueue([
        { status: 200, body: { errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] } },
      ]).fn,
      env: ENV,
    })
    expect(await connector.publish(LISTING, undefined)).toMatchObject({
      status: 'FAILED',
      kind: 'TRANSIENT',
      code: SyncErrorCode.RATE_LIMITED,
    })
  })

  it('HTTP 401 → CREDENTIALS_MISSING (token révoqué)', async () => {
    const connector = new ShopifyConnector({
      fetchFn: fetchQueue([{ status: 401, body: { errors: 'Invalid API key' } }]).fn,
      env: ENV,
    })
    expect(await connector.publish(LISTING, undefined)).toMatchObject({
      status: 'FAILED',
      code: SyncErrorCode.CREDENTIALS_MISSING,
    })
  })

  it('pivot sans photo (gate Zod media) → INVALID_PAYLOAD, zéro appel réseau', async () => {
    const { fn, calls } = fetchQueue([])
    const connector = new ShopifyConnector({ fetchFn: fn, env: ENV })

    expect(await connector.publish({ ...LISTING, photos: [] }, undefined)).toMatchObject({
      status: 'FAILED',
      code: SyncErrorCode.INVALID_PAYLOAD,
    })
    expect(calls).toHaveLength(0)
  })

  it('retract → productUpdate ARCHIVED, succès normalisé', async () => {
    const { fn, calls } = fetchQueue([
      { status: 200, body: { data: { productUpdate: { product: { id: GID }, userErrors: [] } } } },
    ])
    const connector = new ShopifyConnector({ fetchFn: fn, env: ENV })

    expect(await connector.retract(REF(GID), undefined, 'SOLD_ELSEWHERE')).toEqual({ ok: true })
    const body = JSON.parse(calls[0]?.init.body ?? '{}') as {
      variables: { input: { id: string; status: string } }
    }
    expect(body.variables.input).toEqual({ id: GID, status: 'ARCHIVED' })
  })

  it('update → CONNECTOR_UNAVAILABLE (v1 : publish + withdraw uniquement)', async () => {
    const connector = new ShopifyConnector({ fetchFn: fetchQueue([]).fn, env: ENV })
    expect(await connector.update(REF(GID), LISTING, undefined)).toMatchObject({
      ok: false,
      code: SyncErrorCode.CONNECTOR_UNAVAILABLE,
    })
  })

  it('parseEvent : aucun webhook câblé sur ce port → null', () => {
    const connector = new ShopifyConnector({ env: ENV })
    expect(connector.parseEvent({ anything: true })).toBeNull()
  })
})
