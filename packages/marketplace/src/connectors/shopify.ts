import { z } from 'zod'
import {
  Marketplace,
  SyncErrorCode,
  type SyncFailure,
  type SyncOutcome,
} from '@flipsync/core'
import type {
  CanonicalListing,
  ChannelCapabilities,
  ChannelConnector,
  ChannelCredentials,
  Eligibility,
  NormalizedChannelEvent,
  OpOutcome,
  PublicationRef,
  PublishOutcome,
  RetractReason,
  SellerContext,
} from '../interfaces/channel-connector.interface'
import {
  centsToDecimal,
  credentialsMissing,
  defaultFetch,
  httpFailure,
  invalidPayload,
  networkFailure,
  parseJson,
  truncate,
  type FetchLike,
} from './http'

// ─── Connecteur Shopify — Admin API GraphQL ────────────────────────────────────
// Publication en 2 mutations : productCreate (produit + médias, statut ACTIVE)
// puis productVariantsBulkUpdate (prix de la variante par défaut —
// ProductInput.variants n'existe plus depuis la version 2024-04).
// externalId persisté = gid://shopify/Product/… (clé d'archivage au retrait).

interface ShopifyConfig {
  shop: string
  token: string
  version: string
}

// ─── Gate Zod — aucune variable GraphQL non validée ne part vers l'API ─────────

const productCreateVars = z
  .object({
    input: z
      .object({
        title: z.string().min(1),
        descriptionHtml: z.string().min(1),
        vendor: z.string().min(1).optional(),
        status: z.literal('ACTIVE'),
      })
      .strict(),
    media: z
      .array(
        z
          .object({ originalSource: z.string().min(1), mediaContentType: z.literal('IMAGE') })
          .strict(),
      )
      .min(1),
  })
  .strict()

const variantPriceVars = z
  .object({
    productId: z.string().min(1),
    variants: z
      .array(z.object({ id: z.string().min(1), price: z.string().regex(/^\d+\.\d{2}$/) }).strict())
      .length(1),
  })
  .strict()

const archiveVars = z
  .object({ input: z.object({ id: z.string().min(1), status: z.literal('ARCHIVED') }).strict() })
  .strict()

const PRODUCT_CREATE = `mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
  productCreate(input: $input, media: $media) {
    product { id onlineStorePreviewUrl variants(first: 1) { nodes { id } } }
    userErrors { field message }
  }
}`

const VARIANT_PRICE = `mutation variantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    userErrors { field message }
  }
}`

const PRODUCT_ARCHIVE = `mutation productArchive($input: ProductInput!) {
  productUpdate(input: $input) {
    product { id }
    userErrors { field message }
  }
}`

const userErrorsSchema = z.array(z.object({ message: z.string() }))

const graphqlEnvelope = z.object({
  data: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        message: z.string().optional(),
        extensions: z.object({ code: z.string().optional() }).optional(),
      }),
    )
    .optional(),
})

function toPublishOutcome(outcome: SyncOutcome): PublishOutcome {
  if (outcome.ok) return { status: 'PUBLISHED', externalId: outcome.externalId, url: outcome.url }
  return { status: 'FAILED', kind: outcome.retryable ? 'TRANSIENT' : 'PERMANENT', code: outcome.code }
}

function toOpOutcome(outcome: SyncOutcome): OpOutcome {
  if (outcome.ok) return { ok: true }
  return { ok: false, kind: outcome.retryable ? 'TRANSIENT' : 'PERMANENT', code: outcome.code }
}

export class ShopifyConnector implements ChannelConnector {
  readonly channel = Marketplace.SHOPIFY
  readonly capabilities: ChannelCapabilities = {
    kind: 'MP',
    transport: 'direct',
    negotiation: 'NONE',
    publishMode: 'SYNC',
    photosPerso: false,
    productRef: false,
    seller: 'both',
    retractSla: null,
  }

  private readonly fetchFn: FetchLike
  private readonly env: Readonly<Record<string, string | undefined>>

  constructor(deps?: { fetchFn?: FetchLike; env?: Readonly<Record<string, string | undefined>> }) {
    this.fetchFn = deps?.fetchFn ?? defaultFetch
    this.env = deps?.env ?? process.env
  }

