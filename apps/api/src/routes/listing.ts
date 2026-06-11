import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { prisma, ListingStatus } from '@flipsync/db'
import { ItemCondition, ListingTier } from '@flipsync/core'
import { Marketplace } from '@flipsync/marketplace'

/** Répertoire de stockage des photos (dev : disque local ; prod : volume monté). */
export const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads'))

const MAX_PHOTOS_PER_LISTING = 5

/** Upload possible uniquement AVANT validation (le contenu est figé au commit). */
const PHOTO_UPLOAD_STATUSES: readonly ListingStatus[] = [
  ListingStatus.PENDING_AUTH,
  ListingStatus.AUTHORIZED,
  ListingStatus.AI_PROCESSING,
  ListingStatus.DRAFT_READY,
]

const createBody = z.object({
  tier: z.nativeEnum(ListingTier),
})

const validateBody = z.object({
  prixPublie: z.number().int().nonnegative(), // centimes
})

const idParams = z.object({
  id: z.string().min(1),
})

/**
 * Brouillon poussé par le mobile après inférence ON-DEVICE (l'API ne fait
 * jamais d'IA). Mêmes règles que la sortie modèle : centimes Int, plancher<=haut.
 */
const draftBody = z
  .object({
    titre: z.string().min(1).max(120),
    description: z.string().min(1),
    categorieLbc: z.string().min(1),
    categorieVinted: z.string().min(1),
    etat: z.nativeEnum(ItemCondition),
    prixPlancher: z.number().int().nonnegative(),
    prixHaut: z.number().int().nonnegative(),
    marque: z.string().min(1).nullable(),
    confidence: z.number().min(0).max(1),
  })
  .refine(d => d.prixPlancher <= d.prixHaut, { message: 'prixPlancher <= prixHaut requis' })

const failBody = z.object({
  reason: z.string().min(1),
})

const publishBody = z.object({
  marketplace: z.nativeEnum(Marketplace),
})

/**
 * CONVENTION D'INTÉGRITÉ : sha256 = hash de la CHAÎNE base64 (pas des octets
 * décodés) — même représentation que côté mobile (expo-crypto
 * digestStringAsync sur le base64). Changer l'un impose de changer l'autre.
 */
