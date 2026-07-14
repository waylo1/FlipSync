import { z } from 'zod'
import {
  ItemCondition,
  Marketplace,
  SyncErrorCode,
  type RemoteStatusOutcome,
  type SyncFailure,
  type SyncOutcome,
  type UnifiedListing,
} from '@flipsync/core'
import type { ConnectorCapabilities, MarketplaceConnector } from '../interfaces/connector.interface'
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

// ─── Connecteur eBay — Sell Inventory API (REST) ───────────────────────────────
// Publication en 3 appels : inventory item (PUT, sku = listingId) → offer
// (POST) → publish (POST). externalId persisté = offerId (clé de withdraw).
// NOTE spec Run 5 : « AddFixedPriceItem » est l'API Trading (XML, legacy) —
// la voie REST est l'Inventory API, prix fixe uniquement. Les enchères
// exigeraient l'API Trading : hors v1 (doctrine D2) → capabilities `fixed`.

/** Variables d'environnement exigées — toutes absentes ⇒ CREDENTIALS_MISSING. */
const REQUIRED_ENV = [
  'EBAY_ACCESS_TOKEN',
  'EBAY_MERCHANT_LOCATION_KEY',
  'EBAY_FULFILLMENT_POLICY_ID',
  'EBAY_PAYMENT_POLICY_ID',
  'EBAY_RETURN_POLICY_ID',
  // Catégorie eBay numérique par défaut — pas encore de taxonomie interne
  // (pivot `categorie` = libellé FlipSync, inutilisable tel quel côté eBay).
  'EBAY_CATEGORY_ID',
] as const

interface EbayConfig {
  token: string
  base: string
  marketplaceId: string
  merchantLocationKey: string
  fulfillmentPolicyId: string
  paymentPolicyId: string
  returnPolicyId: string
  categoryId: string
}

/** ItemCondition FlipSync → conditions Inventory API. */
const CONDITION: Readonly<Record<ItemCondition, string>> = {
  [ItemCondition.neuf]: 'NEW',
  [ItemCondition.tres_bon]: 'USED_EXCELLENT',
  [ItemCondition.bon]: 'USED_GOOD',
  [ItemCondition.correct]: 'USED_ACCEPTABLE',
}

// ─── Gate Zod — aucun payload non validé ne part vers l'API externe ───────────

