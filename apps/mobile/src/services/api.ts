/**
 * Client HTTP → API Fastify.
 * Toutes les valeurs monétaires transitent en CENTIMES (Int) — la conversion €
 * est strictement réservée à l'affichage (centsToEur).
 */
import type {
  ItemCondition,
  ListingAuthResult,
  ListingDraft,
  ListingStatus,
  ListingTier,
  TransactionType,
} from '@flipsync/core'
import { useAuthStore } from '../store/auth.store'

// 10.0.2.2 = localhost de la machine hôte vu depuis l'émulateur Android.
export const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3001'

/**
 * Délai maximal d'une requête — au-delà : ApiError('TIMEOUT'). Suffisant pour
 * TOUS les appels désormais : la rédaction IA (start + poll) ne bloque plus
 * jamais une requête HTTP au-delà de quelques secondes (job détaché serveur).
 */
const REQUEST_TIMEOUT_MS = 10_000

/** Erreur API — code SNAKE_CASE renvoyé par le backend ({ error: code }). */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
    this.name = 'ApiError'
  }
}

/**
 * fetch borné dans le temps + erreurs réseau normalisées :
 * délai dépassé → TIMEOUT ; serveur injoignable → NETWORK_ERROR (status 0).
 * Aucun appel réseau de l'app ne passe ailleurs que par ici.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch {
    throw new ApiError(controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', 0)
  } finally {
    clearTimeout(timer)
  }
}

/** Photo telle que renvoyée par GET /listing (sans sha256). */
export interface ApiListingPhoto {
  id: string
  url: string // chemin relatif /uploads/... — préfixer par API_BASE pour l'affichage
  order: number
}

/** Sous-ensemble du modèle Listing utilisé par le mobile (réponse GET /listing). */
export interface ApiListing {
  id: string
  status: ListingStatus
  tier: ListingTier
  paymentSource: string
  cost: number // centimes
  titre: string | null
  description: string | null
  marque: string | null
  etat: ItemCondition | null
  prixPlancher: number | null // centimes
  prixHaut: number | null // centimes
  prixPublie: number | null // centimes
  isPriceFlagged: boolean
  failureReason: string | null
  publishedLbc: boolean
  publishedVinted: boolean
  photos: ApiListingPhoto[]
  createdAt: string
  updatedAt: string
}

/** Mouvement wallet (réponse GET /wallet/transactions, 50 derniers). */
export interface ApiTransaction {
  id: string
  type: TransactionType
  amount: number // centimes
  source: string
  listingId: string | null
  description: string | null
  createdAt: string
}

export interface ApiPhoto {
  id: string
  url: string
  order: number
  sha256: string
}

/** Champs éditables après validation — jamais photos, tier, ou statut. */
export interface EditListingPatch {
  titre?: string
  description?: string
  marque?: string | null
  etat?: ItemCondition
  prixPublie?: number // centimes
}

export interface UploadPhoto {
  base64: string
  /** sha256 de la CHAÎNE base64 — convention partagée avec l'API (HASH_MISMATCH sinon). */
  sha256: string
  order: number
}

export interface ApiWallet {
  balance: number // centimes
  freeListingsRemaining: number
  freeListingsResetAt: string
  autoRechargeEnabled: boolean
  autoRechargeThreshold: number // centimes
  autoRechargeAmount: number // centimes
  lifetimeRecharged: number // centimes
}