const photosBody = z.object({
  photos: z
    .array(
      z.object({
        base64: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/i),
        order: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(MAX_PHOTOS_PER_LISTING),
})

/**
 * Routes /listing — toutes protégées par JWT.
 * Un utilisateur ne voit et ne manipule QUE ses propres listings :
 * toute requête sur un listing d'autrui répond 404 (pas de fuite d'existence).
 */
const listingRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', app.authenticate)

  /** Garde de propriété : retourne le listing seulement s'il appartient au user. */
  const ownedListing = async (listingId: string, userId: string) =>
    prisma.listing.findFirst({ where: { id: listingId, userId } })

  /**
   * Création : authorize() wallet (0 débit) + listing AUTHORIZED ou
   * PENDING_AUTH/BLOCKED avec deficit pour proposer la recharge au mobile.
   */
  app.post('/', async (req, reply) => {
    const body = createBody.safeParse(req.body)
    if (!body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const result = await app.listingEngine.createListing(req.userId, body.data.tier)
    return reply.code(201).send(result)
  })

  /** Listings de l'utilisateur courant (plus récents d'abord). */
  app.get('/', async req => {
    const listings = await prisma.listing.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      include: { photos: { orderBy: { order: 'asc' }, select: { id: true, url: true, order: true } } },
    })
    return { listings }
  })

  /** Détail d'un listing (propriétaire uniquement). */
  app.get('/:id', async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const listing = await prisma.listing.findFirst({
      where: { id: params.data.id, userId: req.userId },
      include: { photos: { orderBy: { order: 'asc' } } },
    })
    if (!listing) return reply.code(404).send({ error: 'LISTING_NOT_FOUND' })
    return { listing }
  })

  /**
   * Validation utilisateur — LE point de débit.
   * DRAFT_READY → USER_VALIDATED (commit wallet atomique) → QUEUED.
   */
  app.post('/:id/validate', async (req, reply) => {
    const params = idParams.safeParse(req.params)
    const body = validateBody.safeParse(req.body)
    if (!params.success || !body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const owned = await ownedListing(params.data.id, req.userId)
    if (!owned) return reply.code(404).send({ error: 'LISTING_NOT_FOUND' })

    await app.listingEngine.validate(params.data.id, body.data.prixPublie)
    const listing = await app.listingEngine.queue(params.data.id)
    return { listing }
  })

  /** Re-tentative d'autorisation après recharge (PENDING_AUTH/BLOCKED). */
  app.post('/:id/reauthorize', async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const owned = await ownedListing(params.data.id, req.userId)
    if (!owned) return reply.code(404).send({ error: 'LISTING_NOT_FOUND' })

    return app.listingEngine.reauthorize(params.data.id)
  })

  /**
   * Pipeline IA piloté par le mobile (inférence on-device) :
   * ai-start → AI_PROCESSING ; draft → DRAFT_READY ; ai-failed → AI_FAILED.
   */
  app.post('/:id/ai-start', async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const owned = await ownedListing(params.data.id, req.userId)
    if (!owned) return reply.code(404).send({ error: 'LISTING_NOT_FOUND' })

    const listing = await app.listingEngine.startAiProcessing(params.data.id)
    return { listing }
  })

  app.post('/:id/draft', async (req, reply) => {
    const params = idParams.safeParse(req.params)
    const body = draftBody.safeParse(req.body)
    if (!params.success || !body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const owned = await ownedListing(params.data.id, req.userId)
    if (!owned) return reply.code(404).send({ error: 'LISTING_NOT_FOUND' })

    const listing = await app.listingEngine.completeAiDraft(params.data.id, body.data)
    return { listing }
  })

  app.post('/:id/ai-failed', async (req, reply) => {
    const params = idParams.safeParse(req.params)
    const body = failBody.safeParse(req.body)
    if (!params.success || !body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const owned = await ownedListing(params.data.id, req.userId)
    if (!owned) return reply.code(404).send({ error: 'LISTING_NOT_FOUND' })

    const listing = await app.listingEngine.failAi(params.data.id, body.data.reason)
    return { listing }
  })

  /**
   * Upload des photos (base64 + sha256). Vérification d'intégrité STRICTE :
   * le hash est recalculé serveur — tout écart rejette le lot entier (aucune
   * écriture partielle). Idempotent par sha256 (re-upload = no-op).
   */
  app.post('/:id/photos', { bodyLimit: 12 * 1024 * 1024 }, async (req, reply) => {
    const params = idParams.safeParse(req.params)
    const body = photosBody.safeParse(req.body)
    if (!params.success || !body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const listing = await ownedListing(params.data.id, req.userId)
    if (!listing) return reply.code(404).send({ error: 'LISTING_NOT_FOUND' })
    if (!PHOTO_UPLOAD_STATUSES.includes(listing.status)) {
      return reply.code(409).send({ error: 'INVALID_LISTING_STATE' })
    }

    // 1. Intégrité du lot complet AVANT toute écriture.
    for (const photo of body.data.photos) {
      const computed = createHash('sha256').update(photo.base64).digest('hex')
      if (computed !== photo.sha256.toLowerCase()) {
        return reply.code(400).send({ error: 'HASH_MISMATCH' })
      }
    }

    // 2. Quota global par listing (idempotence : les sha256 déjà connus ne comptent pas).
    const existing = await prisma.listingPhoto.findMany({
      where: { listingId: listing.id },
      select: { sha256: true },
    })
    const known = new Set(existing.map(p => p.sha256))
    const fresh = body.data.photos.filter(p => !known.has(p.sha256.toLowerCase()))
    if (known.size + fresh.length > MAX_PHOTOS_PER_LISTING) {
      return reply.code(400).send({ error: 'TOO_MANY_PHOTOS' })
    }

    // 3. Écriture disque puis enregistrement DB.
    const dir = join(UPLOAD_DIR, 'listings', listing.id)
    await mkdir(dir, { recursive: true })
    for (const photo of fresh) {
      const sha = photo.sha256.toLowerCase()
      await writeFile(join(dir, `${sha}.jpg`), Buffer.from(photo.base64, 'base64'))
    }
    if (fresh.length > 0) {
      await prisma.listingPhoto.createMany({
        data: fresh.map(p => ({
          listingId: listing.id,
          url: `/uploads/listings/${listing.id}/${p.sha256.toLowerCase()}.jpg`,
          order: p.order,
          sha256: p.sha256.toLowerCase(),
        })),
      })
    }

    const photos = await prisma.listingPhoto.findMany({
      where: { listingId: listing.id },
      orderBy: { order: 'asc' },
      select: { id: true, url: true, order: true, sha256: true },
    })
    return reply.code(201).send({ photos })
  })

  /**
   * Publication marketplace via API partenaire officielle (QUEUED → PUBLISHED).
   * Échec connecteur → PUBLISH_FAILED + remboursement automatique.
   */
  app.post('/:id/publish', async (req, reply) => {
    const params = idParams.safeParse(req.params)
    const body = publishBody.safeParse(req.body)
    if (!params.success || !body.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const owned = await ownedListing(params.data.id, req.userId)
    if (!owned) return reply.code(404).send({ error: 'LISTING_NOT_FOUND' })

    const outcome = await app.publicationService.publish(params.data.id, body.data.marketplace)
    return outcome
  })

  /** Annulation utilisateur — uniquement pré-commit (0 débit). */
  app.post('/:id/cancel', async (req, reply) => {
    const params = idParams.safeParse(req.params)
    if (!params.success) return reply.code(400).send({ error: 'INVALID_BODY' })

    const owned = await ownedListing(params.data.id, req.userId)
    if (!owned) return reply.code(404).send({ error: 'LISTING_NOT_FOUND' })

    const listing = await app.listingEngine.cancel(params.data.id)
    return { listing }
  })
}

export default listingRoutes
