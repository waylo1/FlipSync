import { createHash, createHmac, createVerify, timingSafeEqual } from 'node:crypto'
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { Marketplace, PublicationStatus, prisma } from '@flipsync/db'
import { SyncErrorCode, type SyncOutcome } from '@flipsync/core'
import { EbayConnector, ShopifyConnector, type MarketplaceConnector } from '@flipsync/marketplace'

/**
 * Routes /webhooks — notifications de vente entrantes (anti-double-vente).
 *
 * Exception JWT documentée (même statut que /stripe/webhook) : un webhook
 * plateforme est un callback externe, l'authenticité est CRYPTOGRAPHIQUE et
 * jamais skippée — gate Run 5 : signature invalide ⇒ 401, aucun effet DB.
 *  - Shopify : HMAC-SHA256 base64 du body brut (X-Shopify-Hmac-Sha256),
 *    secret partagé SHOPIFY_WEBHOOK_SECRET, comparaison à temps constant.
 *  - eBay    : ECDSA (x-ebay-signature, base64 JSON { kid, signature }) sur le
 *    body brut ; clé publique EBAY_WEBHOOK_PUBLIC_KEY_PEM (dev/tests) ou
 *    récupérée par kid via /commerce/notification/v1/public_key (cache mémoire).
 *    GET /vendu répond au challenge d'enregistrement d'endpoint eBay
 *    (sha256(challengeCode + EBAY_WEBHOOK_VERIFICATION_TOKEN + EBAY_WEBHOOK_ENDPOINT)).
 *
 * Logique de retrait (une vente reçue) :
 *  1. (marketplace, externalId) → ListingPublication source → SOLD (set-once,
 *     first-commit-wins : jamais rétrogradé, rejeu sans effet).
 *  2. Les publications SŒURS encore actionnables (ACTIVE ou WITHDRAW_FAILED —
 *     un rejeu RE-TENTE les retraits échoués) → connector.withdraw() en
 *     Promise.allSettled : pannes isolées, throw ⇒ CONNECTOR_CRASH.
 *  3. Statuts écrits en UNE transaction : WITHDRAWN / WITHDRAW_FAILED
 *     (jamais par-dessus un SOLD concurrent).
 *
 * Business Policy — hors Core (D5) : AUCUNE règle d'argent ici, aucun import
 * wallet (INV-9). Le webhook enregistre des FAITS ; toujours 200 après
 * authentification (un 4xx/5xx déclencherait des retries plateforme en boucle).
 * Observabilité : un log par plateforme { listingId, marketplace, ok, code } — zéro PII.
 */

const SHOPIFY_SALE_TOPICS = new Set(['orders/create', 'orders/paid'])

const shopifyOrderSchema = z.object({
  line_items: z.array(z.object({ product_id: z.union([z.number(), z.string()]) })).min(1),
})

/** En-tête x-ebay-signature décodé — kid optionnel quand la clé PEM vient de l'env. */
const ebaySignatureSchema = z.object({
  kid: z.string().min(1).optional(),
  signature: z.string().min(1),
})

const ebayEnvelopeSchema = z.object({
  notification: z.object({ data: z.record(z.unknown()).default({}) }).optional(),
})

/** Clés publiques eBay par kid — durée de vie du process, une seule récupération. */
const ebayKeyCache = new Map<string, string>()

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex')

const safeEqual = (a: string, b: string): boolean => {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

const parseJsonBuffer = (raw: Buffer): unknown => {
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    return null
  }
}

/** eBay livre parfois la clé sans sauts de ligne — reconstruire un PEM valide. */
const normalizePem = (key: string): string => {
  if (key.includes('\n')) return key
  const body = key
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .trim()
  const chunks = body.match(/.{1,64}/g) ?? []
  return `-----BEGIN PUBLIC KEY-----\n${chunks.join('\n')}\n-----END PUBLIC KEY-----\n`
}

interface SaleEvent {
  marketplace: Marketplace
  /** Candidats externalId côté plateforme — le premier qui matche une publication gagne. */
  externalIds: readonly string[]
}

type SourceResult =
  | { kind: 'sale'; sale: SaleEvent }
  | { kind: 'ignored'; reason: string } // authentifié mais hors périmètre — acquitté
  | { kind: 'reject'; status: number; error: string }

