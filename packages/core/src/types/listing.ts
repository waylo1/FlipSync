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

// ─── Différenciation des paliers ───────────────────────────────────────────────

/**
 * Nombre de photos envoyées au modèle vision — SEUL levier de différenciation
 * réel entre paliers aujourd'hui : plus de photos = identification et prix plus
 * fiables. Coût : temps d'encodage/inférence proportionnel (négligeable en prod
 * GPU, notable en dev CPU — cf. CLAUDE.md Sprint 4). Le choix de palier a lieu
 * AVANT la rédaction (écran de capture) : c'est ce nombre qui est envoyé à
 * /ai/draft/start, pas modifiable après coup sans relancer l'analyse.
 */
export const TIER_PHOTO_COUNT: Record<ListingTier, number> = {
  [ListingTier.SIMPLE]:    1,
  [ListingTier.OPTIMIZED]: 2,
  [ListingTier.PREMIUM]:   3,
}

const TIER_ORDER: readonly ListingTier[] = [
  ListingTier.SIMPLE,
  ListingTier.OPTIMIZED,
  ListingTier.PREMIUM,
]

export interface TierFeature {
  label: string
  /** Ce que CE palier ajoute par rapport au précédent — affiché de façon cumulative à l'écran. */
  adds: readonly string[]
}

/** Descriptif produit des paliers — SSOT affichage (capture + validation). */
export const TIER_FEATURES: Record<ListingTier, TierFeature> = {
  [ListingTier.SIMPLE]: {
    label: 'Simple',
    adds: ['Rédaction IA à partir d’1 photo', 'Titre, description et estimation de prix'],
  },
  [ListingTier.OPTIMIZED]: {
    label: 'Optimisée',
    adds: ['Analyse de 2 photos (angles différents)', 'Identification et prix plus fiables'],
  },
  [ListingTier.PREMIUM]: {
    label: 'Premium',
    adds: ['Analyse de 3 photos', 'La meilleure précision possible aujourd’hui'],
  },
}

/** Bullets cumulés du palier SIMPLE jusqu'à `tier` inclus (chaque palier inclut ceux du dessous). */
export function cumulativeTierFeatures(tier: ListingTier): string[] {
  const idx = TIER_ORDER.indexOf(tier)
  return TIER_ORDER.slice(0, idx + 1).flatMap(t => TIER_FEATURES[t].adds)
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
