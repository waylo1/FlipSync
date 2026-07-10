import { create } from 'zustand'
import { MMKV } from 'react-native-mmkv'
import { SaveFormat, manipulateAsync } from 'expo-image-manipulator'
import { ListingStatus, ListingTier } from '@flipsync/core'
import type { ListingDraft } from '@flipsync/core'
import { ApiError, api } from '../services/api'

const storage = new MMKV({ id: 'flipsync-session' })

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
  /** Brouillon issu de l'inférence serveur — base de l'écran de validation. */
  draft: ListingDraft | null
  photos: SessionPhoto[]
  setSession: (draft: ListingDraft, photos: SessionPhoto[]) => void
  clearSession: () => void
}

/**
 * Session de création en cours : porte le draft + photos entre l'écran de
 * capture et l'écran de validation. Volatile (pas de persistance) : une
 * session interrompue se recommence — l'inférence est gratuite et locale.
 * L'offre (tier) n'est plus choisie à la capture : elle se choisit à l'écran
 * de validation, juste avant le paiement (cf. validate.tsx).
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

/** Borne le coût d'inférence — indépendant de l'offre choisie par l'utilisateur. */
const AI_PHOTO_CAP = 3

/** Cadence du poll pendant qu'un job tourne côté serveur. */
const POLL_INTERVAL_MS = 3_000

export type AnalysisJobStatus = 'running' | 'ready' | 'failed'

/**
 * Une rédaction IA — le TRAVAIL tourne côté SERVEUR (job détaché, cf. api.ts),
 * détachée de l'écran de capture : l'utilisateur peut « enchaîner »
 * (photographier l'objet suivant) pendant qu'elle tourne, et même quitter/tuer
 * l'app : au retour, le poll reprend et retrouve le job déjà avancé/terminé.
 */
export interface AnalysisJob {
  /** jobId serveur — clé de poll (/ai/draft/:jobId). */
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
  /** Lance une rédaction en fond (job serveur détaché). */
  enqueue: (photos: SessionPhoto[]) => void
  /** Relance un job échoué avec les mêmes photos (nouveau job serveur). */
  retry: (id: string) => void
  remove: (id: string) => void
}

const JOBS_KEY = 'analysis-jobs'

function readJobs(): AnalysisJob[] {
  const raw = storage.getString(JOBS_KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as AnalysisJob[]
  } catch {
    storage.delete(JOBS_KEY)
    return []
  }
}

function persistJobs(jobs: AnalysisJob[]): void {
  storage.set(JOBS_KEY, JSON.stringify(jobs))
}

/**
 * Persistée MMKV : un job « running » survit à un kill de l'app (OEM agressifs
 * type MIUI/Xiaomi qui tuent l'app en arrière-plan pendant les 70-90 s
 * d'inférence CPU dev). Le TRAVAIL vit côté serveur (cf. apps/api/src/routes/ai.ts) ;
 * à l'initialisation du store (relancement de l'app), chaque job encore
 * `running` reprend son poll — le brouillon peut déjà être prêt côté serveur.
 */
export const useAnalysisQueue = create<AnalysisQueueState>((set, get) => {
  function updateJob(id: string, patch: Partial<AnalysisJob>): void {
    set(s => {
      const jobs = s.jobs.map(j => (j.id === id ? { ...j, ...patch } : j))
      persistJobs(jobs)
      return { jobs }
    })
  }

  /** Interroge le job jusqu'à ready/failed. S'arrête silencieusement si le job a été retiré. */
  function poll(jobId: string): void {
    const tick = () => {
      // Le job a pu être retiré (remove) pendant qu'on attendait la réponse.
      if (!get().jobs.some(j => j.id === jobId)) return

      api
        .getDraftJob(jobId)
        .then(res => {
          if (!get().jobs.some(j => j.id === jobId)) return
          if (res.status === 'running') {
            setTimeout(tick, POLL_INTERVAL_MS)
            return
          }
          updateJob(jobId, { status: res.status, draft: res.draft, errorCode: res.error })
        })
        .catch((err: unknown) => {
          // JOB_NOT_FOUND = le serveur a perdu le job (redémarrage, TTL 15 min
          // dépassé) → échec définitif, l'utilisateur doit relancer.
          // Toute autre erreur (réseau ponctuel, coupure Tailscale) : on
          // continue de réessayer, ce n'est pas un échec du job lui-même.
          const code = err instanceof ApiError ? err.code : 'UNKNOWN'
          if (code === 'JOB_NOT_FOUND') {
            updateJob(jobId, { status: 'failed', errorCode: code })
            return
          }
          setTimeout(tick, POLL_INTERVAL_MS)
        })
    }
    tick()
  }

  /**
   * Encode en 512 px les AI_PHOTO_CAP premières photos, démarre le job
   * serveur, puis poll. Le cap borne le coût d'inférence ; il est indépendant
   * de l'offre choisie (les paliers ne différencient plus les photos).
   */
  async function start(job: AnalysisJob, photos: SessionPhoto[]): Promise<void> {
    if (photos.length === 0) {
      updateJob(job.id, { status: 'failed', errorCode: 'NO_PHOTO' })
      return
    }
    try {
      const selected = photos.slice(0, AI_PHOTO_CAP)
      const encoded = await Promise.all(
        selected.map(async photo => {
          const forModel = await manipulateAsync(
            photo.uri,
            [{ resize: { width: ANALYZE_WIDTH } }],
            { compress: 0.7, format: SaveFormat.JPEG, base64: true },
          )
          return forModel.base64 ?? photo.base64
        }),
      )
      const { jobId } = await api.startDraftJob(encoded)
      // Le job local gardait un id temporaire (créé avant de connaître le
      // jobId serveur) — on le remplace par le vrai id, seule clé de poll valide.
      set(s => {
        const jobs = s.jobs.map(j => (j.id === job.id ? { ...j, id: jobId } : j))
        persistJobs(jobs)
        return { jobs }
      })
      poll(jobId)
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'UNKNOWN'
      updateJob(job.id, { status: 'failed', errorCode: code })
    }
  }

  // Reprise au (re)lancement du store : tout job encore « running » à la
  // dernière persistance reprend son poll (l'app a pu être tuée entre-temps).
  // Différé (setTimeout 0) car `get()` n'est pas utilisable tant que
  // l'initializer n'a pas fini de retourner l'état initial du store.
  const initialJobs = readJobs()
  for (const job of initialJobs) {
    if (job.status === 'running') setTimeout(() => poll(job.id), 0)
  }

  return {
    jobs: initialJobs,
    enqueue: photos => {
      // id temporaire — remplacé par le jobId serveur dès que `start` le reçoit.
      const tempId = `pending_${photos[0]?.sha256 ?? Math.random().toString(36)}`
      const job: AnalysisJob = {
        id: tempId,
        status: 'running',
        photos,
        coverUri: photos[0]?.uri ?? '',
        draft: null,
        errorCode: null,
      }
      set(s => {
        const jobs = [job, ...s.jobs]
        persistJobs(jobs)
        return { jobs }
      })
      void start(job, photos)
    },
    retry: id => {
      const job = get().jobs.find(j => j.id === id)
      if (!job) return
      updateJob(id, { status: 'running', errorCode: null })
      void start(job, job.photos)
    },
    remove: id =>
      set(s => {
        const jobs = s.jobs.filter(j => j.id !== id)
        persistJobs(jobs)
        return { jobs }
      }),
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
