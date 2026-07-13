import { ItemCondition } from '../generated/enums'
import { Marketplace } from './marketplace'

// ─── Core Sync Engine — DTO pivot & contrats de synchronisation (Phase 3) ─────
// SSOT du format pivot : la représentation UNIQUE d'une annonce que le moteur
// de sync transmet aux connecteurs marketplace (cf. ADR-009).
// GATE agnosticité : AUCUN type spécifique à une plateforme n'entre ici — tout
// mapping (catégories, états, durées, formats) vit dans le connecteur concerné.
// Argent en centimes (Int). Le contrat connecteur vit dans @flipsync/marketplace
// (interfaces/connector.interface.ts) ; ici uniquement les types transportés.

// ─── DTO pivot UnifiedListing ─────────────────────────────────────────────────

/**
 * Devises supportées — union fermée volontairement (whitelist).
 * Étendre UNIQUEMENT à l'ouverture d'une marketplace non-euro.
 */
export type CurrencyCode = 'EUR'

/** Photo publique prête à publier — URL servie par l'API, ordre d'affichage. */
export interface UnifiedPhoto {
  url:   string
  order: number
}

/**
 * Socle commun des deux modes — whitelist STRICTE : aucune clé hors contrat,
 * aucun champ fourre-tout (pas de meta/extra/raw). Un besoin nouveau = une
 * évolution explicite de ce type.
 */
export interface UnifiedListingBase {
  /** Référence interne FlipSync (Listing.id) — clé d'idempotence du moteur. */
  listingId:   string
  titre:       string
  /** Texte brut DÉJÀ nettoyé en amont (sans HTML, URL, téléphone) — le moteur ne nettoie pas. */
  description: string
  /** État normalisé FlipSync — chaque connecteur le mappe vers son vocabulaire. */
  etat:        ItemCondition
  devise:      CurrencyCode
  marque:      string | null
  /** Catégorie interne FlipSync — le mapping par plateforme vit dans le connecteur. */
  categorie:   string
  /** Au moins 1 photo — invariant vérifié par isUnifiedListingValid(). */
  photos:      readonly UnifiedPhoto[]
}

/** Vente à prix fixe — mode unique de Leboncoin, Vinted et Shopify. */
export interface FixedPriceListing extends UnifiedListingBase {
  mode: 'fixed'
  prix: number // centimes
}

/**
 * Vente aux enchères (eBay). Invariants : prixReserve ≥ prixDepart quand
 * présent ; dureeJours borné par le pivot, chaque connecteur restreint ensuite
 * (échec REMOTE_REJECTED si sa plateforme ne supporte pas la valeur).
 */
export interface AuctionListing extends UnifiedListingBase {
  mode:        'auction'
  prixDepart:  number        // centimes
  /** Prix de réserve — null = enchère sans réserve. */
  prixReserve: number | null // centimes
  dureeJours:  number
}

/** DTO pivot — union discriminée par `mode`. */
export type UnifiedListing = FixedPriceListing | AuctionListing

/** Modes de vente — dérivé de l'union (SSOT), utilisé par ConnectorCapabilities. */
export type SaleMode = UnifiedListing['mode']

// ─── Résultats normalisés (retournés par les connecteurs, jamais levés) ───────

/** Codes d'échec sync — union fermée, SNAKE_CASE (convention erreurs API). */
export enum SyncErrorCode {
  /** Pivot invalide au regard des invariants — rejeté AVANT tout appel réseau. */
  INVALID_PAYLOAD       = 'INVALID_PAYLOAD',
  /** Aucun connecteur enregistré pour la marketplace ciblée. */
  CONNECTOR_UNAVAILABLE = 'CONNECTOR_UNAVAILABLE',
  /** Mode de vente non supporté par la plateforme (cf. ConnectorCapabilities). */
  UNSUPPORTED_MODE      = 'UNSUPPORTED_MODE',
  /** Credentials partenaires absents ou expirés. */
  CREDENTIALS_MISSING   = 'CREDENTIALS_MISSING',
  /** Quota / rate-limit plateforme — retryable. */
  RATE_LIMITED          = 'RATE_LIMITED',
  /** La plateforme a refusé l'annonce (règles métier distantes : catégorie, durée, contenu). */
  REMOTE_REJECTED       = 'REMOTE_REJECTED',
  /** externalId inconnu côté plateforme (update / withdraw / checkStatus). */
  NOT_FOUND             = 'NOT_FOUND',
  /** Erreur réseau ou timeout — retryable. */
  NETWORK_ERROR         = 'NETWORK_ERROR',
  /** Exception échappée d'un connecteur (bug) — normalisée par le moteur, jamais propagée. */
  CONNECTOR_CRASH       = 'CONNECTOR_CRASH',
}

