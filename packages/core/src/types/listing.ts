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
  [ListingTier.SIMPLE]:     80,   // 0,80 €
  [ListingTier.OPTIMIZED]: 250,   // 2,50 €
  [ListingTier.PREMIUM]:   300,   // 3,00 €
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
  requiresAutoRecharge: boolean
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
