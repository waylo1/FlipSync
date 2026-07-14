// ─── Credentials partenaire — Vinted/Leboncoin (connecteurs v1 natifs, C3.6) ──
// L'engine (CoreSyncPublisher) ne transmet JAMAIS de credentials à publish()
// (toujours `undefined`, cf. sync-publisher.ts) : chaque connecteur résout les
// siennes. Vinted/LBC ont besoin d'une résolution PAR APPELANT (userId, SSOT
// MarketplaceAuthService côté api) — injectée au constructeur plutôt que lue
// depuis l'env comme eBay/Shopify (mêmes plateformes, contrainte différente).

/** Identifiants partenaire résolus — structurellement compatible avec la SSOT api. */
export interface PartnerCredentials {
  accessToken: string
  sellerId?: string
}

export type PartnerCredentialResolution =
  | { ok: true; credentials: PartnerCredentials }
  | { ok: false; reason: 'MISSING' | 'EXPIRED' }

/** Résultat d'une tentative de publication — alimente le suivi AUTH_ERROR de l'appelant. */
export type PartnerPublishResult =
  | { ok: true; externalId: string; url: string }
  | { ok: false; code: string }

export interface PartnerConnectorDeps {
  /** Lecture paresseuse — jamais figée à la construction (credentials mutables en test). */
  resolveCredentials: () => PartnerCredentialResolution
  /** Hook post-tentative — branche le suivi AUTH_ERROR de l'appelant (reportPublishOutcome). */
  onResult?: (result: PartnerPublishResult) => void
}
