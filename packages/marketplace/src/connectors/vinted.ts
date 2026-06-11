import {
  ListingPayload,
  Marketplace,
  MarketplaceConnector,
  MarketplaceCredentials,
  PublishResult,
} from '../types'
import { priceToDecimal } from '../format'

/**
 * Connecteur Vinted — API Integrations / Vinted Pro (OFFICIELLE).
 *
 * Base API partenaire (à confirmer lors de l'onboarding programme) :
 *   POST {VINTED_API_BASE}/v1/items
 *   Authorization: Bearer <accessToken vendeur>
 *
 * Aucune automatisation UI, aucun contournement : publication sanctionnée
 * via le programme partenaire Vinted. Le mapping ci-dessous est un squelette,
 * à ajuster au schéma exact renvoyé par la doc partenaire.
 */
export class VintedConnector implements MarketplaceConnector {
  readonly marketplace = Marketplace.VINTED

  // TODO(partenaire) : URL exacte fournie à l'onboarding Vinted Integrations.
  private static readonly API_BASE =
    process.env.VINTED_API_BASE ?? 'https://api.vinted.com/partner'

  async publish(
    payload: ListingPayload,
    credentials: MarketplaceCredentials,
  ): Promise<PublishResult> {
    if (!credentials.accessToken) return { ok: false, code: 'MARKETPLACE_CREDENTIALS_MISSING' }

    const body = {
      title: payload.titre,
      description: payload.description,
      // Vinted attend un prix décimal + devise — dérivé de centimes Int.
      price: priceToDecimal(payload.prixCents),
      currency: 'EUR',
      brand: payload.marque ?? undefined,
      // TODO(partenaire) : table de correspondance etat → status_id Vinted.
      status: payload.etat,
      category: payload.categorie,
      photo_urls: payload.photoUrls,
    }

    try {
      const res = await fetch(`${VintedConnector.API_BASE}/v1/items`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        return { ok: false, code: `VINTED_HTTP_${res.status}` }
      }

      // TODO(partenaire) : forme exacte de la réponse (id, url) selon la doc.
      const json = (await res.json()) as { id?: string; url?: string }
      if (!json.id || !json.url) return { ok: false, code: 'VINTED_BAD_RESPONSE' }

      return { ok: true, externalId: json.id, url: json.url }
    } catch {
      return { ok: false, code: 'VINTED_NETWORK_ERROR' }
    }
  }
}
