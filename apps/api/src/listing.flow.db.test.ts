import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'

/**
 * Test e2e du flux mobile complet via fastify.inject + JWT réel :
 * POST /listing → ai-start → draft → validate → QUEUED + débit wallet.
 * C'est EXACTEMENT la séquence exécutée par l'écran de validation mobile.
 */
const DB_URL = process.env.DATABASE_URL

const DRAFT_BODY = {
  titre: 'Veste cuir Schott',
  description: 'Très bon état, peu portée.',
  categorieId: 'vetements-homme-veste',
  etat: 'tres_bon',
  prixPlancher: 8000,
  prixHaut: 12000,
  marque: 'Schott',
  confidence: 0.9,
}

describe.skipIf(!DB_URL)('Flux mobile /listing — e2e JWT', () => {
  let app: FastifyInstance
  let prismaRef: typeof import('@flipsync/db').prisma
  let token = ''
  let otherToken = ''
  let userId = ''
  let listingId = ''

  const EMAIL = 'mobile-flow-test@flipsync.fr'
  const OTHER_EMAIL = 'mobile-flow-other@flipsync.fr'

  const authed = (t: string) => ({ authorization: `Bearer ${t}` })

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-at-least-32-characters-long!!'
    process.env.STRIPE_SECRET_KEY = 'sk_test_x'
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_x'
    process.env.AUTH_RATE_LIMIT_MAX = '1000' // hors sujet ici — la limite a son test dédié

    const { prisma } = await import('@flipsync/db')
    prismaRef = prisma

    for (const email of [EMAIL, OTHER_EMAIL]) {
      const stale = await prisma.user.findUnique({ where: { email } })
      if (stale) {
        await prisma.walletTransaction.deleteMany({ where: { wallet: { userId: stale.id } } })
        await prisma.listing.deleteMany({ where: { userId: stale.id } })
        await prisma.user.delete({ where: { id: stale.id } })
      }
    }

    const user = await prisma.user.create({
      data: { email: EMAIL, wallet: { create: { balance: 1000, freeListingsRemaining: 0 } } },
    })
    userId = user.id
    const other = await prisma.user.create({
      data: { email: OTHER_EMAIL, wallet: { create: { balance: 0 } } },
    })

    const { buildApp } = await import('./app')
    app = await buildApp()
    token = app.jwt.sign({ sub: userId })
    otherToken = app.jwt.sign({ sub: other.id })
  })

  afterAll(async () => {
    await app.close()
  })

  it('POST /listing → 201 AUTHORIZED (wallet, 0 débit)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/listing',
      headers: authed(token),
      payload: { tier: 'OPTIMIZED' },
    })

    expect(res.statusCode).toBe(201)
    const json = res.json() as {
      listing: { id: string; status: string; paymentSource: string }
      auth: { authorized: boolean }
    }
    expect(json.listing.status).toBe('AUTHORIZED')
    expect(json.auth.authorized).toBe(true)
    listingId = json.listing.id

    const wallet = await prismaRef.userWallet.findUniqueOrThrow({ where: { userId } })
    expect(wallet.balance).toBe(1000)
  })

  it('upload photos avec sha256 valide → 201, fichiers enregistrés', async () => {
    // Convention : sha256 de la CHAÎNE base64 (cf. route /photos).
    const base64 = Buffer.from('fake-jpeg-bytes-1').toString('base64')
    const sha256 = createHash('sha256').update(base64).digest('hex')

    const res = await app.inject({
      method: 'POST',
      url: `/listing/${listingId}/photos`,
      headers: authed(token),
      payload: { photos: [{ base64, sha256, order: 0 }] },
    })

    expect(res.statusCode).toBe(201)
    const { photos } = res.json() as { photos: { sha256: string; url: string; order: number }[] }
    expect(photos).toHaveLength(1)
    expect(photos[0]?.sha256).toBe(sha256)
    expect(photos[0]?.url).toBe(`/uploads/listings/${listingId}/${sha256}.jpg`)

    // Idempotence : re-upload du même sha256 → toujours 1 photo.
    const replay = await app.inject({
      method: 'POST',
      url: `/listing/${listingId}/photos`,
      headers: authed(token),
      payload: { photos: [{ base64, sha256, order: 0 }] },
    })
    expect(replay.statusCode).toBe(201)
    expect((replay.json() as { photos: unknown[] }).photos).toHaveLength(1)
  })

  it('photo servie sur /uploads : 401 sans JWT, 200 avec', async () => {
    const photo = await prismaRef.listingPhoto.findFirstOrThrow({ where: { listingId } })

    const anonymous = await app.inject({ method: 'GET', url: photo.url })
    expect(anonymous.statusCode).toBe(401)
    expect(anonymous.json()).toEqual({ error: 'UNAUTHORIZED' })

    const authenticated = await app.inject({ method: 'GET', url: photo.url, headers: authed(token) })
    expect(authenticated.statusCode).toBe(200)
  })

  it('photo servie via URL signée SANS JWT : 200 ; signature altérée ou expirée : 401', async () => {
    const photo = await prismaRef.listingPhoto.findFirstOrThrow({ where: { listingId } })
    const { signPhotoPath } = await import('./services/photo-url.service')

    // Chemin signé = ce que le pipeline publish envoie aux plateformes (Run 6).
    const signed = signPhotoPath(photo.url)
    const external = await app.inject({ method: 'GET', url: signed })
    expect(external.statusCode).toBe(200)

    const forged = await app.inject({ method: 'GET', url: signed.replace(/sig=.{6}/, 'sig=000000') })
    expect(forged.statusCode).toBe(401)
    expect(forged.json()).toEqual({ error: 'UNAUTHORIZED' })

    const expired = await app.inject({ method: 'GET', url: signPhotoPath(photo.url, -1) })
    expect(expired.statusCode).toBe(401)
  })

  it('hash falsifié → 400 HASH_MISMATCH, rien n’est écrit', async () => {
    const base64 = Buffer.from('fake-jpeg-bytes-2').toString('base64')
    const res = await app.inject({
      method: 'POST',
      url: `/listing/${listingId}/photos`,
      headers: authed(token),
      payload: { photos: [{ base64, sha256: 'a'.repeat(64), order: 1 }] },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'HASH_MISMATCH' })

    const count = await prismaRef.listingPhoto.count({ where: { listingId } })
    expect(count).toBe(1) // seule la photo valide du test précédent
  })

  it('un autre utilisateur ne voit pas ce listing (404, pas de fuite)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/listing/${listingId}/ai-start`,
      headers: authed(otherToken),
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'LISTING_NOT_FOUND' })
  })

  it('ai-start → AI_PROCESSING', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/listing/${listingId}/ai-start`,
      headers: authed(token),
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { listing: { status: string } }).listing.status).toBe('AI_PROCESSING')
  })

  it('draft avec prix Float → 400 INVALID_BODY (centimes Int obligatoires)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/listing/${listingId}/draft`,
      headers: authed(token),
      payload: { ...DRAFT_BODY, prixHaut: 120.5 },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'INVALID_BODY' })
  })

  it('draft valide → DRAFT_READY avec champs persistés', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/listing/${listingId}/draft`,
      headers: authed(token),
      payload: DRAFT_BODY,
    })
    expect(res.statusCode).toBe(200)
    const listing = (res.json() as { listing: { status: string; titre: string } }).listing
    expect(listing.status).toBe('DRAFT_READY')
    expect(listing.titre).toBe('Veste cuir Schott')
  })

  it('validate → QUEUED, débit 1,99 €, flag diplomatie (15000 > 14400)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/listing/${listingId}/validate`,
      headers: authed(token),
      payload: { prixPublie: 15_000 },
    })
    expect(res.statusCode).toBe(200)
    const listing = (
      res.json() as { listing: { status: string; isPriceFlagged: boolean; prixPublie: number } }
    ).listing
    expect(listing.status).toBe('QUEUED')
    expect(listing.isPriceFlagged).toBe(true)
    expect(listing.prixPublie).toBe(15_000)

    const wallet = await prismaRef.userWallet.findUniqueOrThrow({ where: { userId } })
    expect(wallet.balance).toBe(801)
  })

  it('publish sans credentials partenaire → PUBLISH_FAILED + remboursement auto', async () => {
    // Aucun VINTED_ACCESS_TOKEN en test → le connecteur ne peut pas publier.
    delete process.env.VINTED_ACCESS_TOKEN

    const before = await prismaRef.userWallet.findUniqueOrThrow({ where: { userId } })
    // S'assurer que le draft porte une catégorie canonique (poussée par le mobile).
    await prismaRef.listing.update({
      where: { id: listingId },
      data: { categorieId: 'vetements-homme-veste' },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/listing/${listingId}/publish`,
      headers: authed(token),
      payload: { marketplace: 'VINTED' },
    })

    expect(res.statusCode).toBe(200)
    // Contrat v2 (Core Sync Engine) : un résultat par plateforme ciblée,
    // codes normalisés SyncErrorCode. Jeton Global : 0 succès ⇒ PUBLISH_FAILED.
    expect(res.json()).toMatchObject({
      status: 'PUBLISH_FAILED',
      results: [{ marketplace: 'VINTED', ok: false, code: 'CREDENTIALS_MISSING' }],
      failureReason: 'VINTED:CREDENTIALS_MISSING',
    })

    const listing = await prismaRef.listing.findUniqueOrThrow({ where: { id: listingId } })
    expect(listing.status).toBe('PUBLISH_FAILED')
    expect(listing.failureReason).toBe('VINTED:CREDENTIALS_MISSING')

    // Remboursement automatique : le débit de 199 est restitué.
    const after = await prismaRef.userWallet.findUniqueOrThrow({ where: { userId } })
    expect(after.balance).toBe(before.balance + 199)
    const refunds = await prismaRef.walletTransaction.findMany({
      where: { listingId, type: 'REFUND' },
    })
    expect(refunds).toHaveLength(1)
    expect(refunds[0]?.amount).toBe(199)
  })

  it('upload après validation (QUEUED) → 409, contenu figé au commit', async () => {
    const base64 = Buffer.from('fake-jpeg-bytes-3').toString('base64')
    const sha256 = createHash('sha256').update(base64).digest('hex')

    const res = await app.inject({
      method: 'POST',
      url: `/listing/${listingId}/photos`,
      headers: authed(token),
      payload: { photos: [{ base64, sha256, order: 2 }] },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ error: 'INVALID_LISTING_STATE' })
  })

  it('POST /auth/dev-token → JWT utilisable (dev uniquement)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/dev-token',
      payload: { email: 'dev-login-test@flipsync.fr' },
    })

    expect(res.statusCode).toBe(200)
    const { token: devToken } = res.json() as { token: string }

    const wallet = await app.inject({
      method: 'GET',
      url: '/wallet',
      headers: authed(devToken),
    })
    expect(wallet.statusCode).toBe(200)
    // Wallet par défaut : 3 listings gratuits, solde 0.
    expect(wallet.json()).toMatchObject({ balance: 0, freeListingsRemaining: 3 })
  })
})
