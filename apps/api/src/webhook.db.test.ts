import { createHash, createHmac, createSign, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * /webhooks/vendu — anti-double-vente (Spec 3, Run 5).
 * Crypto RÉELLE de bout en bout : HMAC-SHA256 Shopify calculé avec le secret
 * de test, signature ECDSA eBay produite avec une paire de clés générée ici
 * (la clé publique est injectée via EBAY_WEBHOOK_PUBLIC_KEY_PEM — seam
 * documentée de la route). Aucun credential connecteur : les retraits
 * échouent de façon contrôlée (CREDENTIALS_MISSING / CONNECTOR_UNAVAILABLE),
 * ce qui prouve allSettled + écriture des statuts sans réseau.
 */
const DB_URL = process.env.DATABASE_URL

const SHOPIFY_SECRET = 'shpss_test_secret'
const EBAY_VERIF_TOKEN = 'verification-token-0123456789-01234567'
const EBAY_ENDPOINT = 'https://api.flipsync.fr/webhooks/vendu'
const SHOPIFY_GID = 'gid://shopify/Product/777'

describe.skipIf(!DB_URL)('Webhooks /webhooks/vendu — anti-double-vente', () => {
  let app: FastifyInstance
  let prismaRef: typeof import('@flipsync/db').prisma
  let listingId = ''
  let ebayPrivateKey: KeyObject

  const EMAIL = 'webhook-vendu-test@flipsync.fr'

  const shopifyHeaders = (body: string, topic = 'orders/create') => ({
    'content-type': 'application/json',
    'x-shopify-hmac-sha256': createHmac('sha256', SHOPIFY_SECRET).update(body).digest('base64'),
    'x-shopify-topic': topic,
  })

  const ebayHeaders = (body: string, key: KeyObject = ebayPrivateKey) => {
    const signature = createSign('SHA1').update(body).sign(key, 'base64')
    return {
      'content-type': 'application/json',
      'x-ebay-signature': Buffer.from(
        JSON.stringify({ alg: 'ecdsa', kid: 'test-kid', signature }),
      ).toString('base64'),
    }
  }

  const publicationStatuses = async () => {
    const rows = await prismaRef.listingPublication.findMany({
      where: { listingId },
      orderBy: { marketplace: 'asc' },
    })
    return Object.fromEntries(rows.map(r => [r.marketplace, r.status]))
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    process.env.SHOPIFY_WEBHOOK_SECRET = SHOPIFY_SECRET
    process.env.EBAY_WEBHOOK_VERIFICATION_TOKEN = EBAY_VERIF_TOKEN
    process.env.EBAY_WEBHOOK_ENDPOINT = EBAY_ENDPOINT

    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    ebayPrivateKey = privateKey
    process.env.EBAY_WEBHOOK_PUBLIC_KEY_PEM = publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString()

    // Aucun credential connecteur : les retraits doivent échouer SANS réseau.
    for (const key of [
      'EBAY_ACCESS_TOKEN',
      'EBAY_MERCHANT_LOCATION_KEY',
      'EBAY_FULFILLMENT_POLICY_ID',
      'EBAY_PAYMENT_POLICY_ID',
      'EBAY_RETURN_POLICY_ID',
      'EBAY_CATEGORY_ID',
      'SHOPIFY_SHOP',
      'SHOPIFY_ADMIN_TOKEN',
    ]) {
      delete process.env[key]
    }

    const { prisma } = await import('@flipsync/db')
    prismaRef = prisma

    const stale = await prisma.user.findUnique({ where: { email: EMAIL } })
    if (stale) {
      await prisma.walletTransaction.deleteMany({ where: { wallet: { userId: stale.id } } })
      await prisma.listing.deleteMany({ where: { userId: stale.id } })
      await prisma.user.delete({ where: { id: stale.id } })
    }
    const user = await prisma.user.create({
      data: { email: EMAIL, wallet: { create: { balance: 0 } } },
    })

    // Listing PUBLISHED sur 3 plateformes — inséré directement (le pipeline
    // publish a ses propres tests e2e) : SHOPIFY + EBAY (v2) + VINTED (v1).
    const listing = await prisma.listing.create({
      data: {
        userId: user.id,
        tier: 'SIMPLE',
        status: 'PUBLISHED',
        paymentSource: 'WALLET',
        cost: 80,
        titre: 'Lampe opaline vintage',
        publications: {
          create: [
            { marketplace: 'SHOPIFY', externalId: SHOPIFY_GID, url: null },
            { marketplace: 'EBAY', externalId: 'OF-9', url: null },
            { marketplace: 'VINTED', externalId: 'v-legacy-1', url: null },
          ],
        },
      },
    })
    listingId = listing.id

    const { buildApp } = await import('./app')
    app = await buildApp()
  })

  afterAll(async () => {
    delete process.env.SHOPIFY_WEBHOOK_SECRET
    delete process.env.EBAY_WEBHOOK_VERIFICATION_TOKEN
    delete process.env.EBAY_WEBHOOK_ENDPOINT
    delete process.env.EBAY_WEBHOOK_PUBLIC_KEY_PEM
    await app.close()
  })

  it('GET /vendu — challenge eBay : sha256(challenge + token + endpoint)', async () => {
    const res = await app.inject({ method: 'GET', url: '/webhooks/vendu?challenge_code=abc123' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      challengeResponse: createHash('sha256')
        .update(`abc123${EBAY_VERIF_TOKEN}${EBAY_ENDPOINT}`)
        .digest('hex'),
    })
  })

  it('GET /vendu sans challenge_code → 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/webhooks/vendu' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'MISSING_CHALLENGE_CODE' })
  })

  it('POST sans aucune signature → 401, gate fail-fast', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/vendu',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'UNKNOWN_WEBHOOK_SOURCE' })
  })

  it('POST Shopify HMAC invalide → 401, aucun effet DB', async () => {
    const body = JSON.stringify({ line_items: [{ product_id: 777 }] })
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/vendu',
      headers: { ...shopifyHeaders(body), 'x-shopify-hmac-sha256': 'AAAA_forgée_AAAA' },
      payload: body,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'INVALID_SIGNATURE' })
    expect(await publicationStatuses()).toEqual({
      EBAY: 'ACTIVE',
      SHOPIFY: 'ACTIVE',
      VINTED: 'ACTIVE',
    })
  })

  it('POST Shopify signé mais topic hors périmètre → 200 acquitté sans effet', async () => {
    const body = JSON.stringify({ line_items: [{ product_id: 777 }] })
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/vendu',
      headers: shopifyHeaders(body, 'products/update'),
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true, handled: false })
  })

  it('POST Shopify signé, produit inconnu → 200 handled:false', async () => {
    const body = JSON.stringify({ line_items: [{ product_id: 999999 }] })
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/vendu',
      headers: shopifyHeaders(body),
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: true, handled: false })
  })

  it('vente Shopify → SOLD + retraits allSettled des sœurs, statuts persistés, zéro wallet', async () => {
    const body = JSON.stringify({ line_items: [{ product_id: 777 }] })
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/vendu',
      headers: shopifyHeaders(body),
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      received: true,
      handled: true,
      listingId,
      sold: 'SHOPIFY',
      withdrawals: [
        // Ordre = déclaration de l'enum Postgres (VINTED < EBAY).
        // Vinted : v1 sans withdraw ; eBay : connecteur réel sans credentials.
        { marketplace: 'VINTED', ok: false, code: 'CONNECTOR_UNAVAILABLE' },
        { marketplace: 'EBAY', ok: false, code: 'CREDENTIALS_MISSING' },
      ],
    })
    expect(await publicationStatuses()).toEqual({
      SHOPIFY: 'SOLD',
      EBAY: 'WITHDRAW_FAILED',
      VINTED: 'WITHDRAW_FAILED',
    })
    // Business Policy hors Core : le webhook ne touche JAMAIS à l'argent.
    const moves = await prismaRef.walletTransaction.findMany({ where: { listingId } })
    expect(moves).toHaveLength(0)
  })

  it('rejeu du même webhook → idempotent : SOLD conservé, retraits échoués RE-tentés', async () => {
    const body = JSON.stringify({ line_items: [{ product_id: 777 }] })
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/vendu',
      headers: shopifyHeaders(body),
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      handled: true,
      withdrawals: [
        { marketplace: 'VINTED', ok: false },
        { marketplace: 'EBAY', ok: false },
      ],
    })
    expect(await publicationStatuses()).toEqual({
      SHOPIFY: 'SOLD',
      EBAY: 'WITHDRAW_FAILED',
      VINTED: 'WITHDRAW_FAILED',
    })
  })

  it('POST eBay signé avec une MAUVAISE clé → 401, aucun effet', async () => {
    const { privateKey: wrongKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const body = JSON.stringify({ notification: { data: { offerId: 'OF-9' } } })
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/vendu',
      headers: ebayHeaders(body, wrongKey),
      payload: body,
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'INVALID_SIGNATURE' })
  })

  it('vente eBay (ECDSA valide) → EBAY passe SOLD, seule VINTED reste à retirer', async () => {
    const body = JSON.stringify({ notification: { data: { offerId: 'OF-9' } } })
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/vendu',
      headers: ebayHeaders(body),
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      received: true,
      handled: true,
      listingId,
      sold: 'EBAY',
      // SHOPIFY est SOLD → jamais retirée ; il ne reste que VINTED.
      withdrawals: [{ marketplace: 'VINTED', ok: false, code: 'CONNECTOR_UNAVAILABLE' }],
    })
    expect(await publicationStatuses()).toEqual({
      SHOPIFY: 'SOLD',
      EBAY: 'SOLD',
      VINTED: 'WITHDRAW_FAILED',
    })
  })
})
