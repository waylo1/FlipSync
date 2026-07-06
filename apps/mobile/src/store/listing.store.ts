import { create } from 'zustand'
import { MMKV } from 'react-native-mmkv'
import type { ListingDraft, ListingTier } from '@flipsync/core'

export interface SessionPhoto {
  uri: string
  base64: string
  sha256: string // intégrité (rules.md)
}

interface ListingSessionState {
  /** Brouillon issu de l'inférence on-device — base de l'écran de validation. */
  draft: ListingDraft | null
  photos: SessionPhoto[]
  setSession: (draft: ListingDraft, photos: SessionPhoto[]) => void
  clearSession: () => void
}

/**
 * Session de création en cours : porte le draft + photos entre l'écran de
 * capture et l'écran de validation. Volatile (pas de persistance) : une
 * session interrompue se recommence — l'inférence est gratuite et locale.
 */
export const useListingSession = create<ListingSessionState>(set => ({
  draft: null,
  photos: [],
  setSession: (draft, photos) => set({ draft, photos }),
  clearSession: () => set({ draft: null, photos: [] }),
}))

// ─── Publication interrompue — persistée MMKV ─────────────────────────────────

/** Dernière étape FRANCHIE de la séquence create → photos → ai-start → draft → validate. */
export type PublishStep = 'created' | 'photos' | 'ai' | 'draft'

export const PUBLISH_STEP_RANK: Readonly<Record<PublishStep, number>> = {
  created: 0,
  photos: 1,
  ai: 2,
  draft: 3,
}

export interface PendingPublish {
  listingId: string
  /** Formule verrouillée : le coût est figé à la création côté serveur. */
  tier: ListingTier
  /** Brouillon au moment du dernier essai — seed des champs en reprise. */
  draft: ListingDraft
  /** Prix saisi (centimes Int) au moment du dernier essai. */
  prixPublie: number | null
  done: PublishStep
}

interface PendingPublishState {
  pending: PendingPublish | null
  setPending: (p: PendingPublish) => void
  clearPending: () => void
}

const storage = new MMKV({ id: 'flipsync-session' })
const PENDING_KEY = 'pending-publish'

function readPending(): PendingPublish | null {
  const raw = storage.getString(PENDING_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as PendingPublish
  } catch {
    storage.delete(PENDING_KEY)
    return null
  }
}

/**
 * Séquence de publication interrompue (coupure réseau / crash au milieu de
 * create → … → validate). Persistée MMKV : au retour dans l'app, l'écran
 * « Mes annonces » propose Reprendre (validate.tsx repart de l'étape suivante)
 * ou Abandonner (POST /cancel — gratuit, aucune transition n'a débité).
 * Effacée UNIQUEMENT après validate réussi (commit) ou abandon explicite.
 */
export const usePendingPublish = create<PendingPublishState>(set => ({
  pending: readPending(),
  setPending: p => {
    storage.set(PENDING_KEY, JSON.stringify(p))
    set({ pending: p })
  },
  clearPending: () => {
    storage.delete(PENDING_KEY)
    set({ pending: null })
  },
}))
