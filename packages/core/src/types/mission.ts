import { MissionStatus } from '../generated/enums'

// ─── Commissaire-Priseur IA — SSOT du mandat de vente (palier Premium) ─────────
// Réflexion et décisions : COMMISSAIRE_PRISEUR_PLAN.md (racine).
// Ce fichier ne contient QUE des données et des fonctions pures : les préréglages
// des postures, la forme du mandat, et les dérivations d'affichage. Aucune logique
// de négociation ici (elle vivra côté serveur au Lot 4, cf. NegotiationChannel).

export { MissionStatus }

// ─── Postures (écran « Configurez votre IA », S1) ─────────────────────────────
// Une posture = un préréglage nommé sur deux cadrans internes (invisibles pour
// l'utilisateur — il ne voit que les 4 noms). Ces cadrans piloteront la stratégie
// de négociation serveur au Lot 4.

export enum SellPosture {
  RAPIDE       = 'RAPIDE',
  EQUILIBRE    = 'EQUILIBRE',
  MEILLEUR_PRIX = 'MEILLEUR_PRIX',
  PRUDENT      = 'PRUDENT',
}

/** Cadran A — combien l'IA lâche entre prix affiché et prix mini. */
export type ConcessionLevel = 'faible' | 'moyenne' | 'forte'
/** Cadran B — combien l'IA ose trancher seule vs référer au vendeur. */
export type AutonomyLevel = 'basse' | 'moyenne' | 'haute'

/** Objectif exprimé à l'assistant « Personnaliser » (§4.1) — première ligne du mandat. */
export enum SellObjective {
  VENDRE_VITE   = 'VENDRE_VITE',
  EQUILIBRE     = 'EQUILIBRE',
  MEILLEUR_PRIX = 'MEILLEUR_PRIX',
}

export interface PosturePreset {
  /** Nom affiché sur la carte S1. */
  label: string
  emoji: string
  /** Promesse en une ligne — le message principal de la carte. */
  promesse: string
  /** Ligne de soutien discrète — jamais une liste de réglages. */
  support: string
  concession: ConcessionLevel
  autonomie: AutonomyLevel
  /** Objectif pré-rempli à l'assistant quand cette posture est choisie. */
  objectifParDefaut: SellObjective
}

/**
 * SSOT des 4 postures — alimente l'écran S1 et les valeurs par défaut de
 * l'assistant. Ne jamais dupliquer ces libellés ailleurs.
 */
export const POSTURE_PRESETS: Record<SellPosture, PosturePreset> = {
  [SellPosture.RAPIDE]: {
    label: 'Vente rapide',
    emoji: '⚡',
    promesse: 'Vendu vite, sans prise de tête.',
    support: 'L’IA conclut au plus vite, dans vos limites.',
    concession: 'forte',
    autonomie: 'haute',
    objectifParDefaut: SellObjective.VENDRE_VITE,
  },
  [SellPosture.EQUILIBRE]: {
    label: 'Équilibré',
    emoji: '⚖️',
    promesse: 'Le bon compromis prix / rapidité.',
    support: 'L’IA négocie sans brader.',
    concession: 'moyenne',
    autonomie: 'moyenne',
    objectifParDefaut: SellObjective.EQUILIBRE,
  },
  [SellPosture.MEILLEUR_PRIX]: {
    label: 'Meilleur prix',
    emoji: '💎',
    promesse: 'On vise le meilleur prix, patiemment.',
    support: 'L’IA tient le prix et concède peu.',
    concession: 'faible',
    autonomie: 'moyenne',
    objectifParDefaut: SellObjective.MEILLEUR_PRIX,
  },
  [SellPosture.PRUDENT]: {
    label: 'Très prudent',
    emoji: '🛡️',
    promesse: 'Zéro risque, vous validez plus souvent.',
    support: 'L’IA filtre fort et vous réfère les cas ambigus.',
    concession: 'faible',
    autonomie: 'basse',
    objectifParDefaut: SellObjective.EQUILIBRE,
  },
}

