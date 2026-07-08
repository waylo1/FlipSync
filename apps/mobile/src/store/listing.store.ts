import { create } from 'zustand'
import { MMKV } from 'react-native-mmkv'
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator'
import { ListingStatus } from '@flipsync/core'
import type { ListingDraft, ListingTier } from '@flipsync/core'
import { ApiError, api } from '../services/api'

/**
 * États "vivants" post-validation où le contenu reste modifiable/annulable
 * (miroir d'EDITABLE_STATUSES / LISTING_TRANSITIONS côté serveur — cf.
 * packages/ai/src/listing-engine.ts). Annuler depuis QUEUED rembourse
 * intégralement ; PUBLISHED n'est éditable que sur le contenu, pas annulable
 * (retirer une annonce déjà en ligne est un cas serveur distinct, hors scope).
 */
export const LISTING_EDITABLE_STATUSES: readonly ListingStatus[] = [
  ListingStatus.USER_VALIDATED,
  ListingStatus.QUEUED,
  ListingStatus.PUBLISHED,
]

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

// ─── File d'analyses en tâche de fond (« enchaîner ») ────────────────────────

/**
 * Largeur envoyée au modèle vision serveur — mirror de vendre.tsx : 512 px
 * divise par ~2,3 le coût d'encodage image sans dégrader la compréhension.
 */
const ANALYZE_WIDTH = 512

export type AnalysisJobStatus = 'running' | 'ready' | 'failed'

/**
 * Une rédaction IA lancée en fond. Détachée de l'écran de capture : l'utilisateur
 * peut « enchaîner » (photographier l'objet suivant) pendant qu'elle tourne.
 */
export interface AnalysisJob {
  id: string
  status: AnalysisJobStatus
  photos: SessionPhoto[]
  /** Aperçu (1ʳᵉ photo) affiché sur la carte de la file. */
  coverUri: string
  /** Rempli quand `ready` — brouillon prêt à valider. */
  draft: ListingDraft | null
  /** Rempli quand `failed` — code d'erreur API (mappé en message à l'écran). */
  errorCode: string | null
}

interface AnalysisQueueState {
  jobs: AnalysisJob[]
  /** Lance une rédaction en fond ; retourne l'id du job créé. */
  enqueue: (photos: SessionPhoto[]) => string
  /** Relance un job échoué avec les mêmes photos. */
  retry: (id: string) => void
  remove: (id: string) => void
}

let jobSeq = 0

/**
 * Volatile (pas de persistance MMKV) : une rédaction en cours ne survit pas à
 * un kill de l'app — elle est gratuite avant validation, on la relance. Les
 * brouillons `ready` non validés restent visibles tant que l'app vit ; l'écran
 * /processing sert de tableau de bord de la file.
 */
export const useAnalysisQueue = create<AnalysisQueueState>((set, get) => {
  /** Encode la 1ʳᵉ photo en 512 px puis appelle /ai/draft ; met à jour le job. */
  async function run(id: string, photos: SessionPhoto[]): Promise<void> {
    const primary = photos[0]
    if (!primary) {
      set(s => ({ jobs: s.jobs.map(j => (j.id === id ? { ...j, status: 'failed', errorCode: 'NO_PHOTO' } : j)) }))
      return
    }
    try {
      const forModel = await manipulateAsync(
        primary.uri,
        [{ resize: { width: ANALYZE_WIDTH } }],
        { compress: 0.7, format: SaveFormat.JPEG, base64: true },
      )
      const { draft } = await api.analyzeDraft([forModel.base64 ?? primary.base64])
      set(s => ({
        jobs: s.jobs.map(j => (j.id === id ? { ...j, status: 'ready', draft, errorCode: null } : j)),
      }))
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN'
      set(s => ({ jobs: s.jobs.map(j => (j.id === id ? { ...j, status: 'failed', errorCode: code } : j)) }))
    }
  }

  return {
    jobs: [],
    enqueue: photos => {
      jobSeq += 1
      const id = `job_${Date.now()}_${jobSeq}`
      const job: AnalysisJob = {
        id,
        status: 'running',
        photos,
        coverUri: photos[0]?.uri ?? '',
        draft: null,
        errorCode: null,
      }
      set(s => ({ jobs: [job, ...s.jobs] }))
      void run(id, photos)
      return id
    },
    retry: id => {
      const job = get().jobs.find(j => j.id === id)
      if (!job) return
      set(s => ({ jobs: s.jobs.map(j => (j.id === id ? { ...j, status: 'running', errorCode: null } : j)) }))
      void run(id, job.photos)
    },
    remove: id => set(s => ({ jobs: s.jobs.filter(j => j.id !== id) })),
  }
})

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
