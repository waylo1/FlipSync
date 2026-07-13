import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import type { MarketplaceStatusResponse } from '@flipsync/core'

/**
 * Publication de bout en bout via le connecteur MOCK sanctionné
 * (MARKETPLACE_MOCK=1) : QUEUED → POST /publish → PUBLISHED + URL persistée.
 * C'est la validation la plus profonde possible du pipeline publish tant que
 * les credentials partenaires réels (Vinted Integrations / LBC Partenaire,
 * programmes sous contrat) ne sont pas fournis — cf. Sprint 3.
 */
const DB_URL = process.env.DATABASE_URL

describe.skipIf(!DB_URL)('Publish mock e2e — QUEUED → PUBLISHED', () => {
  let app: FastifyInstance
  let prismaRef: typeof import('@flipsync/db').prisma
  let token = ''
  let userId = ''
  let listingId = ''
  let logDir = ''

  const EMAIL = 'publish-mock-test@flipsync.fr'
  const authed = () => ({ authorization: `Bearer ${token}` })

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    // Mode mock actif AVANT buildApp : le client marketplace est câblé au boot.
    process.env.MARKETPLACE_MOCK = '1'
    logDir = await mkdtemp(join(tmpdir(), 'flipsync-mock-publish-'))
    process.env.MOCK_PUBLISH_LOG = join(logDir, 'publish_log.json')

    const { prisma } = await import('@flipsync/db')
    prismaRef = prisma

    const stale = await prisma.user.findUnique({ where: { email: EMAIL } })
    if (stale) {
      await prisma.walletTransaction.deleteMany({ where: { wallet: { userId: stale.id } } })
      await prisma.listing.deleteMany({ where: { userId: stale.id } })
      await prisma.user.delete({ where: { id: stale.id } })
    }
    const user = await prisma.user.create({
      data: { email: EMAIL, wallet: { create: { balance: 1000, freeListingsRemaining: 0 } } },
    })
    userId = user.id

    const { buildApp } = await import('./app')
    app = await buildApp()
    token = app.jwt.sign({ sub: userId })
  })

  afterAll(async () => {
    delete process.env.MARKETPLACE_MOCK
    delete process.env.MOCK_PUBLISH_LOG
    await rm(logDir, { recursive: true, force: true })
    await app.close()
  })

  it('GET /marketplace/status en mode mock → CONNECTED (mock: true)', async () => {
    const res = await app.inject({ method: 'GET', url: '/marketplace/status', headers: authed() })
    expect(res.statusCode).toBe(200)
    const body = res.json() as MarketplaceStatusResponse
    expect(body.connections).toEqual([
      { marketplace: 'VINTED', state: 'CONNECTED', mock: true, detail: null },
      { marketplace: 'LEBONCOIN', state: 'CONNECTED', mock: true, detail: null },
    ])
  })

  /** create → ai-start → draft → validate : retourne l'id d'un listing QUEUED. */
  async function createQueuedListing(): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/listing',
      headers: authed(),
      payload: { tier: 'SIMPLE' },
    })
    expect(created.statusCode).toBe(201)
    const id = (created.json() as { listing: { id: string } }).listing.id

    // Le pivot UnifiedListing exige ≥1 photo (isUnifiedListingValid) —
    // sha256 de la CHAÎNE base64, convention partagée avec le mobile.
    const base64 = Buffer.from(`fake-jpeg-${id}`).toString('base64')
    const sha256 = createHash('sha256').update(base64).digest('hex')
    const photos = await app.inject({
      method: 'POST',
      url: `/listing/${id}/photos`,
      headers: authed(),
      payload: { photos: [{ base64, sha256, order: 0 }] },
    })
    expect(photos.statusCode).toBe(201)

    await app.inject({ method: 'POST', url: `/listing/${id}/ai-start`, headers: authed() })
    const drafted = await app.inject({
      method: 'POST',
      url: `/listing/${id}/draft`,
      headers: authed(),
      payload: {
        titre: 'Lampe opaline vintage',
        description: 'Verre opalin, années 70, très bon état.',
        categorieLbc: 'Décoration',
        categorieVinted: 'Maison > Luminaires',
        etat: 'tres_bon',
        prixPlancher: 2000,
        prixHaut: 3500,
        marque: null,
        confidence: 0.8,
      },
    })
    expect(drafted.statusCode).toBe(200)

    const validated = await app.inject({
      method: 'POST',
      url: `/listing/${id}/validate`,
      headers: authed(),
      payload: { prixPublie: 3000 },
    })
    expect(validated.statusCode).toBe(200)
    expect((validated.json() as { listing: { status: string } }).listing.status).toBe('QUEUED')
    return id
  }

  it('flux complet → publish (défaut multi-plateformes) → PUBLISHED + externalIds persistés', async () => {
    listingId = await createQueuedListing()

    // Sans body : cibles par défaut VINTED + LEBONCOIN (Core Sync Engine).
    const published = await app.inject({
      method: 'POST',
      url: `/listing/${listingId}/publish`,
      headers: authed(),
      payload: {},
    })
    expect(published.statusCode).toBe(200)
    expect(published.json()).toMatchObject({
      status: 'PUBLISHED',
      results: [
        { marketplace: 'VINTED', ok: true },
        { marketplace: 'LEBONCOIN', ok: true },
      ],
    })

    const listing = await prismaRef.listing.findUniqueOrThrow({ where: { id: listingId } })
    expect(listing.status).toBe('PUBLISHED')
    expect(listing.vintedUrl).toMatch(/^https:\/\/mock\.flipsync\.local\/vinted\//)
    expect(listing.lbcUrl).toMatch(/^https:\/\/mock\.flipsync\.local\/leboncoin\//)

    // externalIds persistés — 1 ligne ListingPublication par plateforme publiée.
    const publications = await prismaRef.listingPublication.findMany({
      where: { listingId },
      orderBy: { marketplace: 'asc' },
    })
    expect(publications.map(p => p.marketplace)).toEqual(['LEBONCOIN', 'VINTED'])
    expect(publications.every(p => p.externalId.startsWith('mock-'))).toBe(true)

    // Publication réussie = pas de remboursement : le débit du palier reste acquis.
    const refunds = await prismaRef.walletTransaction.findMany({
      where: { listingId, type: 'REFUND' },
    })
    expect(refunds).toHaveLength(0)
  })

  it('Jeton Global — succès partiel (VINTED ok, EBAY sans connecteur) → PUBLISHED, zéro refund', async () => {
    const id = await createQueuedListing()

    const published = await app.inject({
      method: 'POST',
      url: `/listing/${id}/publish`,
      headers: authed(),
      payload: { marketplaces: ['VINTED', 'EBAY'] },
    })
    expect(published.statusCode).toBe(200)
    expect(published.json()).toMatchObject({
      status: 'PUBLISHED',
      results: [
        { marketplace: 'VINTED', ok: true },
        { marketplace: 'EBAY', ok: false, code: 'CONNECTOR_UNAVAILABLE' },
      ],
    })

    // ≥1 succès : une seule ListingPublication (VINTED), aucun remboursement.
    const publications = await prismaRef.listingPublication.findMany({ where: { listingId: id } })
    expect(publications.map(p => p.marketplace)).toEqual(['VINTED'])
    const refunds = await prismaRef.walletTransaction.findMany({
      where: { listingId: id, type: 'REFUND' },
    })
    expect(refunds).toHaveLength(0)
  })
})