const verifyShopify = (
  raw: Buffer,
  hmacHeader: string,
  topicHeader: string | string[] | undefined,
): SourceResult => {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET
  if (!secret) return { kind: 'reject', status: 503, error: 'SHOPIFY_WEBHOOK_NOT_CONFIGURED' }

  const digest = createHmac('sha256', secret).update(raw).digest('base64')
  if (!safeEqual(digest, hmacHeader)) {
    return { kind: 'reject', status: 401, error: 'INVALID_SIGNATURE' }
  }

  const topic = typeof topicHeader === 'string' ? topicHeader : ''
  if (!SHOPIFY_SALE_TOPICS.has(topic)) return { kind: 'ignored', reason: `topic ${topic || '?'}` }

  const order = shopifyOrderSchema.safeParse(parseJsonBuffer(raw))
  if (!order.success) return { kind: 'ignored', reason: 'payload orders sans line_items' }

  return {
    kind: 'sale',
    sale: {
      marketplace: Marketplace.SHOPIFY,
      // Nos externalId Shopify sont des gid — reconstruits depuis les product_id.
      externalIds: order.data.line_items.map(li => `gid://shopify/Product/${li.product_id}`),
    },
  }
}

/** Résout la clé publique eBay : env (dev/tests) sinon Notification API par kid. */
const resolveEbayKey = async (kid: string | undefined): Promise<string | null> => {
  const fromEnv = process.env.EBAY_WEBHOOK_PUBLIC_KEY_PEM
  if (fromEnv) return fromEnv
  if (!kid) return null
  const cached = ebayKeyCache.get(kid)
  if (cached) return cached
  const token = process.env.EBAY_ACCESS_TOKEN
  if (!token) return null
  try {
    const base = process.env.EBAY_API_BASE ?? 'https://api.ebay.com'
    const res = await fetch(`${base}/commerce/notification/v1/public_key/${kid}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status < 200 || res.status >= 300) return null
    const body = z.object({ key: z.string().min(1) }).safeParse(await res.json())
    if (!body.success) return null
    const pem = normalizePem(body.data.key)
    ebayKeyCache.set(kid, pem)
    return pem
  } catch {
    return null
  }
}

const verifyEbay = async (raw: Buffer, sigHeader: string): Promise<SourceResult> => {
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(sigHeader, 'base64').toString('utf8'))
  } catch {
    return { kind: 'reject', status: 401, error: 'INVALID_SIGNATURE' }
  }
  const sig = ebaySignatureSchema.safeParse(decoded)
  if (!sig.success) return { kind: 'reject', status: 401, error: 'INVALID_SIGNATURE' }

  const pem = await resolveEbayKey(sig.data.kid)
  if (pem === null) return { kind: 'reject', status: 503, error: 'EBAY_KEY_UNAVAILABLE' }

  // ECDSA-with-SHA1 sur le body brut — algorithme du SDK officiel eBay.
  const verifier = createVerify('SHA1')
  verifier.update(raw)
  verifier.end()
  let valid = false
  try {
    valid = verifier.verify(pem, sig.data.signature, 'base64')
  } catch {
    valid = false
  }
  if (!valid) return { kind: 'reject', status: 401, error: 'INVALID_SIGNATURE' }

  const envelope = ebayEnvelopeSchema.safeParse(parseJsonBuffer(raw))
  const data = envelope.success ? (envelope.data.notification?.data ?? {}) : {}
  // Tolérant sur le champ porteur : offerId (notre externalId), sinon
  // listingId/itemId — à resserrer quand le topic réel sera souscrit.
  const externalIds = ['offerId', 'listingId', 'itemId']
    .map(k => data[k])
    .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
    .map(String)
  if (externalIds.length === 0) return { kind: 'ignored', reason: 'notification eBay sans identifiant' }

  return { kind: 'sale', sale: { marketplace: Marketplace.EBAY, externalIds } }
}

/** Marque la vente (set-once) puis retire les publications sœurs — cœur Spec 3. */
const handleSale = async (log: FastifyBaseLogger, sale: SaleEvent) => {
  const publication = await prisma.listingPublication.findFirst({
    where: { marketplace: sale.marketplace, externalId: { in: [...sale.externalIds] } },
  })
  if (!publication) {
    log.warn({ marketplace: sale.marketplace }, 'webhook vendu — externalId inconnu, acquitté')
    return { received: true, handled: false }
  }

  await prisma.listingPublication.updateMany({
    where: { id: publication.id, NOT: { status: PublicationStatus.SOLD } },
    data: { status: PublicationStatus.SOLD },
  })

  const siblings = await prisma.listingPublication.findMany({
    where: {
      listingId: publication.listingId,
      id: { not: publication.id },
      status: { in: [PublicationStatus.ACTIVE, PublicationStatus.WITHDRAW_FAILED] },
    },
    orderBy: { marketplace: 'asc' },
  })

  const registry: ReadonlyMap<Marketplace, MarketplaceConnector> = new Map<
    Marketplace,
    MarketplaceConnector
  >([
    [Marketplace.EBAY, new EbayConnector()],
    [Marketplace.SHOPIFY, new ShopifyConnector()],
  ])

  const settled = await Promise.allSettled(
    siblings.map(s => {
      const connector = registry.get(s.marketplace)
      if (!connector) {
        // LBC/Vinted v1 : pas de withdraw — reste WITHDRAW_FAILED, re-tenté au rejeu.
        return Promise.resolve<SyncOutcome>({
          ok: false,
          code: SyncErrorCode.CONNECTOR_UNAVAILABLE,
          detail: 'retrait non supporté par le connecteur v1',
          retryable: false,
        })
      }
      return Promise.resolve().then(() => connector.withdraw(s.externalId))
    }),
  )
  const results = siblings.map((s, i) => {
    const r = settled[i]
    const outcome: SyncOutcome =
      r === undefined || r.status === 'rejected'
        ? {
            ok: false,
            code: SyncErrorCode.CONNECTOR_CRASH,
            detail:
              r !== undefined && r.reason instanceof Error ? r.reason.message : 'rejet inattendu',
            retryable: false,
          }
        : r.value
    return { pub: s, outcome }
  })

  // Statuts en UNE transaction — updateMany gardé : jamais par-dessus un SOLD concurrent.
  await prisma.$transaction(
    results.map(({ pub, outcome }) =>
      prisma.listingPublication.updateMany({
        where: { id: pub.id, NOT: { status: PublicationStatus.SOLD } },
        data: {
          status: outcome.ok ? PublicationStatus.WITHDRAWN : PublicationStatus.WITHDRAW_FAILED,
        },
      }),
    ),
  )

  for (const { pub, outcome } of results) {
    log.info(
      {
        listingId: publication.listingId,
        marketplace: pub.marketplace,
        ok: outcome.ok,
        ...(outcome.ok ? {} : { code: outcome.code, detail: outcome.detail }),
      },
      'retrait anti-double-vente — résultat',
    )
  }

  return {
    received: true,
    handled: true,
    listingId: publication.listingId,
    sold: publication.marketplace,
    withdrawals: results.map(({ pub, outcome }) =>
      outcome.ok
        ? { marketplace: pub.marketplace, ok: true }
        : { marketplace: pub.marketplace, ok: false, code: outcome.code },
    ),
  }
}

const webhookRoutes: FastifyPluginAsync = async app => {
  // Les signatures portent sur les octets EXACTS — parser raw scopé à ce plugin
  // (même pattern que /stripe/webhook).
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  )

  // Challenge d'enregistrement d'endpoint eBay (Notification API).
  app.get('/vendu', async (req, reply) => {
    const query = z.object({ challenge_code: z.string().min(1) }).safeParse(req.query)
    if (!query.success) return reply.code(400).send({ error: 'MISSING_CHALLENGE_CODE' })
    const token = process.env.EBAY_WEBHOOK_VERIFICATION_TOKEN
    const endpoint = process.env.EBAY_WEBHOOK_ENDPOINT
    if (!token || !endpoint) return reply.code(503).send({ error: 'EBAY_WEBHOOK_NOT_CONFIGURED' })
    return { challengeResponse: sha256Hex(query.data.challenge_code + token + endpoint) }
  })

  app.post('/vendu', async (req, reply) => {
    const raw = req.body as Buffer
    const shopifyHmac = req.headers['x-shopify-hmac-sha256']
    const ebaySignature = req.headers['x-ebay-signature']

    let source: SourceResult
    if (typeof shopifyHmac === 'string') {
      source = verifyShopify(raw, shopifyHmac, req.headers['x-shopify-topic'])
    } else if (typeof ebaySignature === 'string') {
      source = await verifyEbay(raw, ebaySignature)
    } else {
      return reply.code(401).send({ error: 'UNKNOWN_WEBHOOK_SOURCE' })
    }

    if (source.kind === 'reject') {
      req.log.warn({ error: source.error }, 'webhook vendu — rejeté avant tout effet')
      return reply.code(source.status).send({ error: source.error })
    }
    if (source.kind === 'ignored') {
      req.log.info({ reason: source.reason }, 'webhook vendu — authentifié mais hors périmètre')
      return { received: true, handled: false }
    }
    return handleSale(req.log, source.sale)
  })
}

export default webhookRoutes
