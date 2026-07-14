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
import { priceToDecimal } from '../format'
import type { PartnerConnectorDeps } from './partner-credentials'

/**
 * Connecteur Vinted — API Integrations / Vinted Pro (OFFICIELLE), natif
 * ChannelConnector (C3.6). Aucune automatisation UI, aucun contournement :
 * publication sanctionnée via le programme partenaire Vinted. Mapping
 * squelette, à ajuster au schéma exact renvoyé par la doc partenaire.
 */

function toPublishOutcome(outcome: SyncOutcome): PublishOutcome {
  if (outcome.ok) return { status: 'PUBLISHED', externalId: outcome.externalId, url: outcome.url }
  return { status: 'FAILED', kind: outcome.retryable ? 'TRANSIENT' : 'PERMANENT', code: outcome.code }
}

function toOpOutcome(outcome: SyncOutcome): OpOutcome {
  if (outcome.ok) return { ok: true }
  return { ok: false, kind: outcome.retryable ? 'TRANSIENT' : 'PERMANENT', code: outcome.code }
}

export class VintedConnector implements ChannelConnector {
  readonly channel = Marketplace.VINTED
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

  // TODO(partenaire) : URL exacte fournie à l'onboarding Vinted Integrations.
  private static readonly API_BASE =
    process.env.VINTED_API_BASE ?? 'https://api.vinted.com/partner'

  constructor(private readonly deps: PartnerConnectorDeps) {}

  precheck(listing: CanonicalListing, _seller: SellerContext): Eligibility {
    if (listing.mode !== 'fixed') {
      return { eligible: false, reasons: ['Vinted : prix fixe uniquement'] }
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

  /** Aucun webhook Vinted câblé sur ce port. */
  parseEvent(_raw: unknown): NormalizedChannelEvent | null {
    return null
  }

  private unsupported(op: string): SyncOutcome {
    return {
      ok: false,
      code: SyncErrorCode.CONNECTOR_UNAVAILABLE,
      detail: `${op} non supporté par le connecteur Vinted (publish seul)`,
      retryable: false,
    }
  }

  private async publishInternal(listing: CanonicalListing): Promise<SyncOutcome> {
    if (listing.mode !== 'fixed') {
      // Défense en profondeur — le moteur filtre déjà via precheck().
      return {
        ok: false,
        code: SyncErrorCode.UNSUPPORTED_MODE,
        detail: 'Vinted : prix fixe uniquement',
        retryable: false,
      }
    }

    const resolution = this.deps.resolveCredentials()
    if (!resolution.ok) {
      const outcome: SyncOutcome = {
        ok: false,
        code: SyncErrorCode.CREDENTIALS_MISSING,
        detail: `credentials ${resolution.reason} — VINTED`,
        retryable: false,
      }
      this.deps.onResult?.({ ok: false, code: outcome.detail ?? outcome.code })
      return outcome
    }
    const { accessToken } = resolution.credentials

    const body = {
      title: listing.titre,
      description: listing.description,
      // Vinted attend un prix décimal + devise — dérivé de centimes Int.
      price: priceToDecimal(listing.prix),
      currency: 'EUR',
      brand: listing.marque ?? undefined,
      // TODO(partenaire) : table de correspondance etat → status_id Vinted.
      status: listing.etat,
      category: listing.categorie,
      photo_urls: listing.photos.map(p => p.url),
    }

    let outcome: SyncOutcome
    try {
      const res = await fetch(`${VintedConnector.API_BASE}/v1/items`, {
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
          detail: `VINTED_HTTP_${res.status}`,
          retryable: false,
        }
      } else {
        // TODO(partenaire) : forme exacte de la réponse (id, url) selon la doc.
        const json = (await res.json()) as { id?: string; url?: string }
        outcome =
          !json.id || !json.url
            ? { ok: false, code: SyncErrorCode.REMOTE_REJECTED, detail: 'VINTED_BAD_RESPONSE', retryable: false }
            : { ok: true, externalId: json.id, url: json.url }
      }
    } catch {
      outcome = {
        ok: false,
        code: SyncErrorCode.NETWORK_ERROR,
        detail: 'VINTED_NETWORK_ERROR',
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
