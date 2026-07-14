import { createHmac, timingSafeEqual } from 'node:crypto'

// ─── URLs photos signées temporaires (Run 6) ───────────────────────────────────
// Les plateformes externes (eBay/Shopify) récupèrent les images par HTTP sans
// JWT : le pipeline de publication émet des URLs à expiration signées
// HMAC-SHA256 — même mécanique que les Signed URLs S3/GCS, sans service
// externe (les photos vivent sur le disque de l'API). Seul le CHEMIN est
// signé (pas l'hôte) ; la route statique /uploads (app.ts) vérifie signature
// + expiration et ne bypasse le JWT que dans ce cas.
//
// Env : PHOTO_URL_SECRET (défaut : JWT_SECRET, garanti au boot) ;
//       PHOTO_URL_TTL_SECONDS (défaut : 86 400 — fenêtre de fetch asynchrone
//       des plateformes, Shopify récupère les médias en différé).

const DEFAULT_TTL_SECONDS = 86_400

// Lu à l'appel (jamais figé à l'import) : les tests posent l'env après import.
const secret = (): string => process.env.PHOTO_URL_SECRET ?? process.env.JWT_SECRET ?? ''

const hmacHex = (payload: string): string =>
  createHmac('sha256', secret()).update(payload).digest('hex')

/** Chemin photo → chemin signé `…?exp=<epoch>&sig=<hmac>` (TTL configurable). */
export const signPhotoPath = (path: string, ttlSeconds?: number): string => {
  // Sans secret (impossible en pratique : JWT_SECRET exigé au boot), on rend
  // le chemin tel quel — comportement d'avant Run 6, jamais un throw en plein publish.
  if (secret() === '') return path
  const ttl = ttlSeconds ?? Number(process.env.PHOTO_URL_TTL_SECONDS ?? DEFAULT_TTL_SECONDS)
  const exp = Math.floor(Date.now() / 1000) + ttl
  return `${path}?exp=${exp}&sig=${hmacHex(`${path}\n${exp}`)}`
}

/** true ssi `url` (chemin + query) porte une signature valide et non expirée. */
export const isSignedPhotoUrlValid = (url: string): boolean => {
  const q = url.indexOf('?')
  if (q === -1 || secret() === '') return false
  const path = url.slice(0, q)
  const params = new URLSearchParams(url.slice(q + 1))
  const exp = Number(params.get('exp'))
  const sig = params.get('sig') ?? ''
  if (!Number.isInteger(exp) || exp <= Math.floor(Date.now() / 1000)) return false
  const expected = hmacHex(`${path}\n${exp}`)
  const given = Buffer.from(sig)
  const wanted = Buffer.from(expected)
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}