/** État distant normalisé d'une annonce — union fermée. */
export enum RemoteListingStatus {
  ACTIVE    = 'ACTIVE',    // en ligne
  SOLD      = 'SOLD',      // vendue sur la plateforme
  ENDED     = 'ENDED',     // terminée sans vente (expiration, enchère sans adjudication)
  WITHDRAWN = 'WITHDRAWN', // retirée (par le moteur ou côté plateforme)
}

/** Succès d'une opération d'écriture (publish / update / withdraw). */
export interface SyncSuccess {
  ok:         true
  /** Identifiant natif chez la plateforme — à persister, clé de toute opération ultérieure. */
  externalId: string
  /** URL publique de l'annonce quand la plateforme la fournit. */
  url:        string | null
}

/**
 * Échec MÉTIER retourné — contrat : un connecteur ne throw jamais pour un
 * échec métier ; une exception qui s'échappe est un bug (→ CONNECTOR_CRASH).
 */
export interface SyncFailure {
  ok:        false
  code:      SyncErrorCode
  /** Diagnostic brut plateforme — logs uniquement, jamais affiché à l'utilisateur. */
  detail:    string | null
  /** true = re-tentative raisonnable (réseau, rate-limit) ; false = échec définitif. */
  retryable: boolean
}

export type SyncOutcome = SyncSuccess | SyncFailure

/** Photographie d'état distante (checkStatus) — lecture seule. */
export interface RemoteStatusSnapshot {
  ok:           true
  status:       RemoteListingStatus
  /** Prix de vente ou meilleure enchère courante (centimes) — null si sans objet. */
  montantFinal: number | null
}

export type RemoteStatusOutcome = RemoteStatusSnapshot | SyncFailure

// ─── Rapport agrégé (retour de publishMany) ───────────────────────────────────

/** Résultat par plateforme — l'échec de l'une n'affecte jamais les autres. */
export interface MarketplaceSyncResult {
  marketplace: Marketplace
  outcome:     SyncOutcome
}

/** Rapport d'une passe de publication multi-plateformes. */
export interface SyncReport {
  listingId: string
  results:   readonly MarketplaceSyncResult[]
  /** true ssi TOUTES les plateformes ciblées ont réussi. */
  complete:  boolean
}

// ─── Invariants (fonctions pures — mêmes règles que isMandateValid) ───────────

/** Bornes de durée d'enchère acceptées par le pivot (jours). */
export const AUCTION_DURATION_MIN_DAYS = 1
export const AUCTION_DURATION_MAX_DAYS = 30

/** Centimes valides : entier strictement positif — jamais de Float sur de l'argent. */
const isCents = (n: number): boolean => Number.isInteger(n) && n > 0

/**
 * Invariants du pivot — vérifiés par le moteur AVANT tout appel connecteur
 * (sinon échec INVALID_PAYLOAD pour toutes les cibles, zéro appel réseau).
 */
export const isUnifiedListingValid = (l: UnifiedListing): boolean => {
  if (l.titre.trim() === '' || l.description.trim() === '') return false
  if (l.photos.length === 0) return false
  if (l.mode === 'fixed') return isCents(l.prix)
  return (
    isCents(l.prixDepart) &&
    (l.prixReserve === null || (Number.isInteger(l.prixReserve) && l.prixReserve >= l.prixDepart)) &&
    Number.isInteger(l.dureeJours) &&
    l.dureeJours >= AUCTION_DURATION_MIN_DAYS &&
    l.dureeJours <= AUCTION_DURATION_MAX_DAYS
  )
}
