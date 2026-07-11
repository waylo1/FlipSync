import { create } from 'zustand'
import {
  ComplexCasePolicy,
  DEFAULT_POSTURE,
  DeliveryPreference,
  POSTURE_PRESETS,
  SellObjective,
  SellPosture,
} from '@flipsync/core'

/**
 * Brouillon de mandat en cours de configuration (S1 « Configurez votre IA » →
 * S2 « Personnaliser » → S3 « Votre mandat »). Volatile (pas de persistance MMKV) :
 * une configuration interrompue se recommence, comme la session de capture.
 * Cf. COMMISSAIRE_PRISEUR_PLAN.md §3-§5.
 *
 * `postureConfirmed` est le canal de retour S1/S2 → validate.tsx : l'écran
 * terminal du flux le passe à true en repartant, validate.tsx le consomme
 * (repasse à false) et enchaîne sur la confirmation de publication. Tant que
 * S3 n'existe pas (Lot 3), c'est le seul pont entre le mandat et le flux de
 * paiement existant.
 */
interface MandateDraftState {
  posture: SellPosture
  objectif: SellObjective
  /** Centimes Int, null tant que non semé depuis prixPlancher (§4.2). */
  prixMini: number | null
  livraison: DeliveryPreference
  casComplexes: ComplexCasePolicy
  autoAdjugeAuDessusDuMini: boolean
  postureConfirmed: boolean
  setPosture: (posture: SellPosture) => void
  setObjectif: (objectif: SellObjective) => void
  setPrixMini: (prixMini: number) => void
  setLivraison: (livraison: DeliveryPreference) => void
  setCasComplexes: (casComplexes: ComplexCasePolicy) => void
  setAutoAdjuge: (autoAdjuge: boolean) => void
  /** Amorce prixMini avec le prix plancher IA — n'écrase jamais une valeur déjà saisie. */
  seedPrixMini: (prixPlancher: number, prixAffiche: number) => void
  confirmPosture: () => void
  consumeConfirmation: () => void
  reset: () => void
}

const INITIAL = {
  posture: DEFAULT_POSTURE,
  objectif: POSTURE_PRESETS[DEFAULT_POSTURE].objectifParDefaut,
  prixMini: null,
  livraison: DeliveryPreference.LES_DEUX,
  casComplexes: ComplexCasePolicy.ME_DEMANDER,
  autoAdjugeAuDessusDuMini: false,
  postureConfirmed: false,
} as const

export const useMandateDraft = create<MandateDraftState>((set, get) => ({
  ...INITIAL,
  setPosture: posture =>
    set({ posture, objectif: POSTURE_PRESETS[posture].objectifParDefaut }),
  setObjectif: objectif => set({ objectif }),
  setPrixMini: prixMini => set({ prixMini }),
  setLivraison: livraison => set({ livraison }),
  setCasComplexes: casComplexes => set({ casComplexes }),
  setAutoAdjuge: autoAdjugeAuDessusDuMini => set({ autoAdjugeAuDessusDuMini }),
  seedPrixMini: (prixPlancher, prixAffiche) => {
    if (get().prixMini !== null) return
    set({ prixMini: Math.min(prixPlancher, prixAffiche) })
  },
  confirmPosture: () => set({ postureConfirmed: true }),
  consumeConfirmation: () => set({ postureConfirmed: false }),
  reset: () => set({ ...INITIAL }),
}))
