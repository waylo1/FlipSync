import { create } from 'zustand'
import { DEFAULT_POSTURE, SellPosture } from '@flipsync/core'

/**
 * Brouillon de mandat en cours de configuration (S1 « Configurez votre IA » →
 * S2 « Personnaliser » → S3 « Votre mandat »). Volatile (pas de persistance MMKV) :
 * une configuration interrompue se recommence, comme la session de capture.
 * Cf. COMMISSAIRE_PRISEUR_PLAN.md §3-§5.
 *
 * `postureConfirmed` est le canal de retour S1 → validate.tsx : S1 le passe à
 * true en repartant, validate.tsx le consomme (repasse à false) et enchaîne sur
 * la confirmation de publication. Tant que S2/S3 n'existent pas (Lots 2-3), c'est
 * le seul pont entre l'écran de posture et le flux de paiement existant.
 */
interface MandateDraftState {
  posture: SellPosture
  postureConfirmed: boolean
  setPosture: (posture: SellPosture) => void
  confirmPosture: () => void
  consumeConfirmation: () => void
  reset: () => void
}

export const useMandateDraft = create<MandateDraftState>(set => ({
  posture: DEFAULT_POSTURE,
  postureConfirmed: false,
  setPosture: posture => set({ posture }),
  confirmPosture: () => set({ postureConfirmed: true }),
  consumeConfirmation: () => set({ postureConfirmed: false }),
  reset: () => set({ posture: DEFAULT_POSTURE, postureConfirmed: false }),
}))