async function request<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  const token = useAuthStore.getState().token
  if (!token) throw new ApiError('NO_AUTH_TOKEN', 401)

  const res = await fetchWithTimeout(
    `${API_BASE}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...init?.headers,
      },
    },
    timeoutMs,
  )

  if (!res.ok) {
    let code = 'INTERNAL_ERROR'
    try {
      const body = (await res.json()) as { error?: unknown }
      if (typeof body.error === 'string') code = body.error
    } catch {
      // corps non-JSON — on garde INTERNAL_ERROR
    }
    // Session invalide/expirée : purge du token → la garde (tabs) renvoie au
    // login (magic link) automatiquement. Aucun écran ne reste bloqué en erreur.
    if (res.status === 401) {
      useAuthStore.getState().setToken(null)
    }
    throw new ApiError(code, res.status)
  }

  return (await res.json()) as T
}

const post = <T>(path: string, body?: unknown, timeoutMs?: number): Promise<T> =>
  request<T>(
    path,
    // '{}' et non undefined : on envoie toujours content-type application/json,
    // et Fastify rejette (400) un corps vide sous ce content-type.
    { method: 'POST', body: JSON.stringify(body ?? {}) },
    timeoutMs,
  )

/**
 * Login dev — route non authentifiée, absente en production.
 * Retourne le JWT à stocker via useAuthStore.setToken.
 */
/** Appel public (sans JWT) avec normalisation d'erreur ApiError. */
async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: unknown }
    throw new ApiError(typeof errBody.error === 'string' ? errBody.error : 'INTERNAL_ERROR', res.status)
  }
  return (await res.json()) as T
}

/**
 * Magic link — production. Réponse uniforme (anti-énumération) : `sent: true`
 * que l'email existe ou non. En dev, l'API renvoie aussi `devLink` (le lien
 * normalement envoyé par email) pour tester sans boîte mail.
 */
export function requestMagicLink(email: string): Promise<{ sent: boolean; devLink?: string }> {
  return publicPost('/auth/magic-link', { email: email.trim().toLowerCase() })
}

/** Échange le token du lien contre un JWT FlipSync. */
export function verifyMagicLink(token: string): Promise<{ token: string; userId: string; email: string }> {
  return publicPost('/auth/verify', { token })
}

/** DEV uniquement — raccourci local (route absente en production). */
export function devLogin(email: string): Promise<{ token: string; userId: string }> {
  return publicPost('/auth/dev-token', { email })
}

export interface DraftJobStatus {
  status: 'running' | 'ready' | 'failed'
  draft: ListingDraft | null
  error: string | null
}

export const api = {
  // ─── IA serveur — job détaché (survit à l'app tuée en arrière-plan) ────────
  /** Lance la rédaction ; retourne un jobId immédiatement (le serveur travaille seul). */
  startDraftJob: (photosBase64: readonly string[]) =>
    post<{ jobId: string }>('/ai/draft/start', { photos: photosBase64 }),
  /** Poll léger — à appeler toutes les 3-5 s tant que status === 'running'. */
  getDraftJob: (jobId: string) => request<DraftJobStatus>(`/ai/draft/${jobId}`),

  // ─── Wallet ────────────────────────────────────────────────────────────────
  getWallet: () => request<ApiWallet>('/wallet'),
  getTransactions: () => request<{ transactions: ApiTransaction[] }>('/wallet/transactions'),

  // ─── Listing — cycle complet piloté par le mobile ──────────────────────────
  createListing: (tier: ListingTier) =>
    post<{ listing: ApiListing; auth: ListingAuthResult }>('/listing', { tier }),

  /** Photos du listing — intégrité vérifiée serveur (sha256 du base64). */
  uploadPhotos: (listingId: string, photos: readonly UploadPhoto[]) =>
    post<{ photos: ApiPhoto[] }>(`/listing/${listingId}/photos`, { photos }),

  /** AUTHORIZED → AI_PROCESSING (l'inférence tourne on-device). */
  startAi: (listingId: string) => post<{ listing: ApiListing }>(`/listing/${listingId}/ai-start`),

  /** Pousse le brouillon (éventuellement édité par l'utilisateur) → DRAFT_READY. */
  pushDraft: (listingId: string, draft: ListingDraft) =>
    post<{ listing: ApiListing }>(`/listing/${listingId}/draft`, draft),

  /** Échec d'inférence → AI_FAILED (failureReason = code AI_*). */
  failAi: (listingId: string, reason: string) =>
    post<{ listing: ApiListing }>(`/listing/${listingId}/ai-failed`, { reason }),

  /** LE point de débit : DRAFT_READY → USER_VALIDATED (commit) → QUEUED. */
  validate: (listingId: string, prixPublie: number) =>
    post<{ listing: ApiListing }>(`/listing/${listingId}/validate`, { prixPublie }),

  /** Annulation — remboursement automatique si l'annonce était déjà validée. */
  cancel: (listingId: string) => post<{ listing: ApiListing }>(`/listing/${listingId}/cancel`),

  /** Correction post-validation (titre/description/marque/état/prix) — jamais les photos. */
  editListing: (listingId: string, patch: EditListingPatch) =>
    post<{ listing: ApiListing }>(`/listing/${listingId}/edit`, patch),

  /** includeCancelled : réaffiche aussi les annonces annulées masquées après 24h. */
  getListings: (opts?: { includeCancelled?: boolean }) =>
    request<{ listings: ApiListing[] }>(
      opts?.includeCancelled === true ? '/listing?includeCancelled=true' : '/listing',
    ),
  getListing: (listingId: string) => request<{ listing: ApiListing }>(`/listing/${listingId}`),
}