  private config(): ShopifyConfig | SyncFailure {
    const shop = this.env.SHOPIFY_SHOP
    const token = this.env.SHOPIFY_ADMIN_TOKEN
    if (!shop || !token) {
      return credentialsMissing(
        'Shopify Admin API non configurée — variables : SHOPIFY_SHOP, SHOPIFY_ADMIN_TOKEN',
      )
    }
    return { shop, token, version: this.env.SHOPIFY_API_VERSION ?? '2025-07' }
  }

  /**
   * Mutation GraphQL — retourne `data` ou un SyncFailure normalisé
   * (transport, HTTP, erreurs GraphQL top-level dont THROTTLED).
   */
  private async gql(
    cfg: ShopifyConfig,
    query: string,
    variables: unknown,
  ): Promise<{ data: unknown } | SyncFailure> {
    let status: number
    let raw: string
    try {
      const res = await this.fetchFn(
        `https://${cfg.shop}/admin/api/${cfg.version}/graphql.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': cfg.token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, variables }),
        },
      )
      status = res.status
      raw = await res.text()
    } catch (err) {
      return networkFailure(err)
    }
    if (status < 200 || status >= 300) return httpFailure(status, truncate(raw))

    const envelope = graphqlEnvelope.safeParse(parseJson(raw))
    if (!envelope.success) {
      return {
        ok: false,
        code: SyncErrorCode.REMOTE_REJECTED,
        detail: 'réponse GraphQL illisible',
        retryable: false,
      }
    }
    const errors = envelope.data.errors ?? []
    if (errors.length > 0) {
      const throttled = errors.some(e => e.extensions?.code === 'THROTTLED')
      return {
        ok: false,
        code: throttled ? SyncErrorCode.RATE_LIMITED : SyncErrorCode.REMOTE_REJECTED,
        detail: truncate(errors.map(e => e.message ?? '').join(' | ')),
        retryable: throttled,
      }
    }
    return { data: envelope.data.data ?? null }
  }

  /** userErrors métier Shopify (validation distante) → REMOTE_REJECTED. */
  private userErrorsFailure(errors: readonly { message: string }[]): SyncFailure {
    return {
      ok: false,
      code: SyncErrorCode.REMOTE_REJECTED,
      detail: truncate(errors.map(e => e.message).join(' | ')),
      retryable: false,
    }
  }

  precheck(listing: CanonicalListing, _seller: SellerContext): Eligibility {
    if (listing.mode !== 'fixed') {
      return { eligible: false, reasons: ['Shopify : prix fixe uniquement'] }
    }
    return { eligible: true }
  }

  async publish(listing: CanonicalListing, _credentials: ChannelCredentials): Promise<PublishOutcome> {
    return toPublishOutcome(await this.publishInternal(listing))
  }

  async update(
    ref: PublicationRef,
    listing: CanonicalListing,
    _credentials: ChannelCredentials,
  ): Promise<OpOutcome> {
    return toOpOutcome(await this.updateInternal(ref.externalId, listing))
  }

  async retract(ref: PublicationRef, _credentials: ChannelCredentials, _why: RetractReason): Promise<OpOutcome> {
    return toOpOutcome(await this.withdrawInternal(ref.externalId))
  }

  /** Aucun webhook Shopify câblé sur ce port. */
  parseEvent(_raw: unknown): NormalizedChannelEvent | null {
    return null
  }

  private async publishInternal(listing: CanonicalListing): Promise<SyncOutcome> {
    if (listing.mode !== 'fixed') {
      // Défense en profondeur — le moteur filtre déjà via capabilities.
      return {
        ok: false,
        code: SyncErrorCode.UNSUPPORTED_MODE,
        detail: 'Shopify : prix fixe uniquement',
        retryable: false,
      }
    }
    const cfg = this.config()
    if ('ok' in cfg) return cfg

    // 1. productCreate — produit ACTIVE + médias (URLs récupérées par Shopify).
    const createVars = productCreateVars.safeParse({
      input: {
        title: listing.titre,
        descriptionHtml: listing.description,
        ...(listing.marque !== null && { vendor: listing.marque }),
        status: 'ACTIVE',
      },
      media: listing.photos.map(p => ({ originalSource: p.url, mediaContentType: 'IMAGE' })),
    })
    if (!createVars.success) return invalidPayload(truncate(createVars.error.message))
    const created = await this.gql(cfg, PRODUCT_CREATE, createVars.data)
    if (!('data' in created)) return created

    const createResp = z
      .object({
        productCreate: z.object({
          product: z
            .object({
              id: z.string().min(1),
              onlineStorePreviewUrl: z.string().nullable().optional(),
              variants: z.object({ nodes: z.array(z.object({ id: z.string().min(1) })) }),
            })
            .nullable(),
          userErrors: userErrorsSchema,
        }),
      })
      .safeParse(created.data)
    if (!createResp.success) {
      return {
        ok: false,
        code: SyncErrorCode.REMOTE_REJECTED,
        detail: 'réponse productCreate illisible',
        retryable: false,
      }
    }
    const { product, userErrors } = createResp.data.productCreate
    if (userErrors.length > 0 || product === null) {
      return this.userErrorsFailure(
        userErrors.length > 0 ? userErrors : [{ message: 'productCreate sans produit' }],
      )
    }

    // 2. Prix de la variante par défaut. Échec ici = produit créé sans le bon
    // prix → REMOTE_REJECTED avec le productId en detail (réconciliation à la
    // main : aucune publication ne sera persistée pour ce produit orphelin).
    const variantId = product.variants.nodes[0]?.id
    if (variantId === undefined) {
      return {
        ok: false,
        code: SyncErrorCode.REMOTE_REJECTED,
        detail: `produit sans variante par défaut (${product.id})`,
        retryable: false,
      }
    }
    const priceVars = variantPriceVars.safeParse({
      productId: product.id,
      variants: [{ id: variantId, price: centsToDecimal(listing.prix) }],
    })
    if (!priceVars.success) return invalidPayload(truncate(priceVars.error.message))
    const priced = await this.gql(cfg, VARIANT_PRICE, priceVars.data)
    if (!('data' in priced)) return priced
    const priceResp = z
      .object({ productVariantsBulkUpdate: z.object({ userErrors: userErrorsSchema }) })
      .safeParse(priced.data)
    if (!priceResp.success || priceResp.data.productVariantsBulkUpdate.userErrors.length > 0) {
      const errs = priceResp.success ? priceResp.data.productVariantsBulkUpdate.userErrors : []
      return this.userErrorsFailure([
        ...errs,
        { message: `prix non appliqué — produit créé ${product.id}` },
      ])
    }

    return { ok: true, externalId: product.id, url: product.onlineStorePreviewUrl ?? null }
  }

  private async updateInternal(_externalId: string, _listing: CanonicalListing): Promise<SyncOutcome> {
    return {
      ok: false,
      code: SyncErrorCode.CONNECTOR_UNAVAILABLE,
      detail: 'Shopify v1 : publish + withdraw uniquement',
      retryable: false,
    }
  }

  /** Retrait = archivage du produit (idempotent : archiver un archivé réussit). */
  private async withdrawInternal(externalId: string): Promise<SyncOutcome> {
    const cfg = this.config()
    if ('ok' in cfg) return cfg
    const vars = archiveVars.safeParse({ input: { id: externalId, status: 'ARCHIVED' } })
    if (!vars.success) return invalidPayload(truncate(vars.error.message))
    const res = await this.gql(cfg, PRODUCT_ARCHIVE, vars.data)
    if (!('data' in res)) return res
    const resp = z
      .object({ productUpdate: z.object({ userErrors: userErrorsSchema }) })
      .safeParse(res.data)
    if (!resp.success) {
      return {
        ok: false,
        code: SyncErrorCode.REMOTE_REJECTED,
        detail: 'réponse productUpdate illisible',
        retryable: false,
      }
    }
    if (resp.data.productUpdate.userErrors.length > 0) {
      return this.userErrorsFailure(resp.data.productUpdate.userErrors)
    }
    return { ok: true, externalId, url: null }
  }
}