/** Ordre d'affichage des postures sur l'écran S1 (montée en autonomie / prix). */
export const POSTURE_ORDER: readonly SellPosture[] = [
  SellPosture.RAPIDE,
  SellPosture.EQUILIBRE,
  SellPosture.MEILLEUR_PRIX,
  SellPosture.PRUDENT,
]

/** Posture proposée par défaut à l'ouverture de S1. */
export const DEFAULT_POSTURE: SellPosture = SellPosture.EQUILIBRE

// ─── Préférences de livraison & cas complexes (assistant, §4.3–4.4) ───────────

export enum DeliveryPreference {
  MAIN_PROPRE = 'MAIN_PROPRE',
  ENVOI       = 'ENVOI',
  LES_DEUX    = 'LES_DEUX',
}

/** Que faire quand un cas dépasse les règles du mandat (§4.4). */
export enum ComplexCasePolicy {
  ME_DEMANDER = 'ME_DEMANDER', // → EN_ATTENTE_VALIDATION (le plus sûr, défaut)
  REFUSER     = 'REFUSER',     // l'IA décline poliment et clôt
  CONTINUER   = 'CONTINUER',   // maintient le contact, résume, n'engage pas
}

// ─── Le mandat (produit de S1→S3, SSOT de la stratégie IA) ────────────────────

/**
 * Mandat de vente confié au commissaire-priseur IA. Tous les montants en
 * centimes (Int) — jamais de Float sur de l'argent.
 * Invariant : 0 < prixMini <= prixAffiche.
 */
export interface SellMandate {
  posture: SellPosture
  objectif: SellObjective
  prixAffiche: number // centimes — prix public de l'annonce
  prixMini: number    // centimes — plancher absolu, jamais franchi (R1)
  livraison: DeliveryPreference
  casComplexes: ComplexCasePolicy
  /**
   * Coup de marteau (§2.3 / R4). false par défaut : l'IA délègue la corvée mais
   * l'humain valide la vente finale. true = délégation totale — l'IA adjuge seule
   * dès qu'une offre respecte le prix mini.
   */
  autoAdjugeAuDessusDuMini: boolean
}

// ─── Dérivations d'affichage (fonctions pures — SSOT des libellés calculés) ────

/**
 * Marge de négociation dérivée, en pourcentage entier négatif affiché sous le
 * champ prix (§4.2) et sur le mandat (§5.3). Ex. affiché 820, mini 780 → -5.
 * Ne saisit jamais ce %, on l'affiche : le prix mini est l'unique source.
 */
export const negotiationMarginPct = (
  prixAffiche: number,
  prixMini: number,
): number => {
  if (prixAffiche <= 0) return 0
  return Math.round(((prixMini - prixAffiche) / prixAffiche) * 100)
}

/** Un mandat est cohérent si le plancher est strictement positif et ≤ prix affiché. */
export const isMandateValid = (m: SellMandate): boolean =>
  m.prixMini > 0 && m.prixMini <= m.prixAffiche

/**
 * Mandat par défaut proposé à l'ouverture du flux (S1→S3), avant toute
 * personnalisation. prixMini est pré-rempli avec le prix plancher estimé par
 * l'IA (ListingDraft.prixPlancher) ; les autres champs prennent les défauts
 * les plus sûrs (§5.2).
 */
export const defaultMandate = (
  prixAffiche: number,
  prixPlancher: number,
  posture: SellPosture = DEFAULT_POSTURE,
): SellMandate => ({
  posture,
  objectif: POSTURE_PRESETS[posture].objectifParDefaut,
  prixAffiche,
  prixMini: Math.min(prixPlancher, prixAffiche),
  livraison: DeliveryPreference.LES_DEUX,
  casComplexes: ComplexCasePolicy.ME_DEMANDER,
  autoAdjugeAuDessusDuMini: false,
})
