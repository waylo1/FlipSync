import { ItemCondition } from '@flipsync/core'

/** Plateformes de revente supportées par les connecteurs officiels. */
export enum Marketplace {
  LEBONCOIN = 'LEBONCOIN',
  VINTED = 'VINTED',
}

/**
 * Données d'une annonce prêtes à publier — issues du brouillon Moondream2
 * (on-device) validé par l'utilisateur. Tous les prix en CENTIMES (Int).
 */
export interface ListingPayload {
  titre: string
  description: string
  /** Catégorie selon le référentiel de la plateforme cible. */
  categorie: string
  etat: ItemCondition
  marque: string | null
  /** Prix publié, centimes Int — JAMAIS de Float. */
  prixCents: number
  /** URLs absolues des photos servies par l'API (/uploads/...). */
  photoUrls: readonly string[]
}

/** Identifiants partenaire d'un compte vendeur sur une plateforme. */
export interface MarketplaceCredentials {
  marketplace: Marketplace
  /** Jeton OAuth/clé partenaire — propre au vendeur. */
  accessToken: string
  /** Identifiant boutique/vendeur côté plateforme, si requis. */
  sellerId?: string
}

/** Résultat d'une tentative de publication. */
export type PublishResult =
  | { ok: true; externalId: string; url: string }
  | { ok: false; code: string } // code SNAKE_CASE → failureReason / remboursement

/**
 * Contrat commun à tous les connecteurs marketplace.
 * Une implémentation = une plateforme, via son API partenaire OFFICIELLE.
 */
export interface MarketplaceConnector {
  readonly marketplace: Marketplace
  publish(payload: ListingPayload, credentials: MarketplaceCredentials): Promise<PublishResult>
}
