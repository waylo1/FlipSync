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
  [ListingTier.SIMPLE]:   99,   // 0,99 € — l'IA rédige votre annonce
  [ListingTier.PREMIUM]: 299,   // 2,99 € — mandat commissaire-priseur (v2)
}

// ─── Différenciation des paliers ───────────────────────────────────────────────
// Deux offres seulement (fusion Essentiel/Optimisé, 2026-07-17) : elles
// délivraient le même brouillon IA. Reste l'offre de base (l'IA rédige) et
// Premium (mandat commissaire-priseur — négociation, v2). Toutes les offres
// capturent autant de photos que l'utilisateur le souhaite.

export interface TierOffer {
  label: string
  /** Phrase d'autonomie — le message principal de la carte, une seule ligne. */
  tagline: string
  /** Ligne de soutien discrète — jamais une liste de fonctionnalités. */
  support: string
}

/**
 * Premium hors-vente tant que la négociation réelle n'est pas branchée —
 * règle actée (COMMISSAIRE_PRISEUR_PLAN.md §1 et §10.0) : « ne jamais encaisser
 * un paiement Premium réel tant que la négociation réelle n'est pas branchée ».
 * Le mandat (S1) existe, mais S2/S3 (messagerie acheteur, négociation) sont des
 * stubs : encaisser 2,99 € pour « L'IA vend pour moi » serait un mensonge.
 * SSOT api (garde POST /listing) + mobile (sélecteur d'offres).
 */
export const PREMIUM_TIER_ENABLED = false

/** Descriptif produit des offres — SSOT affichage (écran de validation). */
export const TIER_FEATURES: Record<ListingTier, TierOffer> = {
  [ListingTier.SIMPLE]: {
    label: 'Annonce IA',
    tagline: 'L’IA rédige votre annonce.',
    support: 'Titre, description et prix estimé en quelques secondes.',
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
 * Vérité-objet additive (C2, ADAPTER-CONTRACT §1/§2) — propriété physique de l'objet,
 * jamais un format de canal. Débloque le precheck poids/format d'un futur connecteur.
 */
export interface Expedition {
  formatColis:   'S' | 'M' | 'L' | 'XL'
  poidsEstimeG?: number
}

/**
 * Brouillon généré par l'IA.
 * confidence est un score 0–1 (Float intentionnel, pas de l'argent).
 * Prix en centimes (Int).
 */
export interface ListingDraft {
  titre:           string
  description:     string
  categorieId:     string // CanonicalCategoryId (référentiel versionné, ADR-010)
  etat:            ItemCondition
  prixPlancher:    number         // centimes
  prixHaut:        number         // centimes
  marque:          string | null
  confidence:      number         // 0–1, Float intentionnel (score, pas argent)
  ean?:            string | null  // vérité-objet (C2), optionnel — sans producteur pour l'instant
  expedition?:     Expedition | null // vérité-objet (C2), optionnel — sans producteur pour l'instant
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
