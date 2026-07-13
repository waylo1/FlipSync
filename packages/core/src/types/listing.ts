import { PaymentSource } from './wallet'
import { ItemCondition, ListingStatus, ListingTier } from '../generated/enums'

// ─── Enums (GÉNÉRÉS depuis schema.prisma — cf. src/generated/enums.ts) ────────
// Machine à états stricte — 11 états. commit() ne s'exécute QU'À la transition
// USER_VALIDATED ; toute transition antérieure est gratuite et réversible.

export { ItemCondition, ListingStatus, ListingTier }

// ─── Tarification ─────────────────────────────────────────────────────────────

/**
 * Prix en centimes (Int).
 * Source de vérité unique — ne jamais hardcoder les prix ailleurs.
 */
export const TIER_PRICING: Record<ListingTier, number> = {
  [ListingTier.SIMPLE]:     99,   // 0,99 €
  [ListingTier.OPTIMIZED]: 199,   // 1,99 €
  [ListingTier.PREMIUM]:   299,   // 2,99 €
}

// ─── Différenciation des paliers ───────────────────────────────────────────────
// Le nombre de photos ne différencie plus les paliers (toutes les offres
// capturent autant de photos que l'utilisateur le souhaite). La différence
// entre offres est désormais uniquement le niveau d'assistance IA — cf.
// TIER_FEATURES ci-dessous.

export interface TierOffer {
  label: string
  /** Phrase d'autonomie — le message principal de la carte, une seule ligne. */
  tagline: string
  /** Ligne de soutien discrète — jamais une liste de fonctionnalités. */
  support: string
}

/** Descriptif produit des offres — SSOT affichage (écran de validation). */
export const TIER_FEATURES: Record<ListingTier, TierOffer> = {
  [ListingTier.SIMPLE]: {
    label: 'Essentiel',
    tagline: 'Je publie.',
    support: 'Vous menez votre vente.',
  },
  [ListingTier.OPTIMIZED]: {
    label: 'Optimisé',
    tagline: 'L’IA m’aide.',
    support: 'Elle rédige votre annonce avec vous.',
  },
  [ListingTier.PREMIUM]: {
    label: 'Premium',
    tagline: 'L’IA vend pour moi.',
    support: 'Elle gère la vente à votre place.',
  },
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Résultat de authorize() — snapshot immuable de l'état financier.
 * Toutes les valeurs monétaires en centimes (Int).
 */
export interface ListingAuthResult {
  authorized:           boolean
  source:               PaymentSource
  cost:                 number   // centimes — 0 si FREE_CREDIT
  freeCreditsRemaining: number
  walletBalanceBefore:  number   // centimes
  walletBalanceAfter:   number   // centimes
  deficit?:             number   // centimes — présent uniquement si BLOCKED
}

/**
 * Brouillon généré par l'IA.
 * confidence est un score 0–1 (Float intentionnel, pas de l'argent).
 * Prix en centimes (Int).
 */
export interface ListingDraft {
  titre:           string
  description:     string
  categorieLbc:    string
  categorieVinted: string
  etat:            ItemCondition
  prixPlancher:    number         // centimes
  prixHaut:        number         // centimes
  marque:          string | null
  confidence:      number         // 0–1, Float intentionnel (score, pas argent)
}

/**
 * Contexte complet d'un listing tout au long de son cycle de vie.
 */
export interface ListingContext {
  listingId: string
  userId:    string
  tier:      ListingTier
  auth:      ListingAuthResult
  draft?:    ListingDraft
  status:    ListingStatus
  createdAt: Date
}

// ─── Contrat GET /listing, GET /listing/:id — SSOT api ↔ mobile ────────────────
// Dates en ISO string (forme JSON réelle) — jamais Date. Sous-ensemble du
// modèle Listing effectivement utilisé côté mobile (fix F7, FLIPSYNC-AUDIT.md :
// remplace ApiListing/ApiListingPhoto recopiés à la main dans apps/mobile).

export interface ListingPhotoDTO {
  id:    string
  url:   string
  order: number
}

export interface ListingDTO {
  id:              string
  status:          ListingStatus
  tier:            ListingTier
  paymentSource:   PaymentSource
  cost:            number             // centimes
  titre:           string | null
  description:     string | null
  marque:          string | null
  etat:            ItemCondition | null
  prixPlancher:    number | null      // centimes
  prixHaut:        number | null      // centimes
  prixPublie:      number | null      // centimes
  isPriceFlagged:  boolean
  failureReason:   string | null
  publishedLbc:    boolean
  publishedVinted: boolean
  photos:          ListingPhotoDTO[]
  createdAt:       string             // ISO
  updatedAt:       string             // ISO
}

// ─── Guard diplomatie ─────────────────────────────────────────────────────────

/**
 * Retourne true si le prix utilisateur dépasse de 20% le plafond IA.
 * Règle : isPriceFlagged = prixPublie > prixHaut * 1.2
 * Calcul en centimes entiers — pas de Float.
 */
export const isPriceFlagged = (
  prixPublie: number,
  prixHaut:   number,
): boolean => prixPublie > Math.round(prixHaut * 1.2)