const inventoryItemSchema = z
  .object({
    product: z
      .object({
        title: z.string().min(1),
        description: z.string().min(1),
        brand: z.string().min(1).optional(),
        imageUrls: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    condition: z.enum(['NEW', 'USED_EXCELLENT', 'USED_GOOD', 'USED_ACCEPTABLE']),
    availability: z
      .object({ shipToLocationAvailability: z.object({ quantity: z.literal(1) }).strict() })
      .strict(),
  })
  .strict()

const offerSchema = z
  .object({
    sku: z.string().min(1),
    marketplaceId: z.string().min(1),
    format: z.literal('FIXED_PRICE'),
    availableQuantity: z.literal(1),
    categoryId: z.string().min(1),
    listingDescription: z.string().min(1),
    pricingSummary: z
      .object({
        price: z
          .object({ value: z.string().regex(/^\d+\.\d{2}$/), currency: z.literal('EUR') })
          .strict(),
      })
      .strict(),
    listingPolicies: z
      .object({
        fulfillmentPolicyId: z.string().min(1),
        paymentPolicyId: z.string().min(1),
        returnPolicyId: z.string().min(1),
      })
      .strict(),
    merchantLocationKey: z.string().min(1),
  })
  .strict()

/** Corps d'erreur eBay { errors: [{ message, longMessage }] } → diagnostic borné. */
const errorDetail = (raw: string): string | null => {
  const parsed = z
    .object({
      errors: z.array(
        z.object({ message: z.string().optional(), longMessage: z.string().optional() }),
      ),
    })
    .safeParse(parseJson(raw))
  if (parsed.success && parsed.data.errors.length > 0) {
    return truncate(parsed.data.errors.map(e => e.longMessage ?? e.message ?? '').join(' | '))
  }
  return raw === '' ? null : truncate(raw)
}

export class EbayConnector implements MarketplaceConnector {
  readonly marketplace = Marketplace.EBAY
  readonly capabilities: ConnectorCapabilities = { modes: ['fixed'] }

  private readonly fetchFn: FetchLike
  private readonly env: Readonly<Record<string, string | undefined>>

  constructor(deps?: { fetchFn?: FetchLike; env?: Readonly<Record<string, string | undefined>> }) {
    this.fetchFn = deps?.fetchFn ?? defaultFetch
    this.env = deps?.env ?? process.env
  }

  private config(): EbayConfig | SyncFailure {
    const missing = REQUIRED_ENV.filter(k => !this.env[k])
    if (missing.length > 0) {
      return credentialsMissing(`eBay Sell API non configurée — variables : ${missing.join(', ')}`)
    }
    return {
      token: this.env.EBAY_ACCESS_TOKEN as string,
      base: this.env.EBAY_API_BASE ?? 'https://api.ebay.com',
      marketplaceId: this.env.EBAY_MARKETPLACE_ID ?? 'EBAY_FR',
      merchantLocationKey: this.env.EBAY_MERCHANT_LOCATION_KEY as string,
      fulfillmentPolicyId: this.env.EBAY_FULFILLMENT_POLICY_ID as string,
      paymentPolicyId: this.env.EBAY_PAYMENT_POLICY_ID as string,
      returnPolicyId: this.env.EBAY_RETURN_POLICY_ID as string,
      categoryId: this.env.EBAY_CATEGORY_ID as string,
    }
  }

  /** Appel Inventory API — toute erreur (transport ou HTTP) devient un SyncFailure. */
  private async call(
    cfg: EbayConfig,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ ok: true; json: unknown } | SyncFailure> {
    let status: number
    let raw: string
    try {
      const res = await this.fetchFn(`${cfg.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          'Content-Type': 'application/json',
          'Content-Language': 'fr-FR',
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      })
      status = res.status
      raw = await res.text()
    } catch (err) {
      return networkFailure(err)
    }
    if (status < 200 || status >= 300) return httpFailure(status, errorDetail(raw))
    return { ok: true, json: parseJson(raw) }
  }

  async publish(listing: UnifiedListing): Promise<SyncOutcome> {
    if (listing.mode !== 'fixed') {
      // Défense en profondeur — le moteur filtre déjà via capabilities.
      return {
        ok: false,
        code: SyncErrorCode.UNSUPPORTED_MODE,
        detail: 'Inventory API : prix fixe uniquement (enchères = API Trading, hors v1 / D2)',
        retryable: false,
      }
    }
    const cfg = this.config()
    if ('ok' in cfg) return cfg

    // 1. Inventory item — sku = listingId (idempotent côté eBay : PUT remplace).
    const item = inventoryItemSchema.safeParse({
      product: {
        title: listing.titre,
        description: listing.description,
        ...(listing.marque !== null && { brand: listing.marque }),
        imageUrls: listing.photos.map(p => p.url),
      },
      condition: CONDITION[listing.etat],
      availability: { shipToLocationAvailability: { quantity: 1 } },
    })
    if (!item.success) return invalidPayload(truncate(item.error.message))
    const put = await this.call(
      cfg,
      'PUT',
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(listing.listingId)}`,
      item.data,
    )
    if (!('json' in put)) return put

    // 2. Offer — porte le prix, la catégorie et les business policies.
    const offer = offerSchema.safeParse({
      sku: listing.listingId,
      marketplaceId: cfg.marketplaceId,
      format: 'FIXED_PRICE',
      availableQuantity: 1,
      categoryId: cfg.categoryId,
      listingDescription: listing.description,
      pricingSummary: {
        price: { value: centsToDecimal(listing.prix), currency: listing.devise },
      },
      listingPolicies: {
        fulfillmentPolicyId: cfg.fulfillmentPolicyId,
        paymentPolicyId: cfg.paymentPolicyId,
        returnPolicyId: cfg.returnPolicyId,
      },
      merchantLocationKey: cfg.merchantLocationKey,
    })
    if (!offer.success) return invalidPayload(truncate(offer.error.message))
    const created = await this.call(cfg, 'POST', '/sell/inventory/v1/offer', offer.data)
    if (!('json' in created)) return created
    const offerId = z.object({ offerId: z.string().min(1) }).safeParse(created.json)
    if (!offerId.success) {
      return {
        ok: false,
        code: SyncErrorCode.REMOTE_REJECTED,
        detail: 'réponse offer sans offerId',
        retryable: false,
      }
    }

    // 3. Publication de l'offer — l'annonce devient visible.
    const published = await this.call(
      cfg,
      'POST',
      `/sell/inventory/v1/offer/${encodeURIComponent(offerId.data.offerId)}/publish`,
      {},
    )
    if (!('json' in published)) return published
    const listingIdEbay = z.object({ listingId: z.string().min(1) }).safeParse(published.json)

    const host = cfg.marketplaceId === 'EBAY_FR' ? 'www.ebay.fr' : 'www.ebay.com'
    return {
      ok: true,
      externalId: offerId.data.offerId,
      url: listingIdEbay.success ? `https://${host}/itm/${listingIdEbay.data.listingId}` : null,
    }
  }

  async update(_externalId: string, _listing: UnifiedListing): Promise<SyncOutcome> {
    return {
      ok: false,
      code: SyncErrorCode.CONNECTOR_UNAVAILABLE,
      detail: 'eBay v1 : publish + withdraw uniquement',
      retryable: false,
    }
  }

  async withdraw(externalId: string): Promise<SyncOutcome> {
    const cfg = this.config()
    if ('ok' in cfg) return cfg
    const res = await this.call(
      cfg,
      'POST',
      `/sell/inventory/v1/offer/${encodeURIComponent(externalId)}/withdraw`,
      {},
    )
    if (!('json' in res)) return res
    return { ok: true, externalId, url: null }
  }

  async checkStatus(_externalId: string): Promise<RemoteStatusOutcome> {
    return {
      ok: false,
      code: SyncErrorCode.CONNECTOR_UNAVAILABLE,
      detail: 'eBay v1 : publish + withdraw uniquement',
      retryable: false,
    }
  }
}
