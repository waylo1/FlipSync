import { SyncErrorCode, type SyncFailure } from '@flipsync/core'

// ─── Socle HTTP des connecteurs v2 (eBay / Shopify) ────────────────────────────
// Un connecteur ne throw JAMAIS : toute erreur transport ou HTTP devient un
// SyncFailure normalisé. fetch est injectable (tests sans réseau).

export interface HttpInit {
  method: string
  headers: Record<string, string>
  body?: string
}

export type FetchLike = (url: string, init: HttpInit) => Promise<{
  status: number
  text: () => Promise<string>
}>

/** fetch global Node ≥ 18 — typé structurellement pour rester lib-agnostique. */
export const defaultFetch: FetchLike = (url, init) =>
  (globalThis as unknown as { fetch: FetchLike }).fetch(url, init)

const fail = (code: SyncErrorCode, detail: string | null, retryable: boolean): SyncFailure => ({
  ok: false,
  code,
  detail,
  retryable,
})

/** Config/credentials absents — AVANT tout appel réseau. */
export const credentialsMissing = (detail: string): SyncFailure =>
  fail(SyncErrorCode.CREDENTIALS_MISSING, detail, false)

/** Payload sortant refusé par le schéma Zod — gate fail-fast, zéro réseau. */
export const invalidPayload = (detail: string): SyncFailure =>
  fail(SyncErrorCode.INVALID_PAYLOAD, detail, false)

/** Statut HTTP → SyncErrorCode. 5xx et 429 sont retryables, le reste non. */
export const httpFailure = (status: number, detail: string | null): SyncFailure => {
  if (status === 401 || status === 403) return fail(SyncErrorCode.CREDENTIALS_MISSING, detail, false)
  if (status === 404) return fail(SyncErrorCode.NOT_FOUND, detail, false)
  if (status === 429) return fail(SyncErrorCode.RATE_LIMITED, detail, true)
  if (status >= 500) return fail(SyncErrorCode.NETWORK_ERROR, detail, true)
  return fail(SyncErrorCode.REMOTE_REJECTED, detail, false)
}

/** Exception transport (DNS, timeout, reset) — retryable. */
export const networkFailure = (err: unknown): SyncFailure =>
  fail(SyncErrorCode.NETWORK_ERROR, err instanceof Error ? err.message : String(err), true)

/** Diagnostic borné — SyncFailure.detail ne doit jamais embarquer un body entier. */
export const truncate = (s: string, max = 300): string =>
  s.length > max ? `${s.slice(0, max)}…` : s

export const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Centimes → décimal plateforme ("3000" → "30.00") — uniquement à la frontière. */
export const centsToDecimal = (cents: number): string => (cents / 100).toFixed(2)
