import {
  ListingPayload,
  Marketplace,
  MarketplaceConnector,
  MarketplaceCredentials,
  PublishResult,
} from '../types'

/**
 * Connecteur Leboncoin — API Partenaire / dépôt d'annonces pro (OFFICIELLE).
 *
 * Deux voies sanctionnées possibles :
 *   1. API Partenaire LBC directe (clé partenaire + compte pro vendeur).
 *   2. Agrégateur multi-marketplace (Lengow, Shopping Feed) qui relaie vers LBC.
 *
 * Endpoint squelette (à confirmer à l'onboarding) :
 *   POST {LBC_API_BASE}/listings
 *   Authorization: Bearer <accessToken / clé partenaire>
 *
 * Aucune automatisation UI, aucun contournement de détection.
 */
export class LeboncoinConnector implements MarketplaceConnector {
  readonly marketplace = Marketplace.LEBONCOIN

  // TODO(partenaire) : URL exacte fournie à l'onboarding LBC Partenaire / agrégateur.
  private static readonly API_BASE =
    process.env.LEBONCOIN_API_BASE ?? 'https://api.leboncoin.fr/partner'

  async publish(
    payload: ListingPayload,
    credentials: MarketplaceCredentials,
  ): Promise<PublishResult> {
    if (!credentials.accessToken) return { ok: false, code: 'MARKETPLACE_CREDENTIALS_MISSING' }

    const body = {
      subject: payload.titre,
      body: payload.description,
      // LBC attend un prix entier en CENTIMES nativement — pas de conversion.
      price_cents: payload.prixCents,
      brand: payload.marque ?? undefined,
      // TODO(partenaire) : mapping etat → condition LBC + category_id réel.
      condition: payload.etat,
      category: payload.categorie,
      images: payload.photoUrls,
      seller_id: credentials.sellerId,
    }

    try {
      const res = await fetch(`${LeboncoinConnector.API_BASE}/listings`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credentials.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        return { ok: false, code: `LBC_HTTP_${res.status}` }
      }

      // TODO(partenaire) : forme exacte de la réponse (ad_id, url) selon la doc.
      const json = (await res.json()) as { ad_id?: string; url?: string }
      if (!json.ad_id || !json.url) return { ok: false, code: 'LBC_BAD_RESPONSE' }

      return { ok: true, externalId: json.ad_id, url: json.url }
    } catch {
      return { ok: false, code: 'LBC_NETWORK_ERROR' }
    }
  }
}
