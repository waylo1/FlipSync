import { Marketplace, SyncErrorCode, type SyncOutcome } from '@flipsync/core'
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
import type { PartnerConnectorDeps } from './partner-credentials'

/**
 * Connecteur Leboncoin — API Partenaire / dépôt d'annonces pro (OFFICIELLE),
 * natif ChannelConnector (C3.6). Deux voies sanctionnées possibles :
 *   1. API Partenaire LBC directe (clé partenaire + compte pro vendeur).
 *   2. Agrégateur multi-marketplace (Lengow, Shopping Feed) qui relaie vers LBC.
 * Aucune automatisation UI, aucun contournement de détection.
 */

function toPublishOutcome(outcome: SyncOutcome): PublishOutcome {
  if (outcome.ok) return { status: 'PUBLISHED', externalId: outcome.externalId, url: outcome.url }
  return { status: 'FAILED', kind: outcome.retryable ? 'TRANSIENT' : 'PERMANENT', code: outcome.code }
}

function toOpOutcome(outcome: SyncOutcome): OpOutcome {
  if (outcome.ok) return { ok: true }
  return { ok: false, kind: outcome.retryable ? 'TRANSIENT' : 'PERMANENT', code: outcome.code }
}

export class LeboncoinConnector implements ChannelConnector {
  readonly channel = Marketplace.LEBONCOIN
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

  // TODO(partenaire) : URL exacte fournie à l'onboarding LBC Partenaire / agrégateur.
  private static readonly API_BASE =
    process.env.LEBONCOIN_API_BASE ?? 'https://api.leboncoin.fr/partner'

  constructor(private readonly deps: PartnerConnectorDeps) {}

  precheck(listing: CanonicalListing, _seller: SellerContext): Eligibility {
    if (listing.mode !== 'fixed') {
      return { eligible: false, reasons: ['Leboncoin : prix fixe uniquement'] }
    }
    return { eligible: true }
  }

  async publish(listing: CanonicalListing, _credentials: ChannelCredentials): Promise<PublishOutcome> {
    return toPublishOutcome(await this.publishInternal(listing))
  }

  async update(
    _ref: PublicationRef,
    _listing: CanonicalListing,
    _credentials: ChannelCredentials,
  ): Promise<OpOutcome> {
    return toOpOutcome(this.unsupported('update'))
  }

  async retract(_ref: PublicationRef, _credentials: ChannelCredentials, _why: RetractReason): Promise<OpOutcome> {
    return toOpOutcome(this.unsupported('withdraw'))
  }

  /** Aucun webhook Leboncoin câblé sur ce port. */
  parseEvent(_raw: unknown): NormalizedChannelEvent | null {
    return null
  }

  private unsupported(op: string): SyncOutcome {
    return {
      ok: false,
      code: SyncErrorCode.CONNECTOR_UNAVAILABLE,
      detail: `${op} non supporté par le connecteur Leboncoin (publish seul)`,
      retryable: false,
    }
  }

  private async publishInternal(listing: CanonicalListing): Promise<SyncOutcome> {
    if (listing.mode !== 'fixed') {
      // Défense en profondeur — le moteur filtre déjà via precheck().
      return {
        ok: false,
        code: SyncErrorCode.UNSUPPORTED_MODE,
        detail: 'Leboncoin : prix fixe uniquement',
        retryable: false,
      }
    }

    const resolution = this.deps.resolveCredentials()
    if (!resolution.ok) {
      const outcome: SyncOutcome = {
        ok: false,
        code: SyncErrorCode.CREDENTIALS_MISSING,
        detail: `credentials ${resolution.reason} — LEBONCOIN`,
        retryable: false,
      }
      this.deps.onResult?.({ ok: false, code: outcome.detail ?? outcome.code })
      return outcome
    }
    const { accessToken, sellerId } = resolution.credentials

    const body = {
      subject: listing.titre,
      body: listing.description,
      // LBC attend un prix entier en CENTIMES nativement — pas de conversion.
      price_cents: listing.prix,
      brand: listing.marque ?? undefined,
      // TODO(partenaire) : mapping etat → condition LBC + category_id réel.
      condition: listing.etat,
      category: listing.categorie,
      images: listing.photos.map(p => p.url),
      seller_id: sellerId,
    }

    let outcome: SyncOutcome
    try {
      const res = await fetch(`${LeboncoinConnector.API_BASE}/listings`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        outcome = {
          ok: false,
          code: SyncErrorCode.REMOTE_REJECTED,
          detail: `LBC_HTTP_${res.status}`,
          retryable: false,
        }
      } else {
        // TODO(partenaire) : forme exacte de la réponse (ad_id, url) selon la doc.
        const json = (await res.json()) as { ad_id?: string; url?: string }
        outcome =
          !json.ad_id || !json.url
            ? { ok: false, code: SyncErrorCode.REMOTE_REJECTED, detail: 'LBC_BAD_RESPONSE', retryable: false }
            : { ok: true, externalId: json.ad_id, url: json.url }
      }
    } catch {
      outcome = {
        ok: false,
        code: SyncErrorCode.NETWORK_ERROR,
        detail: 'LBC_NETWORK_ERROR',
        retryable: true,
      }
    }

    this.deps.onResult?.(
      outcome.ok
        ? { ok: true, externalId: outcome.externalId, url: outcome.url ?? '' }
        : { ok: false, code: outcome.detail ?? outcome.code },
    )
    return outcome
  }
}
