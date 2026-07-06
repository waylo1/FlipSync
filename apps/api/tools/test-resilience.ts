/**
 * test-resilience — simulation « wildcard » contre l'API LOCALE (jetable).
 * Vérifie sans l'app mobile les trois défenses du Sprint 3.5/hardening :
 *   1. Latence  : timeout client volontairement bas → abort (le mobile mappe
 *      cet abort en TIMEOUT/NETWORK_ERROR via fetchWithTimeout).
 *   2. 401      : JWT corrompu + JWT RÉELLEMENT expiré (signé HS256 avec le
 *      secret local, exp dans le passé) → { error: 'UNAUTHORIZED' }.
 *   3. 429     : bombardement de /auth/magic-link → RATE_LIMITED.
 *
 * Prérequis : API lancée (npm run dev) + .env racine.
 * Lancement : npx ts-node --transpile-only tools/test-resilience.ts
 * NOTE : le compteur rate-limit garde 1 min de mémoire — relancer le script
 * dans la minute suivante reste correct (le dernier appel doit être 429).
 */
import '../src/env'
import { createHmac } from 'node:crypto'

const BASE = process.env.API_BASE ?? `http://localhost:${process.env.API_PORT ?? 3001}`

let failures = 0
const report = (label: string, ok: boolean, detail: string) => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${detail}`)
}

// ─── JWT HS256 minimal (même algo que @fastify/jwt) — usage test uniquement ──
const b64url = (input: Buffer | string): string =>
  Buffer.from(input).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')

function signExpiredJwt(secret: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(
    JSON.stringify({ sub: 'resilience-test', iat: now - 3600, exp: now - 1800 }),
  )
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  return `${header}.${payload}.${signature}`
}

async function main(): Promise<void> {
  // Sanité : l'API répond (sinon tout le reste est du bruit).
  const health = await fetch(`${BASE}/health`).then(r => r.status).catch(() => 0)
  if (health !== 200) {
    console.error(`API injoignable sur ${BASE} — lancer \`npm run dev\` d'abord.`)
    process.exit(1)
  }

  // ─── 1. Latence : timeout client 1 ms → abort attendu ─────────────────────
  const aborted = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1) })
    .then(() => false)
    .catch(() => true)
  report(
    'latence',
    aborted,
    aborted
      ? 'timeout 1 ms → requête avortée (mobile : ApiError TIMEOUT via fetchWithTimeout)'
      : 'la requête a répondu sous 1 ms — abort non déclenché',
  )

  // ─── 2. Token corrompu puis réellement expiré → 401 UNAUTHORIZED ──────────
  const corrupt = await fetch(`${BASE}/wallet`, {
    headers: { authorization: 'Bearer pas.un.jwt' },
  })
  const corruptBody = (await corrupt.json()) as { error?: string }
  report(
    'jwt corrompu',
    corrupt.status === 401 && corruptBody.error === 'UNAUTHORIZED',
    `status ${corrupt.status}, body ${JSON.stringify(corruptBody)}`,
  )

  const secret = process.env.JWT_SECRET
  if (!secret) {
    report('jwt expiré', false, 'JWT_SECRET absent de l’env — impossible de signer')
  } else {
    const expired = await fetch(`${BASE}/wallet`, {
      headers: { authorization: `Bearer ${signExpiredJwt(secret)}` },
    })
    const expiredBody = (await expired.json()) as { error?: string }
    report(
      'jwt expiré (signature valide, exp passé)',
      expired.status === 401 && expiredBody.error === 'UNAUTHORIZED',
      `status ${expired.status}, body ${JSON.stringify(expiredBody)}`,
    )
  }

  // ─── 3. Rate limit : 7 requêtes /auth/magic-link → la dernière est 429 ────
  const statuses: number[] = []
  let lastBody: { error?: string } = {}
  for (let i = 0; i < 7; i++) {
    const res = await fetch(`${BASE}/auth/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pas-un-email' }), // 400 avant toute écriture DB
    })
    statuses.push(res.status)
    lastBody = (await res.json()) as { error?: string }
  }
  report(
    'rate limit /auth',
    statuses[statuses.length - 1] === 429 && lastBody.error === 'RATE_LIMITED',
    `statuts ${statuses.join(',')} — dernier body ${JSON.stringify(lastBody)}`,
  )

  console.log(failures === 0 ? '\nSUCCESS' : `\nFAILURE (${failures} scénario(s) en échec)`)
  // Pas de process.exit() : sous Windows, ts-node + exit brutal déclenche une
  // assertion libuv après la sortie. exitCode laisse le process se terminer proprement.
  process.exitCode = failures === 0 ? 0 : 1
}

void main().catch(err => {
  console.error('FAILURE (erreur inattendue) :', err)
  process.exitCode = 1
})
