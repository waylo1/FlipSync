import { PaymentSource } from './wallet'

// ─── Enums ────────────────────────────────────────────────────────────────────

export enum ListingTier {
  SIMPLE    = 'SIMPLE',
  OPTIMIZED = 'OPTIMIZED',
  PREMIUM   = 'PREMIUM',
}

/**
 * Machine à états stricte — 11 états.
 * commit() ne s'exécute QU'À la transition USER_VALIDATED.
 * Toute transition avant USER_VALIDATED est gratuite et réversible.
 */
export enum ListingStatus {
  PENDING_AUTH    = 'PENDING_AUTH',    // Vérification droits paiement
  AUTHORIZED      = 'AUTHORIZED',      // Pré-autorisation OK (0 débit)
  AI_PROCESSING   = 'AI_PROCESSING',   // Vision + rédaction SEO
  AI_FAILED       = 'AI_FAILED',       // Échec IA → rollback, 0 débit
  DRAFT_READY     = 'DRAFT_READY',     // Brouillon soumis à l'utilisateur
  USER_VALIDATED  = 'USER_VALIDATED',  // ← DÉCLENCHEUR de commit()
  USER_CANCELLED  = 'USER_CANCELLED',  // Annulation → rollback, 0 débit
  QUEUED          = 'QUEUED',          // En file publication marketplace
  PUBLISH_FAILED  = 'PUBLISH_FAILED',  // Échec marketplace → remboursement
  PUBLISHED       = 'PUBLISHED',       // Annonce live
  EXPIRED         = 'EXPIRED',         // Annonce expirée sans vente
}

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
  etat:            'neuf' | 'tres_bon' | 'bon' | 'correct'
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
