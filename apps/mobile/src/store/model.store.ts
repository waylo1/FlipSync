import { create } from 'zustand'
import type { DownloadProgress } from '../services/model-files'

export type ModelStatus =
  | 'checking' //    vérification fichiers locaux
  | 'downloading' // téléchargement GGUF en cours
  | 'loading' //     chargement du modèle en mémoire (initLlama)
  | 'ready' //       inférence disponible
  | 'error'

interface ModelState {
  status: ModelStatus
  /** Progression globale de téléchargement 0..1 (significatif si status=downloading). */
  progress: number
  /** Fichier en cours ('text' | 'mmproj') pour l'affichage. */
  currentFile: DownloadProgress['key'] | null
  errorCode: string | null

  // Mutations — réservées au bootstrap vision.
  setStatus: (status: ModelStatus) => void
  setProgress: (p: DownloadProgress) => void
  setError: (code: string) => void
  reset: () => void
}

export const useModelStore = create<ModelState>(set => ({
  status: 'checking',
  progress: 0,
  currentFile: null,
  errorCode: null,

  setStatus: status => set({ status, errorCode: null }),
  setProgress: p =>
    set({ status: 'downloading', progress: p.overallRatio, currentFile: p.key }),
  setError: code => set({ status: 'error', errorCode: code }),
  reset: () => set({ status: 'checking', progress: 0, currentFile: null, errorCode: null }),
}))
