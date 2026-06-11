import { create } from 'zustand'
import type { ListingDraft } from '@flipsync/core'

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
